import { createSignal, onCleanup, Show } from 'solid-js';
import { TypedDecisionInputSchema, type Lot, type Observation, type TypedDecision, type TypedDecisionInput } from '@reeldeal/domain';
import { stubBackend, type ModelProgress } from '@reeldeal/decision';
import { BrowserLayaBackend } from '../lib/laya-backend';
import Scanner from './Scanner';
import ReviewForm from './ReviewForm';
import { gateReasonWords, type ReviewSnapshot } from './review-types';
import './LandingWorkflow.css';

type LotWire = Lot & { gate_reason: string | null };
type CheckMode = 'rules' | 'laya';
type LotRequest = { scan_id: string; decision_id: string; price_jpy: number };
type Progress = {
  observationId: string;
  decisionId?: string;
  lotId?: string;
  blockedLotId?: string;
  pendingDecision?: { mode: CheckMode; payload: TypedDecisionInput };
  pendingLot?: LotRequest;
};
type ApiBody = { error?: string; issues?: { path: (string | number)[]; message: string }[]; lot_id?: string };

class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string, readonly body: ApiBody) {
    super(body.issues?.map((issue) => issue.message).join(' ') || code.replaceAll('_', ' '));
  }
}

const keyFor = (scanId: string) => `reeldeal:landing-workflow:v1:${scanId}`;
function readProgress(scanId: string): Progress | null {
  try {
    const value = JSON.parse(localStorage.getItem(keyFor(scanId)) ?? 'null') as Progress | null;
    return value && typeof value.observationId === 'string' ? value : null;
  } catch { return null; }
}
function writeProgress(scanId: string, value: Progress): void {
  try { localStorage.setItem(keyFor(scanId), JSON.stringify(value)); } catch { /* Current session still works. */ }
}

export default function LandingWorkflow(props: { apiOrigin: string }) {
  const api = props.apiOrigin.replace(/\/$/, '');
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/');
  const model = new BrowserLayaBackend();
  const [observation, setObservation] = createSignal<Observation | null>(null);
  const [decision, setDecision] = createSignal<TypedDecision | null>(null);
  const [lot, setLot] = createSignal<LotWire | null>(null);
  const [review, setReview] = createSignal<ReviewSnapshot | null>(null);
  const [price, setPrice] = createSignal('');
  const [pendingDecision, setPendingDecision] = createSignal<Progress['pendingDecision'] | null>(null);
  const [pendingLot, setPendingLot] = createSignal<LotRequest | null>(null);
  const [busy, setBusy] = createSignal<'' | 'restore' | 'rules' | 'laya' | 'lot' | 'review' | 'publish'>('');
  const [message, setMessage] = createSignal('Save a landing before checking it.');
  const [error, setError] = createSignal('');
  const [blocked, setBlocked] = createSignal(false);
  let generation = 0;
  onCleanup(() => model.close());

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!api) throw new Error('The market connection is unavailable. Try again when it is connected.');
    const response = await fetch(`${api}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
    const body = await response.json().catch(() => ({})) as T & ApiBody;
    if (!response.ok) throw new ApiFailure(response.status, body.error ?? 'request_failed', body);
    return body;
  }

  function remember(patch: Partial<Progress>, source = observation()) {
    if (!source) return;
    const previous = readProgress(source.scan_id);
    writeProgress(source.scan_id, {
      ...(previous?.observationId === source.id ? previous : { observationId: source.id }),
      ...patch,
    });
  }

  function clearCurrent() {
    generation++;
    setObservation(null); setDecision(null); setLot(null); setReview(null);
    setPendingDecision(null); setPendingLot(null); setPrice(''); setBlocked(false); setError('');
    setBusy(''); setMessage('Save a new landing before checking it.');
  }

  async function loadReview(lotId: string, token: number) {
    try {
      const body = await request<{ review: ReviewSnapshot }>(`/v1/lots/${encodeURIComponent(lotId)}/review`);
      if (token === generation) setReview(body.review);
    } catch (cause) {
      if (token === generation) setError(`Review record unavailable. Retry after reconnecting. ${errorWords(cause)}`);
    }
  }

  async function onSaved(next: Observation) {
    if (observation()?.id === next.id) return;
    const old = observation();
    const saved = readProgress(next.scan_id);
    const blockedLotId = old?.scan_id === next.scan_id && old.id !== next.id ? lot()?.id : undefined;
    const priorLotId = saved?.observationId === next.id ? saved.blockedLotId : saved?.lotId ?? saved?.blockedLotId;
    const hadLot = Boolean(blockedLotId ?? priorLotId);
    const token = ++generation;
    setObservation(next); setDecision(null); setLot(null); setReview(null);
    setPendingDecision(null); setPendingLot(null); setBlocked(hadLot); setError('');
    setMessage(hadLot
      ? 'Changed facts saved. This scan already has a lot; start a new landing before another check.'
      : 'Landing saved. Choose a check when ready.');
    if (saved?.observationId !== next.id) {
      writeProgress(next.scan_id, { observationId: next.id, ...(hadLot ? { blockedLotId: blockedLotId ?? priorLotId } : {}) });
      if (saved || hadLot) setMessage(hadLot
        ? 'Changed facts saved. Start a new landing; the earlier lot stays in its record.'
        : 'Facts changed. The earlier check is no longer current; run a new check.');
      return;
    }
    if (hadLot) return;
    if (!saved || !api) return;
    setPendingDecision(saved.pendingDecision ?? null);
    setPendingLot(saved.pendingLot ?? null);
    if (saved.pendingLot) setPrice(String(saved.pendingLot.price_jpy));
    if (!saved.decisionId && !saved.lotId) return;
    setBusy('restore'); setMessage('Restoring saved progress…');
    try {
      if (saved.decisionId) {
        const body = await request<{ typed_decision: TypedDecision }>(`/v1/decisions/${encodeURIComponent(saved.decisionId)}`);
        if (token !== generation) return;
        if (body.typed_decision.observation_id !== next.id) throw new Error('The saved check refers to older facts. Run a new check.');
        setDecision(body.typed_decision);
      }
      if (saved.lotId) {
        const body = await request<{ lot: LotWire; typed_decision: TypedDecision }>(`/v1/lots/${encodeURIComponent(saved.lotId)}`);
        if (token !== generation) return;
        if (body.typed_decision.observation_id !== next.id) throw new Error('This lot refers to older facts. Start a new landing.');
        setLot(body.lot); setPrice(String(body.lot.price_jpy));
        if (body.lot.status === 'pending_review' || body.lot.status === 'approved') await loadReview(body.lot.id, token);
      }
      if (token === generation) setMessage(saved.lotId ? 'Saved lot restored.' : 'Saved check restored.');
    } catch (cause) {
      if (token === generation) setError(`Saved progress could not be restored. ${errorWords(cause)}`);
    } finally { if (token === generation) setBusy(''); }
  }

  function errorWords(cause: unknown): string {
    if (cause instanceof DOMException && cause.name === 'TimeoutError') return 'Request timed out; retry the same action.';
    if (cause instanceof ApiFailure) {
      if (cause.code === 'stale_observation' || cause.code === 'stale_decision') return 'Facts changed on the server. Refresh the landing or start a new one.';
      if (cause.code === 'scan_not_ready' || cause.code === 'lot_exists') return 'This scan already moved forward. Start a new landing for changed facts.';
      return cause.message;
    }
    return cause instanceof Error ? cause.message : 'Check the connection and retry.';
  }

  async function check(mode: CheckMode) {
    const current = observation();
    if (!current || busy() || blocked()) return;
    const token = generation;
    const waiting = pendingDecision();
    if (waiting && waiting.mode !== mode) {
      setError('Retry the saved check before choosing a different backend.');
      return;
    }
    setBusy(mode); setError('');
    try {
      let payload = waiting?.payload;
      if (!payload) {
        if (mode === 'rules') payload = await stubBackend.decide(current, 'grade');
        else {
          // Missing required facts produce a deterministic false completeness answer;
          // downloading the large model cannot fill in an unverified scale reading.
          const preflight = await stubBackend.decide(current, 'grade');
          if (preflight.confidence_source === 'policy_required_input') {
            payload = preflight;
            setMessage('Required facts need review; Laya was not loaded.');
          } else {
            await model.load((progress: ModelProgress) => setMessage(`Loading local model: ${progress.phase}${progress.detail ? ` · ${progress.detail}` : ''}`));
            payload = await model.decide(current, 'grade');
          }
        }
        payload = TypedDecisionInputSchema.parse(payload);
        if (token !== generation || observation()?.id !== current.id) throw new Error('Facts changed during the check. Run it again.');
        setPendingDecision({ mode, payload });
        remember({ pendingDecision: { mode, payload } }, current);
      }
      const body = await request<{ typed_decision: TypedDecision }>('/v1/decisions', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (token !== generation || observation()?.id !== current.id) return;
      setDecision(body.typed_decision); setPendingDecision(null);
      remember({ decisionId: body.typed_decision.id, pendingDecision: undefined }, current);
      setMessage(payload.confidence_source === 'policy_required_input'
        ? 'Required-facts hold recorded. A human review is needed before listing.'
        : `${mode === 'laya' ? 'Local model' : 'Rule-based'} check recorded. Create a demo lot to run the server gate.`);
    } catch (cause) {
      if (token !== generation) return;
      if (cause instanceof ApiFailure && cause.code === 'stale_observation') {
        setPendingDecision(null); remember({ pendingDecision: undefined }, current);
        void request<{ observation: Observation }>(`/v1/observations/${encodeURIComponent(current.scan_id)}`)
          .then((body) => onSaved(body.observation)).catch(() => {});
      }
      setError(errorWords(cause));
    } finally { if (token === generation) setBusy(''); }
  }

  async function createLot() {
    const current = observation();
    const checked = decision();
    if (!current || !checked || busy() || blocked()) return;
    if (checked.observation_id !== current.id) { setError('Facts changed. Run a new check.'); return; }
    const amount = Number(price());
    if (!pendingLot() && (!Number.isSafeInteger(amount) || amount <= 0)) {
      setError('Enter a positive whole-yen demo asking price.'); return;
    }
    const token = generation;
    const input = pendingLot() ?? { scan_id: current.scan_id, decision_id: checked.id, price_jpy: amount };
    setPendingLot(input); remember({ pendingLot: input }, current);
    setBusy('lot'); setError(''); setMessage('Creating demo lot and checking its review gate…');
    try {
      const body = await request<{ lot: LotWire }>('/v1/lots', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      });
      if (token !== generation || observation()?.id !== current.id) return;
      setLot(body.lot); setPendingLot(null);
      remember({ lotId: body.lot.id, pendingLot: undefined }, current);
      setMessage(body.lot.status === 'pending_review'
        ? 'Lot saved for human review. Nothing has been published.'
        : 'Lot approved by the server. Publish it explicitly when ready.');
      if (body.lot.status === 'pending_review') await loadReview(body.lot.id, token);
    } catch (cause) {
      if (token !== generation) return;
      if (cause instanceof ApiFailure && (cause.code === 'lot_exists' || cause.code === 'stale_decision')) {
        setBlocked(true); setPendingLot(null); remember({ pendingLot: undefined }, current);
      }
      setError(errorWords(cause));
    } finally { if (token === generation) setBusy(''); }
  }

  function onReviewChange(next: ReviewSnapshot) {
    setReview(next);
    setLot((current) => current && current.id === next.lot.id
      ? { ...current, status: next.lot.status as Lot['status'], gate_reason: next.lot.gate_reason } : current);
    if (next.lot.status === 'approved') setMessage('Human-approved after attributed corrections. Publish explicitly when ready.');
  }

  async function publish() {
    const current = lot();
    if (!current || current.status !== 'approved' || busy()) return;
    setBusy('publish'); setError(''); setMessage('Publishing demo listing…');
    try {
      await request(`/v1/lots/${encodeURIComponent(current.id)}/publish`, { method: 'POST' });
      setLot({ ...current, status: 'listed' });
      setMessage('Listed in the demo shop. No sale or payment was made.');
    } catch (cause) { setError(errorWords(cause)); }
    finally { setBusy(''); }
  }

  return <div class="landing-workflow">
    <Scanner apiOrigin={props.apiOrigin} onSaved={onSaved} onNewLanding={clearCurrent} />
    <section class="landing-workflow__card" aria-labelledby="landing-next-title">
      <header class="landing-workflow__head">
        <span class="landing-workflow__step">03</span>
        <div><h2 id="landing-next-title">Check & list</h2><p>One landing, one reviewed decision, then an optional demo listing.</p></div>
      </header>
      <Show when={observation()} fallback={<p class="landing-workflow__quiet">Save a landing to continue. Camera permission is only requested when you press Start camera.</p>}>
        {(saved) => <>
          <p class="landing-workflow__fact">Saved facts: {saved().length_mm ?? 'unknown'} mm · {saved().weight_g ?? 'unknown'} g. Manual weight is not a stable-scale reading.</p>
          <Show when={!decision() && !blocked()}>
            <div class="landing-workflow__actions">
              <Show when={pendingDecision()} fallback={<>
                <button type="button" onClick={() => check('rules')} disabled={Boolean(busy()) || !api}>Check with rules</button>
                <button type="button" class="landing-workflow__secondary" onClick={() => check('laya')} disabled={Boolean(busy()) || !api}>Check with Laya</button>
              </>}>
                {(pending) => <button type="button" onClick={() => check(pending().mode)} disabled={Boolean(busy()) || !api}>Retry saved check</button>}
              </Show>
            </div>
          </Show>
          <Show when={decision()}>
            {(checked) => <div class="landing-workflow__result">
              <strong>{checked().confidence_source === 'policy_required_input' ? 'Human review needed' : 'Check recorded'}</strong>
              <p>{checked().kind === 'choice' ? `Recorded size: ${checked().choice}`
                : checked().kind === 'score' ? `Recorded score: ${Math.round((checked().score ?? 0) * 100)}%`
                  : `Required facts: ${checked().noul_value ? 'yes' : 'no'}`}</p>
              <details><summary>Check details</summary><p>{checked().model.id} · {Math.round(checked().confidence * 100)}% · {checked().confidence_source.replaceAll('_', ' ')}</p><p>{checked().rationale}</p><p>Browser-reported answer; not proof of species, quality, or a camera measurement.</p></details>
            </div>}
          </Show>
          <Show when={decision() && !lot() && !blocked()}>
            <div class="landing-workflow__price">
              <label for="demo-price">Demo asking price (¥)</label>
              <input id="demo-price" type="number" inputmode="numeric" min="1" step="1" value={price()} onInput={(event) => setPrice(event.currentTarget.value)} disabled={Boolean(pendingLot()) || Boolean(busy())} />
              <p>No payment is taken. Price cannot be changed after this scan creates a lot.</p>
              <button type="button" onClick={createLot} disabled={Boolean(busy()) || !api}>{pendingLot() ? 'Retry same lot' : 'Create demo lot'}</button>
            </div>
          </Show>
          <Show when={lot()}>
            {(created) => <div class="landing-workflow__lot">
              <strong>{created().status === 'pending_review' ? 'Review needed' : created().status === 'approved' ? 'Ready to publish' : 'Listed in demo shop'}</strong>
              <p>{created().status === 'pending_review'
                ? gateReasonWords[created().gate_reason ?? ''] ?? 'An operator must check the recorded facts.'
                : created().status === 'approved' ? 'The server approved this lot. It is not public until you publish it.'
                  : 'This lot is visible in the demo shop. No sale or payment happened.'}</p>
              <Show when={created().status === 'approved'}><button type="button" onClick={publish} disabled={Boolean(busy())}>Publish to shop</button></Show>
              <Show when={created().status === 'listed'}><a href={`${base}shop/lot/?id=${encodeURIComponent(created().id)}`}>View lot</a></Show>
            </div>}
          </Show>
          <Show when={lot()?.status === 'pending_review' && !review()}><button type="button" class="landing-workflow__retry" onClick={() => { if (lot()) void loadReview(lot()!.id, generation); }} disabled={Boolean(busy())}>Load review form</button></Show>
        </>}
      </Show>
      <p class="landing-workflow__message" role="status" aria-live="polite">{message()}</p>
      <Show when={error()}><p class="landing-workflow__error" role="alert">{error()}</p></Show>
      <details class="landing-workflow__about"><summary>About the checks</summary><p>Laya runs locally in your browser after a verified download. The rules path is deterministic. Missing measured facts produce a review hold without running Laya. The API validates and stores the browser’s reported decision; its review gate is authoritative.</p></details>
    </section>
    <Show when={review()}>{(snapshot) => <section class="landing-workflow__review" aria-label="Human review"><ReviewForm initial={snapshot()} apiOrigin={props.apiOrigin} onReviewChange={onReviewChange} /></section>}</Show>
  </div>;
}
