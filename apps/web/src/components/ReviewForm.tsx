import { createSignal, For, onMount, Show } from 'solid-js';
import type { ReviewSnapshot } from './review-types';
import { gateReasonWords } from './review-types';
import './ReviewForm.css';

type Field = 'length_mm' | 'weight_g' | 'scale_stable' | 'scale_grams' | 'species_label';
const fields: { value: Field; label: string; unit?: string }[] = [
  { value: 'length_mm', label: 'Length', unit: 'mm' },
  { value: 'weight_g', label: 'Weight', unit: 'g' },
  { value: 'scale_stable', label: 'Stable scale reading' },
  { value: 'scale_grams', label: 'Scale reading', unit: 'g' },
  { value: 'species_label', label: 'Operator species label' },
];

function showValue(value: unknown, unit = ''): string {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return `${value}${unit ? ` ${unit}` : ''}`;
}

export default function ReviewForm(props: { initial: ReviewSnapshot; apiOrigin: string }) {
  const [review, setReview] = createSignal(props.initial);
  const [field, setField] = createSignal<Field>('weight_g');
  const [value, setValue] = createSignal('');
  const [reason, setReason] = createSignal('');
  const [actorId, setActorId] = createSignal(props.initial.lot.id.startsWith('demo-lot-') ? 'demo-operator' : '');
  const [attest, setAttest] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [connected, setConnected] = createSignal(false);
  const [message, setMessage] = createSignal('');
  const [fieldError, setFieldError] = createSignal('');
  const api = props.apiOrigin.replace(/\/$/, '');
  const url = `${api}/v1/lots/${encodeURIComponent(props.initial.lot.id)}/review`;

  onMount(() => {
    if (!api) {
      setMessage('Preview only: no API origin is configured. Corrections are unavailable.');
      return;
    }
    void fetch(url).then(async (response) => {
      if (!response.ok) throw new Error('The live review record could not be loaded.');
      const body = await response.json() as { review: ReviewSnapshot };
      setReview(body.review);
      setConnected(true);
      setMessage('Live review record loaded from the API.');
    }).catch(() => setMessage('The API is unavailable or this lot is not in its database. This is a static preview; no correction can be submitted.'));
  });

  function selectedValue(): unknown {
    const observation = review().effective_observation;
    if (field() === 'scale_stable') return observation.scale_reading.stable;
    if (field() === 'scale_grams') return observation.scale_reading.grams;
    return observation[field() as 'length_mm' | 'weight_g' | 'species_label'];
  }

  function humanValue(): string | number | boolean | null {
    if (field() === 'scale_stable') return value() === 'true';
    if (field() === 'species_label') return value().trim();
    if (!value().trim()) return null;
    return Number(value());
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setFieldError('');
    if (field() === 'scale_stable' && value() === '') {
      setFieldError('Choose stable or unstable.');
      return;
    }
    const nextValue = humanValue();
    if (nextValue === null || nextValue === '' || (typeof nextValue === 'number' && (!Number.isFinite(nextValue) || nextValue <= 0))) {
      setFieldError('Enter a positive measurement or a species label.');
      return;
    }
    if (!connected() || saving()) return;
    setSaving(true);
    setMessage('Saving an attributed correction…');
    try {
      const response = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field: field(), human_value: nextValue, reason: reason().trim(), actor_id: actorId().trim(), attest: attest() }),
      });
      const body = await response.json() as { review?: ReviewSnapshot; human_approved?: boolean; error?: string; issues?: { path: string[]; message: string }[] };
      if (!response.ok || !body.review) {
        const valueIssue = body.issues?.find((issue) => issue.path[0] === 'human_value');
        if (valueIssue) setFieldError(valueIssue.message);
        throw new Error(body.issues?.map((issue) => issue.message).join(' ') ||
          (body.error === 'reviewer_not_authorized'
            ? 'This actor is not an active seller or operator for the lot. Check the operator ID.'
            : 'The correction was not saved. Check the fields and retry.'));
      }
      setReview(body.review);
      setValue('');
      setReason('');
      setAttest(false);
      setMessage(body.human_approved
        ? 'Human-approved. The original decision remains unchanged in the record.'
        : `Correction recorded. Still in review: ${gateReasonWords[body.review.lot.gate_reason ?? ''] ?? body.review.lot.gate_reason}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The correction could not be saved. Retry.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="review-form">
      <div class="review-form__status" role="status" aria-live="polite">
        <strong>{review().lot.status === 'pending_review' ? 'Review required'
          : review().corrections.length ? 'Human review resolved' : 'No active review'}</strong>
        <span>{review().lot.status === 'pending_review'
          ? gateReasonWords[review().lot.gate_reason ?? ''] ?? review().lot.gate_reason
          : review().corrections.length
            ? 'An operator attested to corrected facts. This is not model approval.'
            : 'This lot has no correction trail.'}</span>
      </div>
      <p class="review-form__message" role="status" aria-live="polite">{message()}</p>

      <section aria-labelledby="effective-title">
        <h3 id="effective-title">Effective facts</h3>
        <dl class="review-form__facts">
          <For each={fields}>{(item) => <div><dt>{item.label}</dt><dd>
            {showValue(item.value === 'scale_stable' ? review().effective_observation.scale_reading.stable
              : item.value === 'scale_grams' ? review().effective_observation.scale_reading.grams
                : review().effective_observation[item.value], item.unit)}
            <Show when={review().corrections.some((entry) => entry.field === item.value)}><span class="review-form__human">Human-supplied</span></Show>
          </dd></div>}</For>
        </dl>
      </section>

      <Show when={review().corrections.length > 0}>
        <section aria-labelledby="corrections-title">
          <h3 id="corrections-title">Correction trail</h3>
          <ol class="review-form__trail">
            <For each={review().corrections}>{(entry) => (
              <li><strong>{entry.field.replaceAll('_', ' ')}</strong>: original {showValue(entry.model_value)} → human-supplied {showValue(entry.human_value)}
                <span> By {entry.actor_id} · {entry.reason}</span></li>
            )}</For>
          </ol>
        </section>
      </Show>

      <Show when={review().lot.status === 'pending_review'}>
        <form onSubmit={submit} novalidate>
          <fieldset disabled={!connected() || saving()}>
            <legend>Record a correction</legend>
            <p>Changing a fact never edits the original model decision. A reviewer attestation is required.</p>
            <div class="review-form__grid">
              <div class="review-form__field">
                <label for="review-field">Field to correct</label>
                <select id="review-field" value={field()} onChange={(event) => { setField(event.currentTarget.value as Field); setValue(''); setFieldError(''); }}>
                  {fields.map((item) => <option value={item.value}>{item.label}</option>)}
                </select>
                <small>Current value: {showValue(selectedValue())}</small>
              </div>
              <div class="review-form__field">
                <label for="review-value">Human-supplied value</label>
                <Show when={field() === 'scale_stable'} fallback={
                  <input id="review-value" type={field() === 'species_label' ? 'text' : 'number'}
                    inputmode={field() === 'species_label' ? 'text' : 'decimal'} min="0" step="any"
                    value={value()} onInput={(event) => setValue(event.currentTarget.value)}
                    aria-invalid={Boolean(fieldError())} aria-describedby="review-value-error" />
                }>
                  <select id="review-value" value={value()} onChange={(event) => setValue(event.currentTarget.value)}
                    aria-invalid={Boolean(fieldError())} aria-describedby="review-value-error">
                    <option value="">Choose one</option><option value="true">Stable</option><option value="false">Unstable</option>
                  </select>
                </Show>
                <small id="review-value-error" role="alert">{fieldError()}</small>
              </div>
              <div class="review-form__field">
                <label for="review-actor">Reviewer ID</label>
                <input id="review-actor" type="text" value={actorId()} onInput={(event) => setActorId(event.currentTarget.value)} required />
                <small>Must be an active seller or operator for this lot. The seeded fixture uses demo-operator. This ID is attribution, not production login.</small>
              </div>
              <div class="review-form__field review-form__field--wide">
                <label for="review-reason">Reason for correction</label>
                <textarea id="review-reason" rows="3" minlength="8" maxlength="500" value={reason()} onInput={(event) => setReason(event.currentTarget.value)} required />
              </div>
            </div>
            <label class="review-form__attest"><input type="checkbox" checked={attest()} onChange={(event) => setAttest(event.currentTarget.checked)} />
              <span>I checked this fact and accept responsibility for the human review.</span></label>
          </fieldset>
          <div class="review-form__action"><button type="submit" disabled={!connected() || saving() || !attest() || !actorId().trim() || reason().trim().length < 8}>
            {saving() ? 'Saving correction…' : 'Record correction and recheck gate'}
          </button></div>
        </form>
      </Show>
    </div>
  );
}
