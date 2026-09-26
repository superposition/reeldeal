import { gate, type ObservationInput, type TypedDecisionInput } from '../../../../packages/domain/src/index';

const observation: ObservationInput = {
  scan_id: 'preview-scan-1',
  captured_at: '2026-09-26T00:00:00Z',
  image_ref: 'preview-only',
  source: 'webcam',
  length_mm: 412,
  girth_mm: 210,
  weight_g: 1480,
  ice_temp_c: -1.5,
  species_candidates: [{ label: 'sanma', score: 0.81 }, { label: 'saba', score: 0.12 }],
  species_label: 'sanma',
  species_confirmed_by: 'preview-operator',
  scale_reading: { stable: true, grams: 1478 },
};

const base = {
  scan_id: observation.scan_id,
  observation_id: 'preview-observation-1',
  choice: null,
  score: null,
  score_raw: null,
  score_level: null,
  noul_value: null,
  noul_probability: null,
  latency_ms: 12,
  rationale: 'Static preview only.',
  model: { id: 'reeldeal-stub', version: '1', runtime: 'js', sha256: null },
} as const;

const confidentChoice: TypedDecisionInput = {
  ...base,
  decision_id: 'preview-choice',
  question_id: 'grade',
  kind: 'choice',
  choice: 'medium',
  confidence: 0.84,
  confidence_source: 'stub_heuristic',
};

const uncertainScore: TypedDecisionInput = {
  ...base,
  decision_id: 'preview-score',
  question_id: 'quality',
  kind: 'score',
  score_raw: 2.7,
  score: 0.675,
  score_level: 3,
  confidence: 0.7,
  confidence_source: 'stub_heuristic',
};

const falseCompleteness: TypedDecisionInput = {
  ...base,
  decision_id: 'preview-completeness',
  question_id: 'completeness',
  kind: 'noul',
  noul_value: false,
  noul_probability: 0,
  confidence: 1,
  confidence_source: 'policy_required_input',
  model: { id: 'reeldeal-policy', version: '1', runtime: 'js', sha256: null },
  latency_ms: 0,
};

export const decisionCardFixtures = [
  { label: 'Confident choice', decision: confidentChoice, outcome: gate(confidentChoice, observation) },
  { label: 'Uncertain score', decision: uncertainScore, outcome: gate(uncertainScore, observation) },
  { label: 'False completeness answer', decision: falseCompleteness,
    outcome: gate(falseCompleteness, { ...observation, weight_g: null }) },
] as const;
