import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import {
  GATE, ObservationInputSchema, TypedDecisionInputSchema, gate, lotMachine,
  type ObservationInput, type TypedDecisionInput,
} from '../../../../packages/domain/src/index';
import { json } from './stub';

const CorrectionRequest = z.strictObject({
  field: z.enum(['length_mm', 'weight_g', 'scale_stable', 'scale_grams', 'species_label']),
  human_value: z.union([z.number().finite(), z.boolean(), z.string().min(1).max(80)]),
  reason: z.string().trim().min(8).max(500),
  actor_id: z.string().trim().min(1),
  attest: z.literal(true),
}).superRefine(({ field, human_value }, context) => {
  const numerical = field === 'length_mm' || field === 'weight_g' || field === 'scale_grams';
  if (numerical && (typeof human_value !== 'number' || human_value <= 0 || human_value > (field === 'length_mm' ? 2000 : 200000))) {
    context.addIssue({ code: 'custom', path: ['human_value'], message: `Enter a positive ${field === 'length_mm' ? 'length up to 2000 mm' : 'weight up to 200000 g'}.` });
  }
  if (field === 'scale_stable' && typeof human_value !== 'boolean') {
    context.addIssue({ code: 'custom', path: ['human_value'], message: 'Enter true or false for scale stability.' });
  }
  if (field === 'species_label' && (typeof human_value !== 'string' || !human_value.trim())) {
    context.addIssue({ code: 'custom', path: ['human_value'], message: 'Enter an operator-confirmed species label.' });
  }
});

type ReviewField = z.infer<typeof CorrectionRequest>['field'];
type CorrectionRow = { id: string; field: string; model_value: string | null; human_value: string; reason: string; actor_id: string; created_at: number };
type JoinedLot = {
  id: string; org_id: string; scan_id: string; decision_id: string; status: string; gate_reason: string | null;
  observation_payload: string; decision_payload: string; observation_id: string;
};

function originalObservation(payload: string): ObservationInput {
  const raw = JSON.parse(payload) as Record<string, unknown>;
  // A stored observation may contain wire metadata or only the input payload.
  return ObservationInputSchema.parse({
    scan_id: raw.scan_id, captured_at: raw.captured_at, image_ref: raw.image_ref,
    source: raw.source, length_mm: raw.length_mm, girth_mm: raw.girth_mm,
    weight_g: raw.weight_g, ice_temp_c: raw.ice_temp_c,
    species_candidates: raw.species_candidates, species_label: raw.species_label,
    species_confirmed_by: raw.species_confirmed_by, scale_reading: raw.scale_reading,
  });
}

function readLot(db: Database, lotId: string): JoinedLot | null {
  return db.query(`SELECT l.id, l.org_id, l.scan_id, l.decision_id, l.status, l.gate_reason,
      o.id AS observation_id, o.payload_json AS observation_payload, d.payload_json AS decision_payload
    FROM lots l JOIN decisions d ON d.id = l.decision_id
    JOIN observations o ON o.id = d.observation_id
    WHERE l.id = ? AND d.scan_id = l.scan_id AND o.scan_id = l.scan_id`).get(lotId) as JoinedLot | null;
}

function readCorrections(db: Database, lotId: string): CorrectionRow[] {
  return db.query(`SELECT id, field, model_value, human_value, reason, actor_id, created_at
    FROM corrections WHERE lot_id = ? ORDER BY created_at, rowid`).all(lotId) as CorrectionRow[];
}

function valueAt(observation: ObservationInput, field: ReviewField): string | number | boolean | null {
  if (field === 'scale_stable') return observation.scale_reading.stable;
  if (field === 'scale_grams') return observation.scale_reading.grams;
  return observation[field] ?? null;
}

function applyCorrection(observation: ObservationInput, field: string, value: unknown, actorId: string): ObservationInput {
  if (field === 'length_mm' && typeof value === 'number') return { ...observation, length_mm: value };
  if (field === 'weight_g' && typeof value === 'number') return { ...observation, weight_g: value };
  if (field === 'scale_stable' && typeof value === 'boolean') return { ...observation, scale_reading: { ...observation.scale_reading, stable: value } };
  if (field === 'scale_grams' && typeof value === 'number') return { ...observation, scale_reading: { ...observation.scale_reading, grams: value } };
  if (field === 'species_label' && typeof value === 'string') {
    return { ...observation, species_label: value.trim(), species_confirmed_by: actorId };
  }
  return observation;
}

function effectiveObservation(original: ObservationInput, corrections: CorrectionRow[]): ObservationInput {
  let effective = original;
  for (const correction of corrections) effective = applyCorrection(effective, correction.field, JSON.parse(correction.human_value), correction.actor_id);
  return ObservationInputSchema.parse(effective);
}

/** The reviewer can override a model hold, never missing or contradictory facts. */
export function reviewFacts(observation: ObservationInput): string | null {
  const { length_mm: length, weight_g: weight, scale_reading: scale } = observation;
  if (length === null || weight === null || length <= 0 || weight <= 0 || !scale.stable ||
      scale.grams === null || scale.grams <= 0 ||
      Math.abs(scale.grams - weight) > Math.max(GATE.scaleToleranceG, GATE.scaleToleranceFraction * weight)) {
    return 'missing_measurements';
  }
  if (!observation.species_label?.trim() || !observation.species_confirmed_by?.trim()) return 'unconfirmed_species';
  return null;
}

function audit(db: Database, entry: {
  entityType: string; entityId: string; orgId: string; actorId: string;
  fromStatus: string | null; toStatus: string | null; requestId: string; payload: unknown;
}, at: number): void {
  db.query(`INSERT INTO audit_log (id,entity_type,entity_id,org_id,actor_kind,actor_id,from_status,to_status,request_id,payload_json,at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), entry.entityType, entry.entityId, entry.orgId, 'user', entry.actorId,
    entry.fromStatus, entry.toStatus, entry.requestId, JSON.stringify(entry.payload), at,
  );
}

function snapshot(db: Database, lot: JoinedLot) {
  const observation = originalObservation(lot.observation_payload);
  const typedDecision = TypedDecisionInputSchema.parse(JSON.parse(lot.decision_payload)) as TypedDecisionInput;
  const corrections = readCorrections(db, lot.id);
  return {
    lot: { id: lot.id, scan_id: lot.scan_id, status: lot.status, gate_reason: lot.gate_reason },
    original_observation: observation,
    effective_observation: effectiveObservation(observation, corrections),
    original_decision: typedDecision,
    original_gate: gate(typedDecision, observation),
    corrections: corrections.map((row) => ({
      id: row.id, field: row.field,
      model_value: row.model_value === null ? null : JSON.parse(row.model_value),
      human_value: JSON.parse(row.human_value), reason: row.reason, actor_id: row.actor_id,
      created_at: new Date(row.created_at).toISOString(), human_supplied: true,
    })),
  };
}

export function getLotReview(db: Database, lotId: string): Response {
  const lot = readLot(db, lotId);
  return lot ? json({ review: snapshot(db, lot) }) : json({ error: 'lot_not_found' }, 404);
}

export async function postLotReview(db: Database, lotId: string, request: Request): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'invalid_input', issues: [{ path: [], message: 'Expected JSON' }] }, 400); }
  const parsed = CorrectionRequest.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid_input', issues: parsed.error.issues.map(({ path, message }) => ({ path, message })) }, 400);
  }
  const correction = parsed.data;
  const reviewer = db.query(`SELECT id, org_id, role, status FROM users WHERE id = ?`).get(correction.actor_id) as
    { id: string; org_id: string; role: string; status: string } | null;
  const initial = readLot(db, lotId);
  if (!initial) return json({ error: 'lot_not_found' }, 404);
  // Demo role check, not identity authentication. A public production deployment
  // needs a real session before accepting this actor_id as the caller.
  if (!reviewer || reviewer.org_id !== initial.org_id || reviewer.status !== 'active' || !['operator', 'seller'].includes(reviewer.role)) {
    return json({ error: 'reviewer_not_authorized' }, 403);
  }
  if (initial.status !== 'pending_review') return json({ error: 'not_pending_review' }, 409);

  const result = db.transaction(() => {
    const lot = readLot(db, lotId);
    if (!lot || lot.status !== 'pending_review') return { conflict: true } as const;
    const original = originalObservation(lot.observation_payload);
    const decision = TypedDecisionInputSchema.parse(JSON.parse(lot.decision_payload));
    const existing = readCorrections(db, lotId);
    const before = effectiveObservation(original, existing);
    const priorValue = valueAt(original, correction.field);
    const currentValue = valueAt(before, correction.field);
    if (JSON.stringify(currentValue) === JSON.stringify(correction.human_value)) return { unchanged: true } as const;

    const at = Date.now();
    const correctionId = crypto.randomUUID();
    const after = applyCorrection(before, correction.field, correction.human_value, correction.actor_id);
    const validAfter = ObservationInputSchema.parse(after);
    const remaining = reviewFacts(validAfter);
    const originalGate = gate(decision, original);
    // Human attestation may clear a heuristic/required-input hold, but not a
    // negative model proposition unrelated to missing required input.
    const answerHold = decision.kind === 'noul' && decision.noul_value === false && decision.confidence_source !== 'policy_required_input';
    const remainingReason = remaining ?? (answerHold ? 'noul' : null);
    const approved = remainingReason === null;

    db.query(`INSERT INTO corrections (id,scan_id,lot_id,org_id,field,model_value,human_value,reason,actor_id,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      correctionId, lot.scan_id, lot.id, lot.org_id, correction.field,
      JSON.stringify(priorValue), JSON.stringify(correction.human_value), correction.reason, correction.actor_id,
      'applied', at, at,
    );
    audit(db, {
      entityType: 'Correction', entityId: correctionId, orgId: lot.org_id, actorId: correction.actor_id,
      fromStatus: null, toStatus: 'applied', requestId: correctionId,
      payload: { lot_id: lot.id, field: correction.field, model_value: priorValue,
        human_value: correction.human_value, reason: correction.reason,
        original_gate: originalGate, remaining_reason: remainingReason, human_attestation: true },
    }, at);
    if (approved) {
      const status = lotMachine.transition('pending_review', 'approved');
      db.query('UPDATE lots SET status = ?, gate_reason = NULL, updated_at = ? WHERE id = ?')
        .run(status, at, lot.id);
      audit(db, {
        entityType: 'Lot', entityId: lot.id, orgId: lot.org_id, actorId: correction.actor_id,
        fromStatus: 'pending_review', toStatus: status, requestId: correctionId,
        payload: { human_approved: true, original_decision_id: lot.decision_id,
          original_gate: originalGate, corrected_field: correction.field, reason: correction.reason },
      }, at);
    } else {
      db.query('UPDATE lots SET gate_reason = ?, updated_at = ? WHERE id = ?')
        .run(remainingReason, at, lot.id);
    }
    return { approved, correctionId, review: snapshot(db, readLot(db, lot.id)!) } as const;
  })();
  if ('conflict' in result) return json({ error: 'not_pending_review' }, 409);
  if ('unchanged' in result) return json({ error: 'no_change' }, 409);
  return json({ lot: result.review.lot, correction: result.review.corrections.at(-1), review: result.review,
    human_approved: result.approved }, 200);
}
