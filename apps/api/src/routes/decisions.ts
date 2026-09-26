import { fishScanMachine, layaEntropyConfidence, TypedDecisionInputSchema, TypedDecisionSchema, type TypedDecisionInput } from '@reeldeal/domain';
import { LAYA_MODEL } from '@reeldeal/decision';
import { audit, db, now } from '../db';
import { json, options } from './stub';

type StoredDecision = {
  id: string;
  scan_id: string;
  observation_id: string;
  org_id: string;
  payload_json: string;
  status: string;
  created_at: number;
  updated_at: number;
};

type ScanRef = { id: string; org_id: string; status: string };
type ObservationRef = { id: string; scan_id: string; org_id: string };

function stored(id: string): StoredDecision | null {
  return db.query('SELECT * FROM decisions WHERE id = ?').get(id) as StoredDecision | null;
}

function wire(row: StoredDecision) {
  return TypedDecisionSchema.parse({
    ...JSON.parse(row.payload_json),
    id: row.id,
    org_id: row.org_id,
    status: row.status,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  });
}

type InsertResult =
  | { kind: 'created' | 'replayed'; row: StoredDecision }
  | { kind: 'error'; status: 400 | 404 | 409; error: string; issues?: Array<{ path: string[]; message: string }> };

function insert(input: TypedDecisionInput, payload: string): InsertResult {
  const decisionId = input.decision_id!;
  const previous = stored(decisionId);
  if (previous) {
    return previous.payload_json === payload
      ? { kind: 'replayed', row: previous }
      : { kind: 'error', status: 409, error: 'decision_id_conflict' };
  }

  // A retry of an older pinned decision must still replay after a future model
  // pin changes. Only a new insert is checked against the currently reviewed pin.
  const reportedLaya = input.confidence_source.startsWith('laya_') || input.model.id === LAYA_MODEL.id;
  if (reportedLaya && (
    !input.confidence_source.startsWith('laya_')
    || input.model.id !== LAYA_MODEL.id
    || input.model.version !== LAYA_MODEL.variant
    || input.model.runtime !== 'wasm'
    || input.model.sha256 !== LAYA_MODEL.weights.sha256
  )) {
    return { kind: 'error', status: 400, error: 'invalid_input',
      issues: [{ path: ['model'], message: 'Reported Laya metadata must match the reviewed local model pin' }] };
  }
  if (input.confidence_source === 'laya_entropy') {
    const probabilities = input.probabilities;
    const expected = probabilities ? layaEntropyConfidence(probabilities).confidence : null;
    if (expected === null || Math.abs(input.confidence - expected) > 1e-6) {
      return { kind: 'error', status: 400, error: 'invalid_input',
        issues: [{ path: ['confidence'], message: 'Reported Laya entropy confidence must match probabilities' }] };
    }
  }

  const scan = db.query('SELECT id, org_id, status FROM fish_scans WHERE id = ?')
    .get(input.scan_id) as ScanRef | null;
  if (!scan) return { kind: 'error', status: 404, error: 'scan_not_found' };
  const observation = db.query('SELECT id, scan_id, org_id FROM observations WHERE id = ?')
    .get(input.observation_id) as ObservationRef | null;
  if (!observation) return { kind: 'error', status: 404, error: 'observation_not_found' };
  if (observation.scan_id !== scan.id || observation.org_id !== scan.org_id) {
    return { kind: 'error', status: 409, error: 'observation_scan_mismatch' };
  }
  const latest = db.query(`
    SELECT id FROM observations WHERE scan_id = ?
    ORDER BY created_at DESC, rowid DESC LIMIT 1
  `).get(scan.id) as { id: string } | null;
  if (latest?.id !== observation.id) return { kind: 'error', status: 409, error: 'stale_observation' };
  if (scan.status !== 'observed' && scan.status !== 'decided') {
    return { kind: 'error', status: 409, error: 'scan_not_ready' };
  }

  const at = now();
  db.query(`
    INSERT INTO decisions
      (id, scan_id, observation_id, org_id, question_id, kind, payload_json,
       confidence, confidence_source, model_id, model_version, runtime,
       model_sha256, latency_ms, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recorded', ?, ?)
  `).run(
    decisionId, scan.id, observation.id, scan.org_id, input.question_id, input.kind, payload,
    input.confidence, input.confidence_source, input.model.id, input.model.version,
    input.model.runtime, input.model.sha256 ?? null, input.latency_ms, at, at,
  );
  audit({
    entity_type: 'TypedDecision', entity_id: decisionId, org_id: scan.org_id,
    actor_kind: 'system', actor_id: 'decision-api',
    from_status: null, to_status: 'recorded', request_id: decisionId,
    payload: {
      scan_id: scan.id, observation_id: observation.id, question_id: input.question_id,
      kind: input.kind, confidence: input.confidence, confidence_source: input.confidence_source,
      reported_model: input.model, latency_ms: input.latency_ms,
      evidence_trust: 'client_reported_unverified',
    },
  });
  if (scan.status === 'observed') {
    const next = fishScanMachine.transition('observed', 'decided');
    db.query('UPDATE fish_scans SET status = ?, updated_at = ? WHERE id = ?').run(next, at, scan.id);
    audit({
      entity_type: 'FishScan', entity_id: scan.id, org_id: scan.org_id,
      actor_kind: 'system', actor_id: 'decision-api',
      from_status: 'observed', to_status: next, request_id: decisionId,
      payload: { decision_id: decisionId, observation_id: observation.id },
    });
  }
  return { kind: 'created', row: stored(decisionId)! };
}

export async function postDecision(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_input', issues: [{ path: [], message: 'Expected a JSON object' }] }, 400);
  }
  const parsed = TypedDecisionInputSchema.safeParse(body);
  if (!parsed.success) {
    return json({
      error: 'invalid_input',
      issues: parsed.error.issues.map(({ path, message, code }) => ({ path, message, code })),
    }, 400);
  }
  if (!parsed.data.decision_id) {
    return json({ error: 'invalid_input', issues: [{ path: ['decision_id'], message: 'Stable decision_id is required' }] }, 400);
  }
  const payload = JSON.stringify(parsed.data);
  const result = db.transaction(() => insert(parsed.data, payload))();
  if (result.kind === 'error') return json({ error: result.error, ...(result.issues ? { issues: result.issues } : {}) }, result.status);
  return json({
    typed_decision: wire(result.row),
    replayed: result.kind === 'replayed',
    evidence_trust: 'client_reported_unverified',
  }, result.kind === 'replayed' ? 200 : 201);
}

export function getDecision(decisionId: string): Response {
  const decision = stored(decisionId);
  return decision
    ? json({ typed_decision: wire(decision), evidence_trust: 'client_reported_unverified' })
    : json({ error: 'decision_not_found' }, 404);
}

export const decisionRoutes = {
  '/v1/decisions': {
    POST: postDecision,
    OPTIONS: options,
  },
  '/v1/decisions/:id': {
    GET: (request: Request & { params: { id: string } }) => getDecision(request.params.id),
    OPTIONS: options,
  },
};
