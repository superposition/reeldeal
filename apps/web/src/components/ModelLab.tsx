import { createSignal, onCleanup } from 'solid-js';
import { LAYA_MODEL, type ModelProgress } from '@reeldeal/decision';
import { ObservationSchema, type TypedDecisionInput } from '@reeldeal/domain';
import { BrowserLayaBackend, decideWithStub } from '../lib/laya-backend';

const sample = ObservationSchema.parse({
  id: 'sample-observation-1', org_id: 'sample-organization', scan_id: 'sample-scan-1',
  created_at: '2026-09-26T00:00:00.000Z', updated_at: '2026-09-26T00:00:00.000Z',
  captured_at: '2026-09-26T00:00:00.000Z', status: 'recorded', source: 'manual', image_ref: 'sample-only',
  length_mm: 412, girth_mm: 220, weight_g: 1480, ice_temp_c: 2,
  species_candidates: [{ label: 'saba', score: 0.91 }],
  species_label: 'saba', species_confirmed_by: 'sample-operator',
  scale_reading: { stable: true, grams: 1480 },
});

const formatBytes = (value: number) => `${(value / 1_000_000).toFixed(1)} MB`;
const progressText = (value: ModelProgress) => {
  const amount = value.loaded !== undefined && value.total
    ? ` · ${formatBytes(value.loaded)} / ${formatBytes(value.total)}` : '';
  return `${value.phase}${amount}${value.detail ? ` · ${value.detail}` : ''}`;
};

export default function ModelLab() {
  const backend = new BrowserLayaBackend();
  const [isolated, setIsolated] = createSignal(typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated);
  const [status, setStatus] = createSignal('Not loaded. The rule-based sample is available without a download.');
  const [busy, setBusy] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [result, setResult] = createSignal<TypedDecisionInput | null>(null);
  const [error, setError] = createSignal('');
  onCleanup(() => backend.close());

  async function enableThreads() {
    setError('');
    if (!('serviceWorker' in navigator)) { setError('This browser does not support service workers. Laya can try one WASM thread.'); return; }
    try {
      const base = import.meta.env.BASE_URL.endsWith('/')
        ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
      await navigator.serviceWorker.register(`${base}coi-sw.js`, { scope: base });
      await navigator.serviceWorker.ready;
      // GitHub Pages cannot set these headers itself. The vendored service worker
      // adds them on the next navigation, after it controls this page.
      location.reload();
    } catch (cause) { setError(`Could not enable cross-origin isolation: ${String(cause)}`); }
  }

  async function loadModel() {
    setBusy(true); setError(''); setResult(null);
    try {
      const ready = await backend.load((value) => setStatus(progressText(value)));
      setLoaded(true);
      setIsolated(ready.isolated);
      setStatus(`Laya ready · ${ready.threads} WASM thread${ready.threads === 1 ? '' : 's'} · ${ready.fromCache ? 'verified cache' : 'verified download'} · ${ready.loadMs} ms load`);
    } catch (cause) {
      setLoaded(false);
      setError(`Laya did not load: ${String(cause)}. The separate rule-based path is still available.`);
      setStatus('Model unavailable; no model result was fabricated.');
    } finally { setBusy(false); }
  }

  async function runModel() {
    setBusy(true); setError(''); setResult(null);
    try {
      const decision = await backend.decide(sample, 'grade');
      setResult(decision);
      setStatus(`Laya inference complete · ${backend.lastInferenceMs ?? decision.latency_ms} ms`);
    } catch (cause) { setError(`Laya inference failed: ${String(cause)}`); }
    finally { setBusy(false); }
  }

  async function runStub() {
    setBusy(true); setError(''); setResult(null);
    try {
      const decision = await decideWithStub(sample, 'grade');
      setResult(decision);
      setStatus('Rule-based demo result. No model inference ran.');
    } catch (cause) { setError(`Rule-based sample failed: ${String(cause)}`); }
    finally { setBusy(false); }
  }

  return <div class="model-lab">
    <div class="model-lab__facts">
      <p><strong>Model:</strong> {LAYA_MODEL.variant} · {formatBytes(LAYA_MODEL.weights.bytes)} weights</p>
      <p><strong>SHA-256:</strong> <code>{LAYA_MODEL.weights.sha256}</code></p>
      <p><strong>Isolation:</strong> {isolated() ? 'on; multithreading available' : 'off; one-thread mode until service-worker reload'}</p>
    </div>
    <div class="model-lab__actions">
      {!isolated() && <button type="button" onClick={enableThreads}>Enable threads & reload</button>}
      <button type="button" disabled={busy() || loaded()} onClick={loadModel}>Download & verify Laya</button>
      <button type="button" disabled={busy() || !loaded()} onClick={runModel}>Run Laya sample</button>
      <button type="button" disabled={busy()} onClick={runStub}>Run rule-based sample</button>
    </div>
    <p class="model-lab__status" role="status">{status()}</p>
    {error() && <p class="model-lab__error" role="alert">{error()}</p>}
    {result() && <div class="model-lab__result">
      <h2>Sample decision</h2>
      <dl>
        <dt>Backend</dt><dd>{result()!.model.id}</dd>
        <dt>Answer</dt><dd>{result()!.choice ?? result()!.score ?? String(result()!.noul_value)}</dd>
        <dt>Confidence</dt><dd>{result()!.confidence.toFixed(3)} ({result()!.confidence_source})</dd>
        <dt>Inference</dt><dd>{result()!.latency_ms} ms</dd>
      </dl>
      <p>{result()!.rationale}</p>
    </div>}
  </div>;
}
