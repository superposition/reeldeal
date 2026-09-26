export const SCANNER_DRAFT_KEY = 'reeldeal:scanner-draft:v1';
// localStorage commonly has a small per-origin quota. Leave room for other app state.
export const MAX_SCANNER_DRAFT_CHARS = 2_000_000;

export type ScannerDraft = {
  version: 1;
  scanId: string;
  capturedAt: string;
  imageRef: string;
  lengthMm: string;
  weightG: string;
  speciesLabel: string;
  operatorId: string;
};

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type ReadResult = { state: 'none' | 'restored' | 'invalid' | 'unavailable'; draft?: ScannerDraft };

function validDraft(value: unknown): value is ScannerDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<ScannerDraft>;
  return draft.version === 1
    && typeof draft.scanId === 'string' && draft.scanId.length > 0 && draft.scanId.length <= 128
    && typeof draft.capturedAt === 'string' && Number.isFinite(Date.parse(draft.capturedAt))
    && typeof draft.imageRef === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(draft.imageRef)
    && draft.imageRef.length <= MAX_SCANNER_DRAFT_CHARS
    && ['lengthMm', 'weightG', 'speciesLabel', 'operatorId'].every((field) =>
      typeof draft[field as keyof ScannerDraft] === 'string');
}

export function readScannerDraft(storage: DraftStorage | null): ReadResult {
  if (!storage) return { state: 'unavailable' };
  try {
    const raw = storage.getItem(SCANNER_DRAFT_KEY);
    if (raw === null) return { state: 'none' };
    if (raw.length <= MAX_SCANNER_DRAFT_CHARS) {
      try {
        const draft: unknown = JSON.parse(raw);
        if (validDraft(draft)) return { state: 'restored', draft };
      } catch { /* Corrupt local data is cleared below. */ }
    }
    storage.removeItem(SCANNER_DRAFT_KEY);
    return { state: 'invalid' };
  } catch {
    return { state: 'unavailable' };
  }
}

export function writeScannerDraft(storage: DraftStorage | null, draft: ScannerDraft): 'saved' | 'too_large' | 'unavailable' {
  if (!storage) return 'unavailable';
  const raw = JSON.stringify(draft);
  if (raw.length > MAX_SCANNER_DRAFT_CHARS) {
    try {
      storage.removeItem(SCANNER_DRAFT_KEY);
      return 'too_large';
    } catch {
      return 'unavailable';
    }
  }
  try {
    storage.setItem(SCANNER_DRAFT_KEY, raw);
    return 'saved';
  } catch {
    try { storage.removeItem(SCANNER_DRAFT_KEY); } catch { /* The browser may also block clearing. */ }
    return 'unavailable';
  }
}

export function clearScannerDraft(storage: DraftStorage | null): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(SCANNER_DRAFT_KEY);
    return true;
  } catch {
    return false;
  }
}
