import { expect, test } from 'bun:test';
import { ObservationSchema, TypedDecisionInputSchema } from '@reeldeal/domain';
import { adaptLayaAnswer } from '../src/laya-adapter';

const observation = ObservationSchema.parse({
  id: 'obs-1', org_id: 'org-1', scan_id: 'scan-1',
  created_at: '2026-09-26T00:00:00.000Z', updated_at: '2026-09-26T00:00:00.000Z',
  captured_at: '2026-09-26T00:00:00.000Z', status: 'recorded', source: 'webcam',
  image_ref: 'sample', length_mm: 412, girth_mm: 220, weight_g: 1480, ice_temp_c: 2,
  species_candidates: [{ label: 'saba', score: 0.91 }],
  species_label: 'saba', species_confirmed_by: 'operator-1',
  scale_reading: { stable: true, grams: 1480 },
});

test('choice preserves a normalized distribution and pins model evidence', () => {
  const value = adaptLayaAnswer(observation, 'grade', {
    type: 'choice', choice: 'medium',
    probabilities: { small: 0.1000, medium: 0.8000, large: 0.1001 }, confidence: 0.4,
  }, 128.4);
  expect(TypedDecisionInputSchema.safeParse(value).success).toBe(true);
  expect(value.kind).toBe('choice');
  expect(value.probabilities?.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1);
  expect(value.confidence_source).toBe('laya_entropy');
  expect(value.model.sha256).toHaveLength(64);
});

test('five-level score retains continuous raw expected index', () => {
  const value = adaptLayaAnswer(observation, 'quality', {
    type: 'score', score: 2.375,
    probabilities: { '0': 0.05, '1': 0.1, '2': 0.4, '3': 0.35, '4': 0.1 }, confidence: 0.4,
  }, 130);
  expect(value.score_raw).toBe(2.375);
  expect(value.score).toBe(2.375 / 4);
  expect(value.score_level).toBe(2);
  expect(value.confidence_source).toBe('laya_entropy');
});

test('noul is binary P(true), never null or abstention', () => {
  const value = adaptLayaAnswer(observation, 'price_ok', {
    type: 'noul', noul: 0.2, confidence: 0.8,
  }, 99);
  expect(value.noul_value).toBe(false);
  expect(value.noul_probability).toBe(0.2);
  expect(value.confidence).toBe(0.8);
  expect(value.confidence_source).toBe('laya_noul_probability');
});
