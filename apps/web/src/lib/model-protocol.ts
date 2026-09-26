import type { Observation, TypedDecisionInput } from '@reeldeal/domain';
import type { ModelProgress, QuestionId } from '@reeldeal/decision';

export type ModelRequest =
  | { id: number; type: 'load'; wasmBase: string }
  | { id: number; type: 'decide'; observation: Observation; questionId: QuestionId };

export type ModelReady = {
  backend: 'laya';
  variant: string;
  sha256: string;
  isolated: boolean;
  threads: number;
  fromCache: boolean;
  loadMs: number;
};

export type ModelReply =
  | { id: number; type: 'progress'; progress: ModelProgress }
  | { id: number; type: 'loaded'; ready: ModelReady }
  | { id: number; type: 'decision'; decision: TypedDecisionInput; inferenceMs: number }
  | { id: number; type: 'error'; error: string };
