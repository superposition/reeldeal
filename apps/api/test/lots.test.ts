import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { createStubBackend } from '../../../packages/decision/src/stub';
import type { ObservationInput } from '../../../packages/domain/src';
import { getListings } from '../src/routes/listings';
import { getLot, postLot, postPublish } from '../src/routes/lot-service';
import { postLotReview } from '../src/routes/review';
import { seedDemoData } from '../../../scripts/seed';

function freshDb(): Database {
  const database = new Database(':memory:', { strict: true });
  database.exec(readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  database.query("INSERT INTO orgs (id,slug,name,status,created_at,updated_at) VALUES ('org','kessenuma','Demo','active',1,1)").run();
  database.query("INSERT INTO users (id,org_id,label,role,status,created_at,updated_at) VALUES ('operator','org','Demo operator','operator','active',1,1)").run();
  return database;
}

async function decided(database: Database, options: { weight?: number | null; scanId?: string; forceLow?: boolean } = {}) {
  const scanId = options.scanId ?? crypto.randomUUID();
  const observationId = crypto.randomUUID();
  const decisionId = crypto.randomUUID();
  const weight = options.weight === undefined ? 1000 : options.weight;
  const observation: ObservationInput = {
    scan_id: scanId, captured_at: '2026-09-26T00:00:00.000Z',
    image_ref: 'data:image/jpeg;base64,AA==', source: 'webcam',
    length_mm: 400, girth_mm: null, weight_g: weight, ice_temp_c: null,
    species_candidates: [{ label: 'saba', score: 0.92 }],
    species_label: 'saba', species_confirmed_by: 'operator',
    scale_reading: { stable: weight !== null, grams: weight },
  };
  const decision = await createStubBackend({ forceLow: options.forceLow }).decide({
    ...observation, id: observationId, org_id: 'org', status: 'recorded',
    created_at: observation.captured_at, updated_at: observation.captured_at,
  }, 'grade');
  database.query(`INSERT INTO fish_scans
    (id,org_id,captured_at,image_ref,source,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(scanId, 'org', 1, observation.image_ref, 'webcam', 'decided', 1, 1);
  database.query(`INSERT INTO observations
    (id,scan_id,org_id,payload_json,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run(observationId, scanId, 'org', JSON.stringify(observation), 'recorded', 1, 1);
  database.query(`INSERT INTO decisions
    (id,scan_id,observation_id,org_id,question_id,kind,payload_json,confidence,confidence_source,
      model_id,model_version,runtime,model_sha256,latency_ms,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    decisionId, scanId, observationId, 'org', decision.question_id, decision.kind, JSON.stringify(decision),
    decision.confidence, decision.confidence_source, decision.model.id, decision.model.version,
    decision.model.runtime, null, decision.latency_ms, 'recorded', 1, 1,
  );
  return { scanId, observationId, decisionId };
}

const createRequest = (scanId: string, decisionId: string, price = 1800) => new Request('http://localhost/v1/lots', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ scan_id: scanId, decision_id: decisionId, price_jpy: price }),
});

describe('Lot gate and publish', () => {
  test('seeded demo lot detail accepts persisted observation metadata', async () => {
    const database = freshDb();
    await seedDemoData(database);
    const response = getLot(database, 'demo-lot-sanma');
    expect(response.status).toBe(200);
    const detail = await response.json();
    expect(detail.lot.id).toBe('demo-lot-sanma');
    expect(detail.observation.id).toBe('demo-observation-sanma');
    expect(detail.effective_facts.species_label).toBe('sanma');
    database.close();
  });

  test('eligible decision creates one approved Lot, publishes once, and serves traceable detail', async () => {
    const database = freshDb();
    const { scanId, decisionId } = await decided(database);
    const created = await postLot(database, createRequest(scanId, decisionId));
    expect(created.status).toBe(201);
    const { lot } = await created.json();
    expect(lot.status).toBe('approved');
    expect(lot.decision_id).toBe(decisionId);
    expect((await postLot(database, createRequest(scanId, decisionId))).status).toBe(200);
    const published = await postPublish(database, lot.id);
    expect(published.status).toBe(201);
    const { listing } = await published.json();
    expect(listing.status).toBe('open');
    expect((await postPublish(database, lot.id)).status).toBe(200);
    const detail = await getLot(database, lot.id).json();
    expect(detail.lot.status).toBe('listed');
    expect(detail.typed_decision.id).toBe(decisionId);
    expect(detail.observation.scan_id).toBe(scanId);
    expect(detail.audit.some((event: { to_status: string }) => event.to_status === 'listed')).toBe(true);
    const market = await getListings(database, new Request('http://localhost/v1/listings?org=kessenuma&status=open&category=saba')).json();
    expect(market.open_count).toBe(1);
    expect(market.listings.map((item: { id: string }) => item.id)).toEqual([listing.id]);
    expect((database.query('SELECT COUNT(*) AS n FROM listings').get() as { n: number }).n).toBe(1);
    database.close();
  });

  test('missing weight yields review and blocks publication with the reason', async () => {
    const database = freshDb();
    const { scanId, decisionId } = await decided(database, { weight: null });
    const response = await postLot(database, createRequest(scanId, decisionId));
    expect(response.status).toBe(201);
    const { lot } = await response.json();
    expect(lot.status).toBe('pending_review');
    expect(lot.gate_reason).toBe('noul');
    const blocked = await postPublish(database, lot.id);
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).reason).toBe('noul');
    expect((database.query('SELECT COUNT(*) AS n FROM listings').get() as { n: number }).n).toBe(0);
    database.close();
  });

  test('changed observation invalidates a decision pinned to an older version', async () => {
    const database = freshDb();
    const { scanId, decisionId } = await decided(database);
    database.query(`INSERT INTO observations
      (id,scan_id,org_id,payload_json,status,created_at,updated_at)
      SELECT ?,scan_id,org_id,payload_json,status,created_at,updated_at FROM observations WHERE scan_id = ?`)
      .run(crypto.randomUUID(), scanId);
    const response = await postLot(database, createRequest(scanId, decisionId));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('stale_decision');
    expect((database.query('SELECT COUNT(*) AS n FROM lots').get() as { n: number }).n).toBe(0);
    database.close();
  });

  test('human-corrected species is visible without changing the original decision or observation', async () => {
    const database = freshDb();
    const { scanId, decisionId } = await decided(database, { forceLow: true });
    const { lot } = await (await postLot(database, createRequest(scanId, decisionId))).json();
    expect(lot.status).toBe('pending_review');
    const review = await postLotReview(database, lot.id, new Request(`http://localhost/v1/lots/${lot.id}/review`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ field: 'species_label', human_value: 'katsuo', actor_id: 'operator',
        reason: 'Operator inspected the landing and corrected the species.', attest: true }),
    }));
    expect(review.status).toBe(200);
    expect((await review.json()).human_approved).toBe(true);
    expect((await postPublish(database, lot.id)).status).toBe(201);
    const detail = await getLot(database, lot.id).json();
    expect(detail.observation.species_label).toBe('saba');
    expect(detail.effective_facts).toMatchObject({ species_label: 'katsuo', human_corrected: true });
    expect(detail.corrections[0]).toMatchObject({ field: 'species_label', human_value: 'katsuo', human_supplied: true });
    const market = await getListings(database, new Request('http://localhost/v1/listings?category=katsuo')).json();
    expect(market.listings).toHaveLength(1);
    expect(market.listings[0]).toMatchObject({ species_label: 'katsuo', human_corrected: true });
    expect((await getListings(database, new Request('http://localhost/v1/listings?category=saba')).json()).listings).toHaveLength(0);
    database.close();
  });
});
