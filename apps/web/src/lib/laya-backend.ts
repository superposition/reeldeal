import type { Observation, TypedDecisionInput } from '@reeldeal/domain';
import { LAYA_MODEL, stubBackend, type DecisionBackend, type ModelProgress, type QuestionId } from '@reeldeal/decision';
import type { ModelReady, ModelReply, ModelRequest } from './model-protocol';

type Pending = {
  resolve: (reply: ModelReply) => void;
  reject: (error: Error) => void;
  onProgress?: (value: ModelProgress) => void;
};
type ModelPayload = Omit<Extract<ModelRequest, { type: 'load' }>, 'id'>
  | Omit<Extract<ModelRequest, { type: 'decide' }>, 'id'>;

export class BrowserLayaBackend implements DecisionBackend {
  readonly id = LAYA_MODEL.id;
  readonly version = LAYA_MODEL.variant;
  readonly runtime = 'wasm';
  readonly sha256 = LAYA_MODEL.weights.sha256;

  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  ready: ModelReady | null = null;
  lastInferenceMs: number | null = null;

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/laya.worker.ts', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (event: MessageEvent<ModelReply>) => {
        const reply = event.data;
        const waiting = this.pending.get(reply.id);
        if (!waiting) return;
        if (reply.type === 'progress') { waiting.onProgress?.(reply.progress); return; }
        this.pending.delete(reply.id);
        if (reply.type === 'error') waiting.reject(new Error(reply.error));
        else waiting.resolve(reply);
      });
      this.worker.addEventListener('error', (event) => {
        const error = new Error(event.message || 'Laya worker failed');
        for (const waiting of this.pending.values()) waiting.reject(error);
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
        this.ready = null;
      });
    }
    return this.worker;
  }

  private request(request: ModelPayload, onProgress?: (value: ModelProgress) => void): Promise<ModelReply> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.getWorker().postMessage({ ...request, id });
    });
  }

  async load(onProgress?: (value: ModelProgress) => void): Promise<ModelReady> {
    if (this.ready) return this.ready;
    const base = import.meta.env.BASE_URL.endsWith('/')
      ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
    const reply = await this.request({ type: 'load', wasmBase: `${base}vendor/` }, onProgress);
    if (reply.type !== 'loaded') throw new Error('Unexpected Laya load reply');
    this.ready = reply.ready;
    return reply.ready;
  }

  async decide(observation: Observation, questionId: QuestionId = 'grade'): Promise<TypedDecisionInput> {
    if (!this.ready) throw new Error('Load Laya before requesting a model decision');
    const reply = await this.request({ type: 'decide', observation, questionId });
    if (reply.type !== 'decision') throw new Error('Unexpected Laya decision reply');
    this.lastInferenceMs = reply.inferenceMs;
    return reply.decision;
  }

  close(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    for (const waiting of this.pending.values()) waiting.reject(new Error('Laya worker closed'));
    this.pending.clear();
  }
}

// The caller must display this as a separate rule path, never as a Laya result.
export async function decideWithStub(observation: Observation, questionId: QuestionId = 'grade') {
  return stubBackend.decide(observation, questionId);
}
