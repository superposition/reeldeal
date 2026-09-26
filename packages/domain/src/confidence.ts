/** These values describe answer concentration or a transparent rule, not fish-market accuracy. */
export type ConfidenceSource =
  | 'laya_entropy'
  | 'laya_noul_probability'
  | 'stub_heuristic'
  | 'policy_required_input';

export function unitInterval(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('value must be finite and between 0 and 1');
  }
  return value;
}

/** Laya choice/score: 1 - normalized Shannon entropy of the option distribution. */
export function layaEntropyConfidence(probabilities: readonly number[]) {
  if (probabilities.length < 2) throw new RangeError('at least two probabilities required');
  const sum = probabilities.reduce((total, probability) => total + unitInterval(probability), 0);
  if (Math.abs(sum - 1) > 1e-6) throw new RangeError('probabilities must sum to one');
  const entropy = -probabilities.reduce(
    (total, probability) => total + (probability === 0 ? 0 : probability * Math.log(probability)), 0,
  );
  const confidence = Math.min(1, Math.max(0, 1 - entropy / Math.log(probabilities.length)));
  return { confidence, confidence_source: 'laya_entropy' as const };
}

/** Laya noul is binary P(true); its confidence is the probability of the reported answer. */
export function layaNoulConfidence(probabilityTrue: number) {
  const probability = unitInterval(probabilityTrue);
  return {
    noul_value: probability >= 0.5,
    noul_probability: probability,
    confidence: Math.max(probability, 1 - probability),
    confidence_source: 'laya_noul_probability' as const,
  };
}

/**
 * Version 1 stub rule. Candidate score contributes up to 0.30, a stable scale 0.05,
 * and 0.55 is the base. The forced-review demo value is 0.70. This is deliberately
 * labelled a heuristic and is not comparable to Laya's model concentration.
 */
export function stubHeuristicConfidence(input: {
  topSpeciesScore: number | null;
  scaleStable: boolean;
  forceReview?: boolean;
}) {
  const topScore = input.topSpeciesScore === null ? 0 : unitInterval(input.topSpeciesScore);
  const confidence = input.forceReview
    ? 0.7
    : Math.round((0.55 + 0.3 * topScore + (input.scaleStable ? 0.05 : 0)) * 1_000) / 1_000;
  return { confidence, confidence_source: 'stub_heuristic' as const };
}

/** Known incompleteness is certain as a policy fact, not a fish-quality estimate. */
export function missingRequiredInputConfidence() {
  return {
    noul_value: false,
    noul_probability: 0,
    confidence: 1,
    confidence_source: 'policy_required_input' as const,
  };
}
