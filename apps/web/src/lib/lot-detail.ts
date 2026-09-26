import { previewLots } from '../data/preview-lots';

export type Detail = {
  listing?: { id: string; status: string; price_jpy: number } | null;
  lot: { id: string; species_label: string | null; weight_g: number | null; price_jpy: number; status: string; gate_reason: string | null };
  effective_facts: { species_label: string | null; species_confirmed_by: string | null; length_mm: number | null; weight_g: number | null; human_corrected: boolean };
  observation: { length_mm: number | null; captured_at: string; image_ref: string };
  typed_decision: {
    kind: 'choice' | 'score' | 'noul'; choice: string | null; score: number | null;
    noul_value: boolean | null; confidence: number; confidence_source: string;
    model: { id: string; version: string; sha256?: string | null };
  };
  corrections: Array<{ field: string; model_value: unknown; human_value: unknown; actor_id: string }>;
  audit: Array<{ entity_type: string; actor_kind: string; actor_id: string; from_status: string | null; to_status: string | null; at: string }>;
  gate: { route: string; reason: string };
};

const root = document.querySelector<HTMLElement>('[data-lot-detail]');
if (root) {
  const id = new URLSearchParams(location.search).get('id');
  const api = (root.dataset.apiOrigin ?? '').replace(/\/$/, '');
  const message = root.querySelector<HTMLElement>('[data-lot-message]');
  const recovery = root.querySelector<HTMLElement>('[data-lot-recovery]');
  const content = root.querySelector<HTMLElement>('[data-lot-content]');
  const evidence = root.querySelector<HTMLElement>('[data-lot-evidence]');
  const bidding = root.querySelector<HTMLElement>('[data-lot-bidding]');
  const evidenceAction = root.querySelector<HTMLAnchorElement>('[data-evidence-action] a');
  const proofDetails = root.querySelector<HTMLDetailsElement>('#lot-evidence');
  const set = (selector: string, value: string) => {
    const node = root.querySelector<HTMLElement>(selector);
    if (node) node.textContent = value;
  };
  const photo = root.querySelector<HTMLImageElement>('[data-lot-image] img, img[data-lot-image]');
  const showUnavailable = (text: string) => {
    if (bidding) bidding.hidden = true;
    if (message) {
      message.textContent = text;
      message.dataset.error = 'true';
    }
    if (recovery) recovery.hidden = false;
  };

  function showPreview(lotId: string): boolean {
    if (bidding) bidding.hidden = true;
    const preview = previewLots.find((lot) => lot.id === lotId);
    if (!preview) return false;
    set('[data-lot-title]', preview.species);
    set('[data-lot-status]', 'Preview · synthetic');
    set('[data-lot-price]', `¥${preview.priceJpy.toLocaleString('ja-JP')}`);
    set('[data-lot-species]', preview.species);
    set('[data-lot-weight]', `${preview.weightG.toLocaleString('ja-JP')} g`);
    set('[data-lot-length]', `${preview.lengthMm} mm`);
    set('[data-lot-landed]', 'Preview only');
    set('[data-lot-id]', preview.id);
    set('[data-signal-status]', 'Preview only');
    set('[data-signal-species]', 'Sample label');
    set('[data-signal-review]', 'No review record');
    set('[data-signal-photo]', 'No photo');
    for (const field of ['species', 'weight', 'length']) {
      const marker = root?.querySelector<HTMLElement>(`[data-correction-${field}]`);
      if (marker) marker.hidden = true;
    }
    if (evidenceAction) {
      evidenceAction.href = new URL('../', location.href).pathname;
      evidenceAction.textContent = 'Back to lots';
    }
    if (content) content.hidden = false;
    if (evidence) evidence.hidden = true;
    if (message) message.textContent = 'This is an illustrative preview, not current market inventory.';
    if (recovery) recovery.hidden = true;
    return true;
  }

  function showLive(detail: Detail) {
    const { lot, observation, effective_facts: facts, typed_decision: decision, corrections } = detail;
    set('[data-lot-title]', facts.species_label ?? 'Species not recorded');
    const statusName: Record<string, string> = {
      listed: 'Open', reserved: 'Reserved', sold: 'Sold', approved: 'Approved, not listed', pending_review: 'Review needed', withdrawn: 'Withdrawn',
    };
    set('[data-lot-status]', statusName[lot.status] ?? lot.status);
    set('[data-lot-price]', `¥${lot.price_jpy.toLocaleString('ja-JP')}`);
    set('[data-lot-species]', facts.species_label ?? 'Not confirmed');
    set('[data-lot-weight]', facts.weight_g === null ? 'Not recorded' : `${facts.weight_g.toLocaleString('ja-JP')} g`);
    set('[data-lot-length]', facts.length_mm === null ? 'Not recorded' : `${facts.length_mm} mm`);
    const correctedFields = new Set(corrections.map((correction) => correction.field));
    for (const [field, source] of [['species', 'species_label'], ['weight', 'weight_g'], ['length', 'length_mm']]) {
      const marker = root?.querySelector<HTMLElement>(`[data-correction-${field}]`);
      if (marker) marker.hidden = !correctedFields.has(source);
    }
    set('[data-lot-landed]', new Date(observation.captured_at).toLocaleString('ja-JP', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }));
    set('[data-lot-id]', lot.id);
    const hasPhoto = /^data:image\/(?:jpeg|png|webp|avif);base64,[a-z0-9+/=]+$/i.test(observation.image_ref);
    if (hasPhoto && photo) {
      photo.closest('picture')?.querySelectorAll('source').forEach((source) => source.remove());
      photo.removeAttribute('srcset');
      photo.src = observation.image_ref;
      photo.alt = `Landing photograph for ${facts.species_label ?? 'this lot'}`;
      set('[data-photo-caption]', 'Landing photo submitted with this scan.');
      const caption = root?.querySelector<HTMLElement>('[data-photo-caption]');
      if (caption) caption.hidden = false;
    }
    if (evidenceAction) {
      evidenceAction.href = '#lot-evidence';
      evidenceAction.textContent = 'View proof';
    }
    set('[data-signal-status]', statusName[lot.status] ?? lot.status);
    set('[data-signal-species]', facts.species_confirmed_by ? 'Species confirmed' : 'Species unconfirmed');
    set('[data-signal-review]', corrections.length > 0
      ? `${corrections.length} human correction${corrections.length === 1 ? '' : 's'}`
      : lot.status === 'pending_review' ? 'Review needed' : 'No corrections');
    set('[data-signal-photo]', hasPhoto ? 'Landing photo' : 'No photo');
    const answer = decision.kind === 'choice' ? decision.choice ?? 'No answer'
      : decision.kind === 'score' ? `${Math.round((decision.score ?? 0) * 100)}% recorded score`
      : decision.noul_value ? 'Yes' : 'No';
    set('[data-decision-answer]', answer);
    set('[data-decision-source]', `${decision.confidence_source.replaceAll('_', ' ')} · ${Math.round(decision.confidence * 100)}%`);
    set('[data-decision-backend]', decision.model.id);
    set('[data-decision-version]', decision.model.version);
    set('[data-decision-hash]', decision.model.sha256 ?? 'Not applicable');
    set('[data-check-summary]', corrections.length > 0
      ? `An operator corrected ${corrections.length} recorded field${corrections.length === 1 ? '' : 's'}; the original decision remains in the trail.`
      : detail.gate.route === 'auto_approve' ? 'Required landing checks passed.'
        : `Operator review required: ${lot.gate_reason ?? detail.gate.reason.replaceAll('_', ' ')}.`);
    const audit = root?.querySelector<HTMLOListElement>('[data-lot-audit]');
    if (audit) {
      audit.replaceChildren();
      for (const event of detail.audit) {
        const item = document.createElement('li');
        const action = document.createElement('strong');
        action.textContent = `${event.entity_type}: ${event.from_status ?? 'new'} → ${event.to_status ?? 'recorded'}`;
        const meta = document.createElement('span');
        meta.textContent = `${event.actor_kind} · ${event.actor_id} · ${new Date(event.at).toLocaleString('ja-JP')}`;
        item.append(action, meta);
        audit.append(item);
      }
      if (detail.audit.length === 0) {
        const item = document.createElement('li');
        item.textContent = 'No recorded actions are available for this lot.';
        audit.append(item);
      }
    }
    if (content) content.hidden = false;
    if (bidding) bidding.hidden = detail.listing?.status !== 'open';
    if (evidence) evidence.hidden = false;
    if (message) message.textContent = '';
    if (recovery) recovery.hidden = true;
  }

  evidenceAction?.addEventListener('click', () => {
    if (evidenceAction.getAttribute('href') === '#lot-evidence' && proofDetails) proofDetails.open = true;
  });

  if (!id) {
    showUnavailable('No lot was selected. Return to the market and choose a lot.');
  } else if (!api) {
    if (!showPreview(id)) showUnavailable('The public market API is not connected, so this lot cannot be checked.');
  } else {
    void fetch(`${api}/v1/lots/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(12_000) })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? 'Lot not found.' : `Lot unavailable (${response.status}).`);
        return response.json() as Promise<Detail>;
      })
      .then(showLive)
      .catch((error) => {
        if (!showPreview(id)) showUnavailable(error instanceof Error ? error.message : 'The lot could not be loaded.');
      });
  }
}
