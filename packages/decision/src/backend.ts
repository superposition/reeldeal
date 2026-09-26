import type { Observation, TypedDecisionInput } from '@reeldeal/domain';
import questions from '../questions.json';

export type QuestionId = keyof typeof questions;

// The browser returns the input wire shape. The API adds server-owned id,
// ownership, timestamps, and audit state after validation and persistence.
export interface DecisionBackend {
  readonly id: string;
  readonly version: string;
  readonly runtime: string;
  readonly sha256?: string;
  decide(observation: Observation, questionId?: QuestionId): Promise<TypedDecisionInput>;
}

export { questions };
