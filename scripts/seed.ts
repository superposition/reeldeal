import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { gate, ObservationSchema, TypedDecisionInputSchema, type Observation, type TypedDecisionInput } from '../packages/domain/src/index';
import { createStubBackend } from '../packages/decision/src/stub';
import { seedIntakeReviewer } from '../apps/api/src/db/demo-market';

// Synthetic board snapshots, not real landings, sales, signatures, or chain evidence.
// IDs and timestamps are stable so a second run cannot duplicate or rewrite them.
const DEMO_ORG = 'demo-kesennuma';
const DEMO_OPERATOR = 'demo-operator';
const CAPTURED_AT = '2026-09-26T00:00:00.000Z';
const AT = Date.parse(CAPTURED_AT);

type Fixture = {
  slug: string;
  speciesJa: string;
  lengthMm: number;
  weightG: number;
  priceJpy: number;
  status: 'listed' | 'pending_review' | 'sold';
  review?: 'noul' | 'low_confidence';
};

export const demoFixtures: readonly Fixture[] = [
  { slug: 'sanma', speciesJa: 'サンマ', lengthMm: 412, weightG: 1480, priceJpy: 2400, status: 'listed' },
  { slug: 'katsuo', speciesJa: 'カツオ', lengthMm: 520, weightG: 2900, priceJpy: 3200, status: 'listed' },
  { slug: 'saba', speciesJa: 'サバ', lengthMm: 350, weightG: 880, priceJpy: 1500, status: 'pending_review', review: 'low_confidence' },
  { slug: 'hotate', speciesJa: 'ホタテ', lengthMm: 110, weightG: 220, priceJpy: 3800, status: 'pending_review', review: 'noul' },
  { slug: 'maguro', speciesJa: 'メバチ', lengthMm: 1100, weightG: 18000, priceJpy: 4500, status: 'sold' },
  { slug: 'awabi', speciesJa: 'アワビ', lengthMm: 95, weightG: 180, priceJpy: 12000, status: 'sold' },
];

function observationFor(fixture: Fixture): Observation {
  return ObservationSchema.parse({
    id: `demo-observation-${fixture.slug}`,
    org_id: DEMO_ORG,
    scan_id: `demo-scan-${fixture.slug}`,
    captured_at: CAPTURED_AT,
    image_ref: `demo:synthetic-no-photo:${fixture.slug}`,
    source: 'manual',
    length_mm: fixture.lengthMm,
    girth_mm: null,
    weight_g: fixture.weightG,
    ice_temp_c: null,
    species_candidates: [{ label: fixture.slug, score: 0.92 }],
    species_label: fixture.slug,
    species_confirmed_by: DEMO_OPERATOR,
    scale_reading: { stable: fixture.review !== 'noul', grams: fixture.weightG },
    status: 'recorded',
    created_at: CAPTURED_AT,
    updated_at: CAPTURED_AT,
  });
}

type PreparedFixture = { fixture: Fixture; observation: Observation; decision: TypedDecisionInput; gateReason: string | null; payloadHash: string };

async function prepareFixtures(): Promise<PreparedFixture[]> {
  const normal = createStubBackend();
  const forcedReview = createStubBackend({ forceLow: true });
  return Promise.all(demoFixtures.map(async (fixture) => {
    const observation = observationFor(fixture);
    const decision = TypedDecisionInputSchema.parse(await (fixture.review === 'low_confidence' ? forcedReview : normal).decide(observation, 'grade'));
    const verdict = gate(decision, observation);
    if (fixture.status === 'pending_review' && (verdict.route !== 'pending_review' || verdict.reason !== (fixture.review === 'noul' ? 'noul' : 'low_decision_confidence'))) {
      throw new Error(`fixture ${fixture.slug} did not produce its intended review gate`);
    }
    if (fixture.status !== 'pending_review' && verdict.route !== 'auto_approve') {
      throw new Error(`fixture ${fixture.slug} did not pass the review gate`);
    }
    const payloadHash = `0x${createHash('sha256').update(JSON.stringify({ demo: true, observation, decision })).digest('hex')}`;
    return { fixture, observation, decision, gateReason: verdict.route === 'pending_review' ? verdict.reason : null, payloadHash };
  }));
}

export async function seedDemoData(db: Database): Promise<{ inserted: number; skipped: number }> {
  const prepared = await prepareFixtures();
  return db.transaction(() => {
    seedIntakeReviewer(db);
    db.query('INSERT OR IGNORE INTO orgs (id,slug,name,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(DEMO_ORG, DEMO_ORG, 'Kesennuma synthetic demo', 'active', AT, AT);
    db.query('INSERT OR IGNORE INTO users (id,org_id,label,wallet,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(DEMO_OPERATOR, DEMO_ORG, 'Demo operator (synthetic)', null, 'operator', 'active', AT, AT);

    let inserted = 0;
    for (const { fixture, observation, decision, gateReason, payloadHash } of prepared) {
      const lotId = `demo-lot-${fixture.slug}`;
      if (db.query('SELECT 1 FROM lots WHERE id = ?').get(lotId)) continue;
      const scanId = observation.scan_id;
      const decisionId = `demo-decision-${fixture.slug}`;
      db.query(`INSERT INTO fish_scans (id,org_id,user_id,captured_at,image_ref,source,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(scanId, DEMO_ORG, DEMO_OPERATOR, AT, observation.image_ref, 'manual', 'decided', AT, AT);
      db.query(`INSERT INTO observations (id,scan_id,org_id,payload_json,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?)`).run(observation.id, scanId, DEMO_ORG, JSON.stringify(observation), 'recorded', AT, AT);
      db.query(`INSERT INTO decisions (id,scan_id,observation_id,org_id,question_id,kind,payload_json,confidence,confidence_source,
        model_id,model_version,runtime,model_sha256,latency_ms,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        decisionId, scanId, observation.id, DEMO_ORG, decision.question_id, decision.kind, JSON.stringify(decision),
        decision.confidence, decision.confidence_source, decision.model.id, decision.model.version, decision.model.runtime,
        decision.model.sha256 ?? null, decision.latency_ms, 'recorded', AT, AT,
      );
      db.query(`INSERT INTO lots (id,org_id,scan_id,decision_id,user_id,species_label,weight_g,price_jpy,status,gate_reason,gate_policy_version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        lotId, DEMO_ORG, scanId, decisionId, DEMO_OPERATOR, fixture.slug, fixture.weightG,
        fixture.priceJpy, fixture.status, gateReason, '1', AT, AT,
      );
      if (fixture.status !== 'pending_review') {
        db.query(`INSERT INTO listings (id,lot_id,seller_org_id,price_jpy,status,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?)`).run(
          `demo-listing-${fixture.slug}`, lotId, DEMO_ORG, fixture.priceJpy,
          fixture.status === 'sold' ? 'settled' : 'open', AT, AT,
        );
      }
      // The ID itself marks this row as demo. Its hash covers the explicit demo
      // flag and actual synthetic input, while NULL tx_hash + pending deny a chain claim.
      db.query(`INSERT INTO provenance_records (id,lot_id,org_id,payload_hash,chain_id,tx_hash,anchor_status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
          `demo-provenance-${fixture.slug}`, lotId, DEMO_ORG, payloadHash, 1, null, 'pending', AT, AT,
        );
      db.query(`INSERT INTO audit_log (id,entity_type,entity_id,org_id,actor_kind,actor_id,from_status,to_status,request_id,payload_json,at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
          `demo-audit-${fixture.slug}`, 'Lot', lotId, DEMO_ORG, 'system', 'rd-25-seed', null,
          fixture.status, 'rd-25-seed', JSON.stringify({ demo: true, synthetic: true, provenance_id: `demo-provenance-${fixture.slug}`, no_real_sale_or_chain_tx: true }), AT,
        );
      inserted++;
    }
    return { inserted, skipped: prepared.length - inserted };
  })();
}

export type DemoPreviewLot = {
  id: string;
  species: string;
  species_ja: string;
  length_mm: number;
  weight_g: number;
  price_jpy: number;
  status: Fixture['status'];
  gate_reason: string | null;
  confidence: number;
  decision_kind: string;
  demo: true;
  provenance: { id: string; anchor_status: 'pending'; tx_hash: null };
};

/** Read-only JSON source for a board preview until RD-18 wires the listing API. */
export function previewDemoLots(db: Database): DemoPreviewLot[] {
  const rows = db.query(`SELECT l.id, l.species_label, l.weight_g, l.price_jpy, l.status, l.gate_reason,
      d.confidence, d.kind, p.id AS provenance_id, p.anchor_status, p.tx_hash
    FROM lots l
    JOIN decisions d ON d.id = l.decision_id
    JOIN provenance_records p ON p.lot_id = l.id
    WHERE l.org_id = ? AND l.id LIKE 'demo-lot-%'`).all(DEMO_ORG) as Array<Record<string, unknown>>;
  const byId = new Map(rows.map((row) => [row.id, row]));
  return demoFixtures.flatMap((fixture) => {
    const row = byId.get(`demo-lot-${fixture.slug}`);
    if (!row) return [];
    return [{
      id: String(row.id), species: fixture.slug, species_ja: fixture.speciesJa,
      length_mm: fixture.lengthMm, weight_g: Number(row.weight_g), price_jpy: Number(row.price_jpy),
      status: row.status as Fixture['status'], gate_reason: row.gate_reason as string | null,
      confidence: Number(row.confidence), decision_kind: String(row.kind), demo: true as const,
      provenance: { id: String(row.provenance_id), anchor_status: row.anchor_status as 'pending', tx_hash: row.tx_hash as null },
    }];
  });
}

if (import.meta.main) {
  const { db } = await import('../apps/api/src/db/index');
  if (process.argv.includes('--preview')) {
    console.log(JSON.stringify({ demo: true, lots: previewDemoLots(db) }, null, 2));
  } else {
    const result = await seedDemoData(db);
    console.log(`RD-25 synthetic demo seed: ${result.inserted} inserted, ${result.skipped} already present. No real sales or chain transactions.`);
  }
  db.close();
}
