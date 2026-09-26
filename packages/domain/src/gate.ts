import type { ObservationInput, TypedDecisionInput } from './entities';

export const GATE = {
  version: '1',
  uncertaintyMin: 0.6,
  confidenceMin: 0.8,
  speciesMin: 0.6,
  speciesMargin: 0.1,
  requireScaleStable: true,
  scaleToleranceG: 20,
  scaleToleranceFraction: 0.05,
} as const;

export type GateReason =
  | 'noul'
  | 'missing_measurements'
  | 'unconfirmed_species'
  | 'low_decision_confidence'
  | 'low_species_confidence'
  | 'conflicting_species';
export type GateResult =
  | { route: 'auto_approve'; reason: 'ok' }
  | { route: 'pending_review'; reason: GateReason };

type GateObservation = Pick<ObservationInput,
  'length_mm' | 'weight_g' | 'scale_reading' | 'species_label' | 'species_confirmed_by' | 'species_candidates'>;
type GateDecision = Pick<TypedDecisionInput, 'kind' | 'question_id' | 'noul_value' | 'confidence'>;

/** The display band keeps [0.60, 0.80) distinct from lower confidence. */
export function confidenceBand(confidence: number): 'low' | 'uncertain' | 'eligible' {
  if (!Number.isFinite(confidence) || confidence < GATE.uncertaintyMin) return 'low';
  if (confidence < GATE.confidenceMin) return 'uncertain';
  return confidence <= 1 ? 'eligible' : 'low';
}

/** Pure policy; the API recomputes this result from its persisted observation and decision. */
export function gate(decision: GateDecision, observation: GateObservation): GateResult {
  const review = (reason: GateReason): GateResult => ({ route: 'pending_review', reason });

  // A false binary proposition, especially the required-input preflight, is not an abstention.
  if (decision.kind === 'noul' && decision.noul_value !== true) return review('noul');

  const { length_mm: length, weight_g: weight, scale_reading: scale } = observation;
  if (!Number.isFinite(length) || !Number.isFinite(weight) ||
      length === null || weight === null || length <= 0 || weight <= 0 ||
      !scale || (GATE.requireScaleStable && !scale.stable) ||
      !Number.isFinite(scale.grams) || scale.grams === null || scale.grams <= 0) {
    return review('missing_measurements');
  }
  const maxScaleDifference = Math.max(GATE.scaleToleranceG, GATE.scaleToleranceFraction * weight);
  if (Math.abs(scale.grams - weight) > maxScaleDifference) return review('missing_measurements');

  if (!observation.species_label?.trim() || !observation.species_confirmed_by?.trim()) {
    return review('unconfirmed_species');
  }

  const candidates = [...observation.species_candidates].sort((a, b) => b.score - a.score);
  const [top, second] = candidates;
  if (!top || !Number.isFinite(top.score) || top.score < GATE.speciesMin) {
    return review('low_species_confidence');
  }
  if ((second && (!Number.isFinite(second.score) || top.score - second.score <= GATE.speciesMargin + 1e-9)) ||
      top.label.trim().toLowerCase() !== observation.species_label.trim().toLowerCase()) {
    return review('conflicting_species');
  }

  if (confidenceBand(decision.confidence) !== 'eligible') return review('low_decision_confidence');
  return { route: 'auto_approve', reason: 'ok' };
}
