import type { GateResult, ObservationInput, TypedDecisionInput } from '../../../../packages/domain/src/index';

export type ReviewCorrection = {
  id: string;
  field: string;
  model_value: string | number | boolean | null;
  human_value: string | number | boolean | null;
  reason: string;
  actor_id: string;
  created_at: string;
  human_supplied: true;
};

export type ReviewSnapshot = {
  lot: { id: string; scan_id: string; status: string; gate_reason: string | null };
  original_observation: ObservationInput;
  effective_observation: ObservationInput;
  original_decision: TypedDecisionInput;
  original_gate: GateResult;
  corrections: ReviewCorrection[];
};

export const gateReasonWords: Record<string, string> = {
  low_decision_confidence: 'The answer is below the 80% automatic-approval threshold.',
  noul: 'The required-facts answer is no. A high-confidence no still needs review.',
  missing_measurements: 'A required measurement or stable scale reading is missing or inconsistent.',
  unconfirmed_species: 'An operator has not confirmed the species.',
  low_species_confidence: 'The species hint is too weak for automatic approval.',
  conflicting_species: 'The species hints conflict with each other or the operator label.',
};
