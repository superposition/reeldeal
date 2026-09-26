import { describe, expect, test } from 'bun:test';
import {
  clearScannerDraft,
  MAX_SCANNER_DRAFT_CHARS,
  readScannerDraft,
  SCANNER_DRAFT_KEY,
  writeScannerDraft,
  type ScannerDraft,
} from './scanner-draft';

const photo = 'data:image/jpeg;base64,/9j/2Q=='; // Synthetic JPEG bytes, not a real landing.
const draft: ScannerDraft = {
  version: 1,
  scanId: 'synthetic-scan-1',
  capturedAt: '2026-09-26T01:00:00.000Z',
  imageRef: photo,
  lengthMm: '345',
  weightG: '810',
  speciesLabel: 'Demo fish',
  operatorId: 'Tester',
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('scanner local draft', () => {
  test('restores the same photo, scan ID, timestamp, and manually entered facts after a reload', () => {
    const storage = memoryStorage();
    expect(writeScannerDraft(storage, draft)).toBe('saved');
    const afterReload = readScannerDraft(storage);
    expect(afterReload).toEqual({ state: 'restored', draft });
  });

  test('successful save or new landing clears the draft so it cannot reappear', () => {
    const storage = memoryStorage();
    writeScannerDraft(storage, draft);
    expect(clearScannerDraft(storage)).toBe(true);
    expect(readScannerDraft(storage)).toEqual({ state: 'none' });
  });

  test('rejects oversized drafts and clears an older draft instead of restoring stale facts', () => {
    const storage = memoryStorage();
    writeScannerDraft(storage, draft);
    expect(writeScannerDraft(storage, { ...draft, imageRef: `${photo}${'A'.repeat(MAX_SCANNER_DRAFT_CHARS)}` })).toBe('too_large');
    expect(readScannerDraft(storage)).toEqual({ state: 'none' });
  });

  test('discards malformed or unexpected local data', () => {
    const storage = memoryStorage();
    storage.setItem(SCANNER_DRAFT_KEY, '{');
    expect(readScannerDraft(storage)).toEqual({ state: 'invalid' });
    storage.setItem(SCANNER_DRAFT_KEY, JSON.stringify({ ...draft, imageRef: 'data:image/svg+xml,<svg />' }));
    expect(readScannerDraft(storage)).toEqual({ state: 'invalid' });
    expect(storage.values.has(SCANNER_DRAFT_KEY)).toBe(false);
  });

  test('storage denial does not throw or claim that a draft was saved', () => {
    const denied = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(readScannerDraft(denied)).toEqual({ state: 'unavailable' });
    expect(writeScannerDraft(denied, draft)).toBe('unavailable');
    expect(clearScannerDraft(denied)).toBe(false);
    expect(readScannerDraft(null)).toEqual({ state: 'unavailable' });
  });
});
