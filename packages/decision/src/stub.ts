import { ObservationSchema, TypedDecisionInputSchema, type Observation, type TypedDecisionInput } from '@reeldeal/domain';
import { questions, type DecisionBackend, type QuestionId } from './backend';

const RULE_VERSION = 'rules-v1/questions-v1';
// These are fixed demo routing scores, not learned or fish-calibrated probabilities.
const NORMAL_CONFIDENCE = 0.86;
const LOW_CONFIDENCE = 0.7; // Inside the v1 [0.60, 0.80) review band.

export type StubOptions = { forceLow?: boolean };

function requiredFactsComplete(observation: Observation): boolean {
  const { length_mm, weight_g, scale_reading, species_label, species_confirmed_by } = observation;
  if (length_mm === null || length_mm <= 0 || weight_g === null || weight_g <= 0) return false;
  if (!scale_reading.stable || scale_reading.grams === null) return false;
  if (Math.abs(scale_reading.grams - weight_g) > Math.max(50, weight_g * 0.05)) return false;
  if (!species_label || !species_confirmed_by) return false;
  return true;
}

function checked(value: TypedDecisionInput): TypedDecisionInput {
  return TypedDecisionInputSchema.parse(value);
}

function base(observation: Observation, questionId: string, confidence: number): Omit<TypedDecisionInput,
  'kind' | 'choice' | 'score' | 'score_raw' | 'score_level' | 'noul_value' | 'noul_probability' | 'rationale'> {
  return {
    scan_id: observation.scan_id,
    observation_id: observation.id,
    decision_id: `stub:${observation.scan_id}:${observation.id}:${questionId}:${RULE_VERSION}`,
    question_id: questionId,
    confidence,
    confidence_source: 'stub_heuristic',
    model: { id: 'reeldeal-stub', version: RULE_VERSION, runtime: 'js', sha256: null },
    latency_ms: 0,
  };
}

function incomplete(observation: Observation): TypedDecisionInput {
  return checked({
    ...base(observation, 'completeness', 1),
    kind: 'noul', choice: null, score: null, score_raw: null, score_level: null,
    noul_value: false, noul_probability: 0,
    confidence_source: 'policy_required_input',
    model: { id: 'reeldeal-policy', version: RULE_VERSION, runtime: 'js', sha256: null },
    rationale: 'Required measured facts, stable scale, or operator-confirmed species are missing or contradictory; human review required.',
  });
}

function decideComplete(observation: Observation, questionId: QuestionId, confidence: number): TypedDecisionInput {
  const common = base(observation, questionId, confidence);
  if (questionId === 'grade') {
    const weight = observation.weight_g!;
    const choice = weight < 1000 ? 'small' : weight < 3000 ? 'medium' : 'large';
    return checked({
      ...common, kind: 'choice', choice,
      score: null, score_raw: null, score_level: null,
      noul_value: null, noul_probability: null,
      rationale: 'Rule-based bracket from measured weight; this is not a fish-quality or species prediction.',
    });
  }
  if (questionId === 'quality') {
    const temperature = observation.ice_temp_c;
    const raw = temperature === null ? 2 : Math.max(0, Math.min(4, 4 - Math.max(temperature, 0) / 3));
    return checked({
      ...common, kind: 'score', choice: null,
      score_raw: raw, score: raw / 4, score_level: Math.round(raw),
      noul_value: null, noul_probability: null,
      rationale: 'Rule-based score of recorded temperature evidence, not intrinsic fish quality.',
    });
  }
  return checked({
    ...common, kind: 'noul', choice: null,
    score: null, score_raw: null, score_level: null,
    noul_value: true, noul_probability: confidence,
    rationale: 'The record is complete enough for an operator to enter a demo price; no price or valuation was inferred.',
  });
}

export function createStubBackend(options: StubOptions = {}): DecisionBackend {
  const envForceLow = typeof process !== 'undefined' && process.env.MODEL_FORCE_LOW === '1';
  const confidence = (options.forceLow ?? envForceLow) ? LOW_CONFIDENCE : NORMAL_CONFIDENCE;
  return {
    id: 'reeldeal-stub', version: RULE_VERSION, runtime: 'js',
    async decide(input, questionId = 'grade') {
      if (!(questionId in questions)) throw new Error(`unknown question: ${questionId}`);
      const observation = ObservationSchema.parse(input);
      if (!requiredFactsComplete(observation)) return incomplete(observation);
      return decideComplete(observation, questionId, confidence);
    },
  };
}

export const stubBackend = createStubBackend();
