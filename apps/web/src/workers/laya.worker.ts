/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import { Tokenizer } from '@huggingface/tokenizers';
import {
  LAYA_MODEL, adaptLayaAnswer, buildState, loadPinnedAssets, questions, stubBackend,
  type ModelProgress,
} from '@reeldeal/decision';
import { ObservationSchema } from '@reeldeal/domain';
import { Laya } from '@reeldeal/decision/laya-core';
import type { ModelReply, ModelRequest, ModelReady } from '../lib/model-protocol';

const worker = self as unknown as DedicatedWorkerGlobalScope;
let laya: Laya | null = null;
let ready: ModelReady | null = null;

const send = (reply: ModelReply) => worker.postMessage(reply);
const progress = (id: number, value: ModelProgress) => send({ id, type: 'progress', progress: value });

async function load(id: number, wasmBase: string) {
  if (ready) { send({ id, type: 'loaded', ready }); return; }
  const started = performance.now();
  const isolated = worker.crossOriginIsolated === true;
  const threads = isolated ? Math.min(4, worker.navigator.hardwareConcurrency || 2) : 1;
  ort.env.wasm.wasmPaths = new URL(wasmBase, worker.location.origin).href;
  ort.env.wasm.numThreads = threads;
  const assets = await loadPinnedAssets((value) => progress(id, value));
  progress(id, { phase: 'session', detail: 'Creating ONNX Runtime Web session' });
  const tokenizer = new Tokenizer(assets.tokenizer, assets.tokenizerConfig);
  const session = await ort.InferenceSession.create(assets.graph, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    externalData: [{ path: LAYA_MODEL.weights.name, data: assets.weights }],
  });
  laya = new Laya(ort, session, tokenizer, assets.config);
  ready = {
    backend: 'laya', variant: LAYA_MODEL.variant, sha256: LAYA_MODEL.weights.sha256,
    isolated, threads, fromCache: assets.fromCache,
    loadMs: Math.round(performance.now() - started),
  };
  progress(id, { phase: 'ready' });
  send({ id, type: 'loaded', ready });
}

async function decide(request: Extract<ModelRequest, { type: 'decide' }>) {
  if (!laya) throw new Error('Laya session is not ready');
  const observation = ObservationSchema.parse(request.observation);
  const preflight = await stubBackend.decide(observation, request.questionId);
  if (preflight.confidence_source === 'policy_required_input') {
    send({ id: request.id, type: 'decision', decision: preflight, inferenceMs: 0 });
    return;
  }
  const output = await laya.systemOne(buildState(observation), { [request.questionId]: questions[request.questionId] });
  const answer = output.answers[request.questionId];
  if (!answer) throw new Error('Laya did not return the requested typed answer');
  const decision = adaptLayaAnswer(observation, request.questionId, answer, output.latency_ms);
  send({ id: request.id, type: 'decision', decision, inferenceMs: output.latency_ms });
}

worker.addEventListener('message', (event: MessageEvent<ModelRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      if (request.type === 'load') await load(request.id, request.wasmBase);
      else if (request.type === 'decide') await decide(request);
    } catch (error) {
      send({ id: request.id, type: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  })();
});
