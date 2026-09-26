import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import './Scanner.css';

type SavedObservation = {
  id: string;
  scan_id: string;
  captured_at: string;
  length_mm: number | null;
  weight_g: number | null;
};

type SaveResponse = {
  observation: SavedObservation;
  replayed: boolean;
  replaced: boolean;
};

const LAST_SCAN_KEY = 'reeldeal:last-scan-id';
const ACTIVE_SCAN_KEY = 'reeldeal:active-scan-id';

export default function Scanner(props: { apiOrigin: string }) {
  let video!: HTMLVideoElement;
  let stream: MediaStream | undefined;
  const [camera, setCamera] = createSignal<'idle' | 'starting' | 'ready' | 'unavailable'>('idle');
  const [cameraMessage, setCameraMessage] = createSignal('Start the camera to make a real observation.');
  const [imageRef, setImageRef] = createSignal<string | null>(null);
  const [capturedAt, setCapturedAt] = createSignal<string | null>(null);
  const [scanId, setScanId] = createSignal<string | null>(null);
  const [lengthMm, setLengthMm] = createSignal('');
  const [weightG, setWeightG] = createSignal('');
  const [speciesLabel, setSpeciesLabel] = createSignal('');
  const [operatorId, setOperatorId] = createSignal('');
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [saving, setSaving] = createSignal(false);
  const [saveMessage, setSaveMessage] = createSignal('');
  const [lastSaved, setLastSaved] = createSignal<SavedObservation | null>(null);
  const [lastSavedMessage, setLastSavedMessage] = createSignal('');
  const api = props.apiOrigin.replace(/\/$/, '');

  onMount(() => {
    const activeId = localStorage.getItem(ACTIVE_SCAN_KEY);
    if (activeId) setScanId(activeId);
    const previousId = activeId ?? localStorage.getItem(LAST_SCAN_KEY);
    if (!previousId) return;
    if (!api) {
      setLastSavedMessage('A prior scan ID is stored here, but this page has no API connection to verify it.');
      return;
    }
    void fetch(`${api}/v1/observations/${encodeURIComponent(previousId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('The saved scan could not be loaded from the API.');
        const body = await response.json() as { observation: SavedObservation };
        setLastSaved(body.observation);
      })
      .catch(() => setLastSavedMessage('The last scan ID is saved locally, but the API is unavailable. Try again when it is connected.'));
  });

  onCleanup(() => {
    stream?.getTracks().forEach((track) => track.stop());
  });

  async function startCamera() {
    setCamera('starting');
    setCameraMessage('Waiting for camera permission…');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('unavailable');
      setCameraMessage('This browser cannot open a camera here. Use HTTPS or localhost, and a browser with camera support.');
      return;
    }
    try {
      stream?.getTracks().forEach((track) => track.stop());
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } });
      video.srcObject = stream;
      await video.play();
      setCamera('ready');
      setCameraMessage('Camera ready. Frame the landing, then take a photo.');
    } catch (error) {
      setCamera('unavailable');
      const denied = error instanceof DOMException && error.name === 'NotAllowedError';
      setCameraMessage(denied
        ? 'Camera permission was denied. Enable it in browser settings and try again. Measurements remain editable; saving needs a real photo.'
        : 'The camera could not start. Check the connection and try again. Measurements remain editable; saving needs a real photo.');
    }
  }

  function takePhoto() {
    if (camera() !== 'ready' || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    const ratio = video.videoHeight / video.videoWidth;
    canvas.width = Math.min(video.videoWidth, 960);
    canvas.height = Math.round(canvas.width * ratio);
    const context = canvas.getContext('2d');
    if (!context) {
      setCameraMessage('This browser could not capture the frame. Try again.');
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setImageRef(canvas.toDataURL('image/jpeg', 0.8));
    setCapturedAt(new Date().toISOString());
    const currentId = scanId() ?? crypto.randomUUID();
    setScanId(currentId);
    localStorage.setItem(ACTIVE_SCAN_KEY, currentId);
    setSaveMessage('Photo captured. Review the facts before saving.');
  }

  function numberOrNull(value: string, field: string, maximum: number, nextErrors: Record<string, string>) {
    if (value.trim() === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > maximum) {
      nextErrors[field] = `Enter a number from 0 to ${maximum.toLocaleString()}.`;
      return null;
    }
    return number;
  }

  function validate() {
    const nextErrors: Record<string, string> = {};
    const length = numberOrNull(lengthMm(), 'length_mm', 2000, nextErrors);
    const weight = numberOrNull(weightG(), 'weight_g', 200000, nextErrors);
    const species = speciesLabel().trim();
    const operator = operatorId().trim();
    if (Boolean(species) !== Boolean(operator)) {
      nextErrors.species_label = 'Enter both the species label and the confirming operator, or leave both blank for review.';
    }
    setErrors(nextErrors);
    return { valid: Object.keys(nextErrors).length === 0, length, weight, species, operator };
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    const facts = validate();
    if (!facts.valid) return;
    if (!imageRef() || !capturedAt() || !scanId()) {
      setSaveMessage('Take a real camera photo before saving this observation.');
      return;
    }
    if (!api) {
      setSaveMessage('Saving is unavailable because no public API origin is configured for this site.');
      return;
    }
    setSaving(true);
    setSaveMessage('Saving observation…');
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${api}/v1/observations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          scan_id: scanId(),
          captured_at: capturedAt(),
          image_ref: imageRef(),
          source: 'webcam',
          length_mm: facts.length,
          girth_mm: null,
          weight_g: facts.weight,
          ice_temp_c: null,
          species_candidates: [],
          species_label: facts.species || null,
          species_confirmed_by: facts.operator || null,
          scale_reading: { stable: false, grams: null },
        }),
      });
      const body = await response.json() as SaveResponse & { issues?: { path: (string | number)[]; message: string }[] };
      if (!response.ok) {
        if (body.issues) {
          const fieldErrors: Record<string, string> = {};
          for (const issue of body.issues) fieldErrors[String(issue.path[0] ?? 'form')] = issue.message;
          setErrors(fieldErrors);
        }
        throw new Error(response.status === 400 ? 'Check the marked fields and try again.' : `The API returned ${response.status}. Try saving again.`);
      }
      localStorage.setItem(LAST_SCAN_KEY, body.observation.scan_id);
      localStorage.removeItem(ACTIVE_SCAN_KEY);
      setLastSaved(body.observation);
      setLastSavedMessage('');
      setSaveMessage(body.replayed
        ? 'This scan was already saved. No duplicate was created.'
        : body.replaced
          ? 'Updated facts saved as a new observation under the same scan.'
          : 'Observation saved. The scan is ready for a typed decision.');
    } catch (error) {
      setSaveMessage(error instanceof DOMException && error.name === 'AbortError'
        ? 'Saving timed out. Keep this scan open and retry; the same scan ID prevents duplication.'
        : error instanceof Error ? error.message : 'Saving failed. Keep this scan open and retry.');
    } finally {
      window.clearTimeout(timer);
      setSaving(false);
    }
  }

  function newLanding() {
    localStorage.removeItem(ACTIVE_SCAN_KEY);
    setImageRef(null);
    setCapturedAt(null);
    setScanId(null);
    setLengthMm('');
    setWeightG('');
    setSpeciesLabel('');
    setOperatorId('');
    setErrors({});
    setSaveMessage('Ready for a new landing. Take a photo to assign its scan ID.');
  }

  return (
    <section class="scanner" aria-label="Landing scanner">
      <div class="scanner__grid">
        <div class="scanner__camera-panel">
          <div class="scanner__viewport">
            <video ref={video} autoplay muted playsinline aria-label="Live camera preview" style={{ display: imageRef() ? 'none' : 'block' }} />
            <Show when={imageRef()}><img src={imageRef()!} alt="Captured fish landing" /></Show>
            <Show when={camera() !== 'ready' && !imageRef()}>
              <p class="scanner__placeholder">Camera preview appears here</p>
            </Show>
          </div>
          <p class="scanner__camera-message" role={camera() === 'unavailable' ? 'alert' : 'status'}>{cameraMessage()}</p>
          <div class="scanner__actions">
            <button type="button" class="scanner__button scanner__button--secondary" onClick={startCamera} disabled={camera() === 'starting'}>
              {camera() === 'ready' ? 'Restart camera' : 'Start camera'}
            </button>
            <button type="button" class="scanner__button" onClick={takePhoto} disabled={camera() !== 'ready'}>
              {imageRef() ? 'Retake photo' : 'Take photo'}
            </button>
          </div>
          <p class="scanner__hint">The photo is evidence for the operator. No species is inferred from pixels.</p>
        </div>

        <form class="scanner__form" onSubmit={save} novalidate>
          <fieldset>
            <legend>Landing facts</legend>
            <p class="scanner__hint">Enter measured values only. Blank fields remain unknown and go to review later.</p>
            <div class="scanner__fields">
              <div class="scanner__field">
                <label for="length-mm">Length <span>(mm)</span></label>
                <input id="length-mm" type="number" inputmode="decimal" min="0" max="2000" step="any" value={lengthMm()} onInput={(event) => setLengthMm(event.currentTarget.value)} aria-invalid={Boolean(errors().length_mm)} aria-describedby="length-error" />
                <p id="length-error" class="scanner__error" role="alert">{errors().length_mm ?? ''}</p>
              </div>
              <div class="scanner__field">
                <label for="weight-g">Weight <span>(g)</span></label>
                <input id="weight-g" type="number" inputmode="decimal" min="0" max="200000" step="any" value={weightG()} onInput={(event) => setWeightG(event.currentTarget.value)} aria-invalid={Boolean(errors().weight_g)} aria-describedby="weight-error" />
                <p id="weight-error" class="scanner__error" role="alert">{errors().weight_g ?? ''}</p>
              </div>
              <div class="scanner__field">
                <label for="species-label">Species <span>(operator label)</span></label>
                <input id="species-label" type="text" autocomplete="off" value={speciesLabel()} onInput={(event) => setSpeciesLabel(event.currentTarget.value)} aria-invalid={Boolean(errors().species_label)} aria-describedby="species-error" />
                <p id="species-error" class="scanner__error" role="alert">{errors().species_label ?? ''}</p>
              </div>
              <div class="scanner__field">
                <label for="operator-id">Confirming operator</label>
                <input id="operator-id" type="text" autocomplete="off" value={operatorId()} onInput={(event) => setOperatorId(event.currentTarget.value)} aria-describedby="operator-help" />
                <p id="operator-help" class="scanner__hint">A demo attribution label, not account authentication.</p>
              </div>
            </div>
          </fieldset>
          <p class="scanner__hint">Manual weight is not a stable scale reading. The review gate will see it as unverified.</p>
          <div class="scanner__actions">
            <button type="submit" class="scanner__button" disabled={saving() || !imageRef() || !api}>
              {saving() ? 'Saving…' : 'Save observation'}
            </button>
            <button type="button" class="scanner__button scanner__button--secondary" onClick={newLanding}>New landing</button>
          </div>
          <Show when={!api}><p class="scanner__error" role="status">This site has no API connection. Set the public API origin at build time to save scans.</p></Show>
          <p class="scanner__status" role="status" aria-live="polite">{saveMessage()}</p>
        </form>
      </div>
      <Show when={lastSaved()}>
        <aside class="scanner__saved" aria-label="Last saved scan">
          <h2>Saved scan</h2>
          <p>Loaded from the API. Scan <code>{lastSaved()!.scan_id}</code> · observation <code>{lastSaved()!.id}</code></p>
          <p>Length {lastSaved()!.length_mm ?? 'unknown'} mm · weight {lastSaved()!.weight_g ?? 'unknown'} g</p>
        </aside>
      </Show>
      <Show when={lastSavedMessage()}><p class="scanner__status" role="status">{lastSavedMessage()}</p></Show>
    </section>
  );
}
