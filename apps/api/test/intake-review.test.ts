import { expect, test } from 'bun:test';
import { createStubBackend } from '../../../packages/decision/src/stub';
import { seedDemoData } from '../../../scripts/seed';

process.env.DB_PATH = ':memory:';
const { db } = await import('../src/db');
const { postObservation } = await import('../src/routes/observations');
const { postDecision } = await import('../src/routes/decisions');
const { postLot, postPublish, getLot } = await import('../src/routes/lot-service');
const { postLotReview } = await import('../src/routes/review');
const request = (body: unknown) => new Request('http://localhost/v1/demo', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('seeded intake reviewer can complete a new manual-scale landing without changing original evidence', async () => {
  await seedDemoData(db);
  const scanId = crypto.randomUUID();
  const saved = await postObservation(request({
    scan_id: scanId, captured_at: '2026-09-26T00:00:00.000Z',
    image_ref: 'demo:synthetic-intake-test', source: 'manual',
    length_mm: 412, girth_mm: null, weight_g: 1480, ice_temp_c: null,
    species_candidates: [], species_label: 'sanma', species_confirmed_by: 'demo-intake-operator',
    scale_reading: { stable: false, grams: null },
  }));
  expect(saved.status).toBe(201);
  const { observation } = await saved.json();
  const decision = await createStubBackend().decide(observation, 'grade');
  expect((await postDecision(request(decision))).status).toBe(201);
  const created = await postLot(db, request({ scan_id: scanId, decision_id: decision.decision_id, price_jpy: 2400 }));
  expect(created.status).toBe(201);
  const { lot } = await created.json();
  expect(lot.status).toBe('pending_review');
  expect(postPublish(db, lot.id).status).toBe(409);
  const correction = { field: 'scale_grams', human_value: 1480, reason: 'Synthetic scale fixture checked for this test.', attest: true };
  // The board-fixture operator cannot cross the intake organization boundary.
  expect((await postLotReview(db, lot.id, request({ ...correction, actor_id: 'demo-operator' }))).status).toBe(403);
  expect((await postLotReview(db, lot.id, request({ ...correction, actor_id: 'unprovisioned-person' }))).status).toBe(403);
  const grams = await postLotReview(db, lot.id, request({ ...correction, actor_id: 'demo-intake-operator' }));
  expect(grams.status).toBe(200);
  expect((await grams.json()).human_approved).toBe(false);
  expect(postPublish(db, lot.id).status).toBe(409);
  const stable = await postLotReview(db, lot.id, request({ ...correction, field: 'scale_stable', human_value: true, actor_id: 'demo-intake-operator' }));
  expect(stable.status).toBe(200);
  expect((await stable.json()).human_approved).toBe(true);
  expect(postPublish(db, lot.id).status).toBe(201);
  const detail = await getLot(db, lot.id).json();
  expect(detail.observation.scale_reading).toEqual({ stable: false, grams: null });
  expect(detail.typed_decision.noul_value).toBe(false);
  expect(detail.corrections).toHaveLength(2);
  expect(detail.corrections.every((item: { actor_id: string }) => item.actor_id === 'demo-intake-operator')).toBe(true);
  expect(detail.lot.status).toBe('listed');
});
