import { afterEach, expect, test } from 'bun:test';
import { ObservationSchema, TypedDecisionInputSchema, type Observation } from '@reeldeal/domain';
import questions from '../questions.json';
import { buildState, createStubBackend, stubBackend } from '../src';

const observation = (overrides: Partial<Observation> = {}): Observation => ObservationSchema.parse({
  id: 'obs-1', org_id: 'org-1', scan_id: 'scan-1',
  created_at: '2026-09-26T00:00:00.000Z', updated_at: '2026-09-26T00:00:00.000Z',
  captured_at: '2026-09-26T00:00:00.000Z', status: 'recorded', source: 'webcam',
  image_ref: 'data:image/jpeg;base64,secret-image-data',
  length_mm: 412, girth_mm: 220, weight_g: 1480, ice_temp_c: 2,
  species_candidates: [{ label: 'saba', score: 0.91 }],
  species_label: 'saba', species_confirmed_by: 'operator-1',
  scale_reading: { stable: true, grams: 1480 },
  ...overrides,
});

afterEach(() => { delete process.env.MODEL_FORCE_LOW; });

test('question set uses the vendor choice/score/noul shape', () => {
  expect(questions.grade.type).toBe('choice');
  expect(Object.keys(questions.grade.criteria)).toEqual(['small', 'medium', 'large']);
  expect(questions.quality.type).toBe('score');
  expect(questions.quality.criteria).toHaveLength(5);
  expect(questions.price_ok.type).toBe('noul');
  expect(Object.keys(questions.price_ok.criteria)).toEqual(['false', 'true']);
});

test('state is structured plain text and never embeds camera bytes', () => {
  const state = buildState(observation());
  expect(state).toContain('1480 g');
  expect(state).toContain('Operator-confirmed species');
  expect(state).not.toContain('secret-image-data');
});

test('missing measurement returns false binary noul and review-policy provenance', async () => {
  const answer = await stubBackend.decide(observation({ weight_g: null }));
  expect(TypedDecisionInputSchema.safeParse(answer).success).toBe(true);
  expect(answer.kind).toBe('noul');
  expect(answer.question_id).toBe('completeness');
  expect(answer.noul_value).toBe(false);
  expect(answer.noul_probability).toBe(0);
  expect(answer.confidence_source).toBe('policy_required_input');
  expect(answer.model.id).toBe('reeldeal-policy');
});

test('a contradictory scale and unconfirmed species never get invented', async () => {
  for (const override of [
    { scale_reading: { stable: false, grams: 1480 } },
    { scale_reading: { stable: true, grams: 1200 } },
    { species_label: null, species_confirmed_by: null },
  ]) {
    const answer = await stubBackend.decide(observation(override));
    expect(answer.question_id).toBe('completeness');
    expect(answer.noul_value).toBe(false);
  }
});

test('ordinary stub choice is typed and advisory', async () => {
  const answer = await stubBackend.decide(observation());
  expect(TypedDecisionInputSchema.safeParse(answer).success).toBe(true);
  expect(answer.kind).toBe('choice');
  expect(answer.choice).toBe('medium');
  expect(answer.confidence_source).toBe('stub_heuristic');
  expect(answer.rationale).toContain('not a fish-quality');
  expect(await stubBackend.decide(observation())).toEqual(answer);
});

test('score keeps continuous raw index and normalized value', async () => {
  const answer = await stubBackend.decide(observation(), 'quality');
  expect(TypedDecisionInputSchema.safeParse(answer).success).toBe(true);
  expect(answer.kind).toBe('score');
  expect(answer.score_raw).not.toBeNull();
  expect(answer.score).toBe((answer.score_raw ?? 0) / 4);
  expect(answer.score_level).toBe(Math.round(answer.score_raw ?? 0));
});

test('price_ok is a binary completeness proposition, not a valuation', async () => {
  const answer = await stubBackend.decide(observation(), 'price_ok');
  expect(TypedDecisionInputSchema.safeParse(answer).success).toBe(true);
  expect(answer.kind).toBe('noul');
  expect(answer.noul_value).toBe(true);
  expect(answer.noul_probability).toBeGreaterThan(0.5);
});

test('MODEL_FORCE_LOW=1 forces a complete record into the review band', async () => {
  process.env.MODEL_FORCE_LOW = '1';
  const answer = await createStubBackend().decide(observation());
  expect(answer.confidence).toBeGreaterThanOrEqual(0.6);
  expect(answer.confidence).toBeLessThan(0.8);
  expect(answer.confidence_source).toBe('stub_heuristic');
});
