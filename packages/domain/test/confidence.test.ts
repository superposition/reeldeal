import { expect, test } from 'bun:test';
import {
  layaEntropyConfidence,
  layaNoulConfidence,
  missingRequiredInputConfidence,
  stubHeuristicConfidence,
} from '../src/confidence';

test('Laya choice and score use normalized entropy', () => {
  expect(layaEntropyConfidence([0.5, 0.5])).toEqual({ confidence: 0, confidence_source: 'laya_entropy' });
  expect(layaEntropyConfidence([1, 0])).toEqual({ confidence: 1, confidence_source: 'laya_entropy' });
  const result = layaEntropyConfidence([0.8, 0.2]);
  expect(result.confidence).toBeCloseTo(1 - (-(0.8 * Math.log(0.8) + 0.2 * Math.log(0.2))) / Math.log(2));
  expect(() => layaEntropyConfidence([0.8, 0.3])).toThrow('sum to one');
  expect(() => layaEntropyConfidence([1])).toThrow('at least two');
  expect(() => layaEntropyConfidence([Number.NaN, 1])).toThrow('between 0 and 1');
});

test('Laya noul uses probability of the reported binary answer', () => {
  expect(layaNoulConfidence(0.9)).toEqual({
    noul_value: true, noul_probability: 0.9, confidence: 0.9,
    confidence_source: 'laya_noul_probability',
  });
  expect(layaNoulConfidence(0.1)).toEqual({
    noul_value: false, noul_probability: 0.1, confidence: 0.9,
    confidence_source: 'laya_noul_probability',
  });
  expect(() => layaNoulConfidence(Infinity)).toThrow('between 0 and 1');
});

test('stub heuristic is explicit and remains a heuristic', () => {
  expect(stubHeuristicConfidence({ topSpeciesScore: 0.8, scaleStable: true })).toEqual({
    confidence: 0.84, confidence_source: 'stub_heuristic',
  });
  expect(stubHeuristicConfidence({ topSpeciesScore: 0.8, scaleStable: true, forceReview: true })).toEqual({
    confidence: 0.7, confidence_source: 'stub_heuristic',
  });
  expect(() => stubHeuristicConfidence({ topSpeciesScore: 1.1, scaleStable: true })).toThrow('between 0 and 1');
});

test('missing-input policy is a known false completeness result', () => {
  expect(missingRequiredInputConfidence()).toEqual({
    noul_value: false, noul_probability: 0, confidence: 1,
    confidence_source: 'policy_required_input',
  });
});
