import { describe, expect, test } from 'bun:test';
import { LAYA_MODEL } from '@reeldeal/decision';
import { layaEntropyConfidence } from '@reeldeal/domain';

process.env.DB_PATH = ':memory:';
const { db } = await import('../src/db');
const { postObservation, getObservation } = await import('../src/routes/observations');
const { getDecision, postDecision } = await import('../src/routes/decisions');

const observationInput = (scanId: string, weight = 1480) => ({
  scan_id: scanId,
  captured_at: '2026-09-26T02:00:00.000Z',
  image_ref: 'data:image/jpeg;base64,AA==',
  source: 'webcam' as const,
  length_mm: 412,
  girth_mm: null,
  weight_g: weight,
  ice_temp_c: null,
  species_candidates: [{ label: 'sanma', score: 0.9 }],
  species_label: 'sanma',
  species_confirmed_by: 'operator-demo',
  scale_reading: { stable: true, grams: weight },
});

async function observed(weight = 1480) {
  const scanId = crypto.randomUUID();
  const response = await postObservation(new Request('http://localhost/v1/observations', {
    method: 'POST', body: JSON.stringify(observationInput(scanId, weight)),
  }));
  expect(response.status).toBe(201);
  const { observation } = await getObservation(scanId).json();
  return { scanId, observation };
}

function choice(scanId: string, observationId: string) {
  return {
    decision_id: `stub:${scanId}:${observationId}:grade:v1`,
    scan_id: scanId,
    observation_id: observationId,
    question_id: 'grade',
    kind: 'choice' as const,
    choice: 'medium',
    score: null, score_raw: null, score_level: null,
    noul_value: null, noul_probability: null,
    confidence: 0.85,
    confidence_source: 'stub_heuristic' as const,
    model: { id: 'reeldeal-stub', version: 'rules-v1', runtime: 'js', sha256: null },
    latency_ms: 0,
    rationale: 'Measured weight bracket; advisory demo rule.',
  };
}

function request(body: unknown): Request {
  return new Request('http://localhost/v1/decisions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function count(sql: string, id: string): number {
  return (db.query(sql).get(id) as { n: number }).n;
}

describe('immutable typed decision API', () => {
  test('create, GET, exact replay and conflicting retry preserve one row and one decision audit', async () => {
    const { scanId, observation } = await observed();
    const input = choice(scanId, observation.id);
    const first = await postDecision(request(input));
    expect(first.status).toBe(201);
    const created = await first.json();
    expect(created.replayed).toBe(false);
    expect(created.evidence_trust).toBe('client_reported_unverified');
    expect(created.typed_decision.id).toBe(input.decision_id);
    expect(created.typed_decision.observation_id).toBe(observation.id);
    expect(created.typed_decision.model).toEqual(input.model);
    expect(created.typed_decision.status).toBe('recorded');

    const fetched = await getDecision(input.decision_id).json();
    expect(fetched.typed_decision).toEqual(created.typed_decision);

    const retry = await postDecision(request({ ...input, model: { ...input.model } }));
    expect(retry.status).toBe(200);
    expect((await retry.json()).replayed).toBe(true);
    const changed = await postDecision(request({ ...input, rationale: 'Changed answer' }));
    expect(changed.status).toBe(409);
    expect((await changed.json()).error).toBe('decision_id_conflict');

    expect(count('SELECT COUNT(*) AS n FROM decisions WHERE id = ?', input.decision_id)).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'TypedDecision' AND entity_id = ?", input.decision_id)).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'FishScan' AND entity_id = ? AND to_status = 'decided'", scanId)).toBe(1);
    expect((db.query('SELECT status FROM fish_scans WHERE id = ?').get(scanId) as { status: string }).status).toBe('decided');
    const decisionAudit = db.query("SELECT actor_kind, actor_id, payload_json FROM audit_log WHERE entity_type = 'TypedDecision' AND entity_id = ?")
      .get(input.decision_id) as { actor_kind: string; actor_id: string; payload_json: string };
    expect(decisionAudit.actor_kind).toBe('system');
    expect(decisionAudit.actor_id).toBe('decision-api');
    expect(JSON.parse(decisionAudit.payload_json).evidence_trust).toBe('client_reported_unverified');
  });

  test('invalid typed fields and missing stable ID return paths and write no decision', async () => {
    const { scanId, observation } = await observed();
    const input = choice(scanId, observation.id);
    for (const invalid of [
      { ...input, decision_id: undefined },
      { ...input, choice: null },
      { ...input, kind: 'score', score_raw: 2.5, score: 0.8, score_level: 3, choice: null },
      { ...input, confidence_source: 'laya_entropy', model: { ...input.model, sha256: null } },
      { ...input, confidence_source: 'laya_entropy', model: { id: LAYA_MODEL.id, version: LAYA_MODEL.variant, runtime: 'wasm', sha256: 'a'.repeat(64) } },
      { ...input, model: { ...input.model, version: '' } },
    ]) {
      const response = await postDecision(request(invalid));
      expect(response.status).toBe(400);
      expect((await response.json()).issues.length).toBeGreaterThan(0);
    }
    const malformed = await postDecision(new Request('http://localhost/v1/decisions', { method: 'POST', body: '{' }));
    expect(malformed.status).toBe(400);
    expect(count('SELECT COUNT(*) AS n FROM decisions WHERE scan_id = ?', scanId)).toBe(0);
    expect((db.query('SELECT status FROM fish_scans WHERE id = ?').get(scanId) as { status: string }).status).toBe('observed');
  });

  test('unknown, mismatched and stale observation references never create a decision', async () => {
    const first = await observed();
    const second = await observed();
    const input = choice(first.scanId, first.observation.id);
    expect((await postDecision(request({ ...input, scan_id: 'missing-scan' }))).status).toBe(404);
    expect((await postDecision(request({ ...input, observation_id: 'missing-observation' }))).status).toBe(404);
    const mismatch = await postDecision(request({ ...input, observation_id: second.observation.id }));
    expect(mismatch.status).toBe(409);
    expect((await mismatch.json()).error).toBe('observation_scan_mismatch');

    const updated = await postObservation(new Request('http://localhost/v1/observations', {
      method: 'POST', body: JSON.stringify(observationInput(first.scanId, 1490)),
    }));
    expect(updated.status).toBe(201);
    const stale = await postDecision(request(input));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe('stale_observation');
    expect(count('SELECT COUNT(*) AS n FROM decisions WHERE scan_id = ?', first.scanId)).toBe(0);
  });

  test('score, binary noul and Laya metadata remain typed in the immutable JSON', async () => {
    const scoreObs = await observed();
    const score = {
      ...choice(scoreObs.scanId, scoreObs.observation.id),
      question_id: 'quality', decision_id: `score:${scoreObs.scanId}`,
      kind: 'score', choice: null, score_raw: 2.7, score: 0.675, score_level: 3,
      probabilities: [0.1, 0.2, 0.4, 0.2, 0.1],
      confidence_source: 'laya_entropy',
      confidence: layaEntropyConfidence([0.1, 0.2, 0.4, 0.2, 0.1]).confidence,
      model: { id: LAYA_MODEL.id, version: LAYA_MODEL.variant, runtime: 'wasm', sha256: LAYA_MODEL.weights.sha256 },
      latency_ms: 128,
    };
    const scoreResponse = await postDecision(request(score));
    expect(scoreResponse.status).toBe(201);
    const scoreWire = (await scoreResponse.json()).typed_decision;
    expect(scoreWire.score_raw).toBe(2.7);
    expect(scoreWire.score).toBe(0.675);
    expect(scoreWire.probabilities).toEqual(score.probabilities);
    const persisted = db.query('SELECT payload_json, model_sha256, runtime FROM decisions WHERE id = ?').get(score.decision_id) as
      { payload_json: string; model_sha256: string; runtime: string };
    expect(JSON.parse(persisted.payload_json).probabilities).toEqual(score.probabilities);
    expect(persisted.model_sha256).toBe(score.model.sha256);
    expect(persisted.runtime).toBe('wasm');
    expect((await postDecision(request(score))).status).toBe(200);
    const changedPinRetry = await postDecision(request({ ...score, model: { ...score.model, sha256: 'a'.repeat(64) } }));
    expect(changedPinRetry.status).toBe(409);
    const badConfidence = await postDecision(request({ ...score, decision_id: `bad-score:${scoreObs.scanId}`, confidence: 0.99 }));
    expect(badConfidence.status).toBe(400);

    const noulObs = await observed();
    const noul = {
      ...choice(noulObs.scanId, noulObs.observation.id),
      decision_id: `policy:${noulObs.scanId}`, question_id: 'completeness',
      kind: 'noul', choice: null, noul_value: false, noul_probability: 0,
      confidence: 1, confidence_source: 'policy_required_input',
      model: { id: 'reeldeal-policy', version: 'v1', runtime: 'js', sha256: null },
    };
    const noulResponse = await postDecision(request(noul));
    expect(noulResponse.status).toBe(201);
    expect((await noulResponse.json()).typed_decision.noul_value).toBe(false);
    expect((await getDecision('missing-id')).status).toBe(404);
  });
});
