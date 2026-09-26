import type { Database } from 'bun:sqlite';
import {
  GATE, JpySchema, LotSchema, ObservationInputSchema, ObservationSchema,
  TypedDecisionInputSchema, TypedDecisionSchema, gate, fishScanMachine, lotMachine,
} from '@reeldeal/domain';
import { json } from './stub';

type ScanRow = { id: string; org_id: string; user_id: string | null; status: string };
type FactRow = { id: string; scan_id: string; org_id: string; payload_json: string; status: string; created_at: number; updated_at: number };
type DecisionRow = FactRow & { observation_id: string };
export type LotRow = {
  id: string; org_id: string; scan_id: string; decision_id: string; user_id: string | null;
  species_label: string | null; weight_g: number | null; price_jpy: number; status: string;
  gate_reason: string | null; gate_policy_version: string | null; created_at: number; updated_at: number;
};
export type ListingRow = {
  id: string; lot_id: string; seller_org_id: string; price_jpy: number; status: string;
  created_at: number; updated_at: number;
};

export const timestamp = (value: number) => new Date(value).toISOString();

export function lotWire(row: LotRow) {
  return {
    ...LotSchema.parse({
      id: row.id, org_id: row.org_id, scan_id: row.scan_id, decision_id: row.decision_id,
      species_label: row.species_label, weight_g: row.weight_g, price_jpy: row.price_jpy,
      status: row.status, created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at),
    }),
    gate_reason: row.gate_reason, gate_policy_version: row.gate_policy_version,
  };
}

export function listingWire(row: ListingRow) {
  return {
    id: row.id, lot_id: row.lot_id, seller_org_id: row.seller_org_id,
    price_jpy: row.price_jpy, status: row.status,
    created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at),
  };
}

export function audit(database: Database, entry: {
  entity: string; id: string; org: string; actor: string; from: string | null;
  to: string; requestId: string; payload: unknown;
}, at: number): void {
  database.query(`INSERT INTO audit_log
    (id,entity_type,entity_id,org_id,actor_kind,actor_id,from_status,to_status,request_id,payload_json,at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), entry.entity, entry.id, entry.org, 'system', entry.actor,
    entry.from, entry.to, entry.requestId, JSON.stringify(entry.payload), at,
  );
}

function observationValue(row: FactRow) {
  const raw: unknown = JSON.parse(row.payload_json);
  const input = ObservationInputSchema.safeParse(raw);
  return input.success ? input.data : ObservationSchema.parse(raw);
}

type CorrectionValue = { field: string; human_value: string; actor_id: string };

export function effectiveObservation(original: ReturnType<typeof observationValue>, corrections: CorrectionValue[]) {
  let effective = ObservationInputSchema.parse(original);
  for (const correction of corrections) {
    const value: unknown = JSON.parse(correction.human_value);
    if (correction.field === 'length_mm' && typeof value === 'number') effective = { ...effective, length_mm: value };
    if (correction.field === 'weight_g' && typeof value === 'number') effective = { ...effective, weight_g: value };
    if (correction.field === 'scale_stable' && typeof value === 'boolean') {
      effective = { ...effective, scale_reading: { ...effective.scale_reading, stable: value } };
    }
    if (correction.field === 'scale_grams' && typeof value === 'number') {
      effective = { ...effective, scale_reading: { ...effective.scale_reading, grams: value } };
    }
    if (correction.field === 'species_label' && typeof value === 'string') {
      effective = { ...effective, species_label: value.trim(), species_confirmed_by: correction.actor_id };
    }
  }
  return ObservationInputSchema.parse(effective);
}

function decisionValue(row: DecisionRow) {
  return TypedDecisionInputSchema.parse(JSON.parse(row.payload_json));
}

function parseCreate(value: unknown): { scan_id: string; decision_id: string; price_jpy: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['scan_id', 'decision_id', 'price_jpy'].includes(key))) return null;
  if (typeof body.scan_id !== 'string' || !body.scan_id ||
      typeof body.decision_id !== 'string' || !body.decision_id ||
      !JpySchema.safeParse(body.price_jpy).success) return null;
  return { scan_id: body.scan_id, decision_id: body.decision_id, price_jpy: body.price_jpy as number };
}

export async function postLot(database: Database, request: Request): Promise<Response> {
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'invalid_input', issues: [{ path: ['body'], message: 'Expected JSON' }] }, 400); }
  const input = parseCreate(raw);
  if (!input) return json({ error: 'invalid_input', issues: [{ path: ['body'], message: 'Expected scan_id, decision_id and nonnegative integer price_jpy only' }] }, 400);

  const result = database.transaction(() => {
    const existing = database.query('SELECT * FROM lots WHERE scan_id = ?').get(input.scan_id) as LotRow | null;
    if (existing) {
      if (existing.decision_id === input.decision_id && existing.price_jpy === input.price_jpy) {
        return { status: 200, body: { lot: lotWire(existing), replayed: true } };
      }
      return { status: 409, body: { error: 'lot_exists', lot_id: existing.id } };
    }
    const scan = database.query('SELECT id,org_id,user_id,status FROM fish_scans WHERE id = ?').get(input.scan_id) as ScanRow | null;
    if (!scan) return { status: 404, body: { error: 'scan_not_found' } };
    if (scan.status !== 'decided') return { status: 409, body: { error: 'not_decided_yet' } };
    const decision = database.query('SELECT * FROM decisions WHERE id = ? AND scan_id = ?')
      .get(input.decision_id, input.scan_id) as DecisionRow | null;
    if (!decision) return { status: 409, body: { error: 'not_decided_yet' } };
    const latest = database.query(`SELECT * FROM observations WHERE scan_id = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(input.scan_id) as FactRow | null;
    if (!latest || latest.id !== decision.observation_id) return { status: 409, body: { error: 'stale_decision' } };
    const observation = observationValue(latest);
    const typed = decisionValue(decision);
    if (typed.scan_id !== scan.id || typed.observation_id !== latest.id ||
        !['grade', 'completeness'].includes(typed.question_id)) {
      return { status: 409, body: { error: 'decision_mismatch' } };
    }
    const verdict = gate(typed, observation);
    const status = lotMachine.transition('draft', verdict.route === 'auto_approve' ? 'approved' : 'pending_review');
    const at = Date.now();
    const lotId = crypto.randomUUID();
    database.query(`INSERT INTO lots
      (id,org_id,scan_id,decision_id,user_id,species_label,weight_g,price_jpy,status,gate_reason,gate_policy_version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      lotId, scan.org_id, scan.id, decision.id, scan.user_id, observation.species_label ?? null,
      observation.weight_g, input.price_jpy, status,
      verdict.route === 'pending_review' ? verdict.reason : null, GATE.version, at, at,
    );
    audit(database, {
      entity: 'Lot', id: lotId, org: scan.org_id, actor: 'gate-policy-v1', from: 'draft', to: status,
      requestId: lotId, payload: { scan_id: scan.id, observation_id: latest.id, decision_id: decision.id, gate: verdict },
    }, at);
    if (verdict.route === 'auto_approve') {
      const scanStatus = fishScanMachine.transition('decided', 'promoted');
      database.query('UPDATE fish_scans SET status = ?, updated_at = ? WHERE id = ?').run(scanStatus, at, scan.id);
      audit(database, {
        entity: 'FishScan', id: scan.id, org: scan.org_id, actor: 'gate-policy-v1',
        from: 'decided', to: scanStatus, requestId: lotId, payload: { lot_id: lotId, decision_id: decision.id },
      }, at);
    }
    return { status: 201, body: { lot: lotWire(database.query('SELECT * FROM lots WHERE id = ?').get(lotId) as LotRow), replayed: false } };
  })();
  return json(result.body, result.status);
}

export function getLot(database: Database, lotId: string): Response {
  const row = database.query('SELECT * FROM lots WHERE id = ?').get(lotId) as LotRow | null;
  if (!row) return json({ error: 'lot_not_found' }, 404);
  const observation = database.query(`SELECT o.* FROM observations o
    JOIN decisions d ON d.observation_id = o.id WHERE d.id = ?`).get(row.decision_id) as FactRow;
  const decision = database.query('SELECT * FROM decisions WHERE id = ?').get(row.decision_id) as DecisionRow;
  const corrections = database.query('SELECT * FROM corrections WHERE lot_id = ? ORDER BY created_at,rowid')
    .all(row.id) as Array<Record<string, unknown>>;
  const events = database.query(`SELECT entity_type,entity_id,actor_kind,actor_id,from_status,to_status,payload_json,at
    FROM audit_log WHERE (entity_type = 'Lot' AND entity_id = ?)
      OR (entity_type = 'FishScan' AND entity_id = ?)
      OR (entity_type = 'Observation' AND entity_id = ?)
      OR (entity_type = 'TypedDecision' AND entity_id = ?)
      OR (entity_type = 'Correction' AND entity_id IN (SELECT id FROM corrections WHERE lot_id = ?))
    ORDER BY at,rowid`).all(row.id, row.scan_id, observation.id, row.decision_id, row.id) as Array<Record<string, unknown>>;
  const original = observationValue(observation);
  const effective = effectiveObservation(original, corrections.map((item) => ({
    field: String(item.field), human_value: String(item.human_value), actor_id: String(item.actor_id),
  })));
  const typed = decisionValue(decision);
  return json({
    lot: lotWire(row),
    effective_facts: {
      species_label: effective.species_label, species_confirmed_by: effective.species_confirmed_by,
      length_mm: effective.length_mm, weight_g: effective.weight_g,
      human_corrected: corrections.length > 0,
    },
    observation: {
      ...original, id: observation.id, org_id: observation.org_id, status: observation.status,
      created_at: timestamp(observation.created_at), updated_at: timestamp(observation.updated_at),
    },
    typed_decision: TypedDecisionSchema.parse({
      ...typed, id: decision.id, org_id: decision.org_id, status: decision.status,
      created_at: timestamp(decision.created_at), updated_at: timestamp(decision.updated_at),
    }),
    corrections: corrections.map((item) => ({
      id: item.id, field: item.field,
      model_value: JSON.parse(String(item.model_value)), human_value: JSON.parse(String(item.human_value)),
      reason: item.reason, actor_id: item.actor_id, human_supplied: true,
      created_at: timestamp(Number(item.created_at)),
    })),
    audit: events.map(({ payload_json, at, ...event }) => ({
      ...event, payload: payload_json === null ? null : JSON.parse(String(payload_json)), at: timestamp(Number(at)),
    })),
    gate: gate(typed, original),
  });
}

export function postPublish(database: Database, lotId: string): Response {
  const result = database.transaction(() => {
    const lot = database.query('SELECT * FROM lots WHERE id = ?').get(lotId) as LotRow | null;
    if (!lot) return { status: 404, body: { error: 'lot_not_found' } };
    if (lot.status === 'pending_review') return { status: 409, body: { error: 'review_required', reason: lot.gate_reason } };
    const previous = database.query('SELECT * FROM listings WHERE lot_id = ?').get(lotId) as ListingRow | null;
    if (previous) return { status: 200, body: { listing: listingWire(previous), replayed: true } };
    if (lot.status !== 'approved') return { status: 409, body: { error: 'lot_not_approved' } };
    const status = lotMachine.transition('approved', 'listed');
    const at = Date.now();
    const listingId = crypto.randomUUID();
    database.query('UPDATE lots SET status = ?, updated_at = ? WHERE id = ?').run(status, at, lot.id);
    database.query(`INSERT INTO listings (id,lot_id,seller_org_id,price_jpy,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(listingId, lot.id, lot.org_id, lot.price_jpy, 'open', at, at);
    audit(database, { entity: 'Lot', id: lot.id, org: lot.org_id, actor: 'publish-api',
      from: 'approved', to: status, requestId: listingId, payload: { listing_id: listingId } }, at);
    audit(database, { entity: 'Listing', id: listingId, org: lot.org_id, actor: 'publish-api',
      from: null, to: 'open', requestId: listingId, payload: { lot_id: lot.id, price_jpy: lot.price_jpy } }, at);
    return { status: 201, body: { listing: listingWire(database.query('SELECT * FROM listings WHERE id = ?').get(listingId) as ListingRow), replayed: false } };
  })();
  return json(result.body, result.status);
}
