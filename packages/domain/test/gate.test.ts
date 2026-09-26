import { expect, test } from 'bun:test';
import { GATE, confidenceBand, gate } from '../src/gate';

const observation = {
  length_mm: 412,
  weight_g: 1480,
  scale_reading: { stable: true, grams: 1478 },
  species_label: 'sanma',
  species_confirmed_by: 'operator-1',
  species_candidates: [{ label: 'sanma', score: 0.81 }, { label: 'saba', score: 0.12 }],
};
const decision = { kind: 'choice' as const, question_id: 'grade', noul_value: null, confidence: 0.88 };

test('false noul forces review even at confidence 1', () => {
  expect(gate({ ...decision, kind: 'noul', question_id: 'completeness', noul_value: false, confidence: 1 }, observation))
    .toEqual({ route: 'pending_review', reason: 'noul' });
  expect(gate({ ...decision, kind: 'noul', question_id: 'completeness', noul_value: null, confidence: 1 }, observation))
    .toEqual({ route: 'pending_review', reason: 'noul' });
  expect(gate({ ...decision, kind: 'noul', question_id: 'price_ok', noul_value: true, confidence: 0.9 }, observation))
    .toEqual({ route: 'auto_approve', reason: 'ok' });
});

test('missing, unstable, or conflicting measurements force review', () => {
  expect(gate(decision, { ...observation, weight_g: null }).reason).toBe('missing_measurements');
  expect(gate(decision, { ...observation, length_mm: 0 }).reason).toBe('missing_measurements');
  expect(gate(decision, { ...observation, scale_reading: { stable: false, grams: 1478 } }).reason).toBe('missing_measurements');
  expect(gate(decision, { ...observation, scale_reading: { stable: true, grams: 2000 } }).reason).toBe('missing_measurements');
});

test('species needs an attributed operator confirmation', () => {
  expect(gate(decision, { ...observation, species_label: null, species_confirmed_by: null }).reason).toBe('unconfirmed_species');
  expect(gate(decision, { ...observation, species_confirmed_by: null }).reason).toBe('unconfirmed_species');
});

test('weak or conflicting candidate hints force review', () => {
  expect(gate(decision, { ...observation, species_candidates: [{ label: 'sanma', score: 0.59 }] }).reason)
    .toBe('low_species_confidence');
  expect(gate(decision, { ...observation, species_candidates: [{ label: 'sanma', score: 0.6 }] }).route)
    .toBe('auto_approve');
  expect(gate(decision, { ...observation, species_candidates: [{ label: 'sanma', score: 0.81 }, { label: 'saba', score: 0.72 }] }).reason)
    .toBe('conflicting_species');
  expect(gate(decision, { ...observation, species_candidates: [{ label: 'sanma', score: 0.8 }, { label: 'saba', score: 0.7 }] }).reason)
    .toBe('conflicting_species');
  expect(gate(decision, { ...observation, species_label: 'saba' }).reason)
    .toBe('conflicting_species');
});

test('uncertainty band is [0.60, 0.80) and 0.80 is eligible', () => {
  expect(GATE.uncertaintyMin).toBe(0.6);
  expect(GATE.confidenceMin).toBe(0.8);
  expect(confidenceBand(0.59)).toBe('low');
  expect(confidenceBand(0.6)).toBe('uncertain');
  expect(confidenceBand(0.799999)).toBe('uncertain');
  expect(confidenceBand(0.8)).toBe('eligible');
  expect(gate({ ...decision, confidence: 0.6 }, observation).reason).toBe('low_decision_confidence');
  expect(gate({ ...decision, confidence: 0.799999 }, observation).reason).toBe('low_decision_confidence');
  expect(gate({ ...decision, confidence: 0.8 }, observation)).toEqual({ route: 'auto_approve', reason: 'ok' });
  expect(gate({ ...decision, confidence: Number.NaN }, observation).reason).toBe('low_decision_confidence');
});
