import {
  TypedDecisionInputSchema, layaEntropyConfidence, layaNoulConfidence,
  type Observation, type TypedDecisionInput,
} from '@reeldeal/domain';
import { LAYA_MODEL } from './laya-lock';
import type { QuestionId } from './backend';
import type { LayaAnswer } from '../vendor/laya/laya-core';

function distribution(answer: Record<string, number>): number[] {
  const values = Object.values(answer);
  if (values.length < 2 || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('invalid Laya probability distribution');
  }
  const sum = values.reduce((total, value) => total + value, 0);
  if (sum <= 0 || Math.abs(sum - 1) > 0.01) throw new Error('invalid Laya probability sum');
  return values.map((value) => value / sum); // Laya rounds printed values to four places.
}

export function adaptLayaAnswer(
  observation: Observation,
  questionId: QuestionId,
  answer: LayaAnswer,
  latencyMs: number,
): TypedDecisionInput {
  const common = {
    scan_id: observation.scan_id,
    observation_id: observation.id,
    decision_id: `laya:${observation.scan_id}:${observation.id}:${questionId}:${LAYA_MODEL.weights.sha256}`,
    question_id: questionId,
    model: {
      id: LAYA_MODEL.id, version: LAYA_MODEL.variant, runtime: 'wasm',
      sha256: LAYA_MODEL.weights.sha256,
    },
    latency_ms: Math.max(0, Math.round(latencyMs)),
    rationale: 'Typed model answer on structured landing facts; species and fish quality still require operator judgment.',
  } as const;

  if (answer.type === 'choice') {
    const keys = Object.keys(answer.probabilities);
    const probabilities = distribution(answer.probabilities);
    if (!keys.includes(answer.choice)) throw new Error('Laya choice is absent from distribution');
    return TypedDecisionInputSchema.parse({
      ...common, kind: 'choice', choice: answer.choice,
      score: null, score_raw: null, score_level: null,
      noul_value: null, noul_probability: null,
      probabilities, ...layaEntropyConfidence(probabilities),
    });
  }
  if (answer.type === 'score') {
    const probabilities = distribution(answer.probabilities);
    const raw = answer.score;
    if (!Number.isFinite(raw) || raw < 0 || raw > 4) throw new Error('Laya score outside five-level rubric');
    return TypedDecisionInputSchema.parse({
      ...common, kind: 'score', choice: null,
      score_raw: raw, score: raw / 4, score_level: Math.round(raw),
      noul_value: null, noul_probability: null,
      probabilities, ...layaEntropyConfidence(probabilities),
    });
  }
  const noul = layaNoulConfidence(answer.noul);
  return TypedDecisionInputSchema.parse({
    ...common, kind: 'noul', choice: null,
    score: null, score_raw: null, score_level: null,
    ...noul,
  });
}
