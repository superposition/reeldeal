export type LayaAnswer =
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number }
  | { type: 'noul'; noul: number; confidence: number };

export class Laya {
  constructor(ort: unknown, session: unknown, tokenizer: unknown, config: Record<string, unknown>);
  systemOne(state: string, questions: Record<string, unknown>): Promise<{
    answers: Record<string, LayaAnswer>;
    latency_ms: number;
  }>;
}
