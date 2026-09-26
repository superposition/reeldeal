import { describe, expect, test } from 'bun:test';

process.env.DB_PATH = ':memory:';
const { db } = await import('../src/db');
const { getObservation, postObservation } = await import('../src/routes/observations');

const input = (scanId: string) => ({
  scan_id: scanId,
  captured_at: '2026-09-26T02:00:00.000Z',
  image_ref: 'data:image/jpeg;base64,AA==',
  source: 'webcam' as const,
  length_mm: 412,
  girth_mm: null,
  weight_g: 1480,
  ice_temp_c: null,
  species_candidates: [],
  species_label: null,
  species_confirmed_by: null,
  scale_reading: { stable: false, grams: null },
});

function request(body: unknown): Request {
  return new Request('http://localhost/v1/observations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('observation intake', () => {
  test('rejects invalid fields with paths and writes nothing', async () => {
    const scanId = crypto.randomUUID();
    const response = await postObservation(request({ ...input(scanId), length_mm: -1 }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(body.issues.some((issue: { path: string[] }) => issue.path.join('.') === 'length_mm')).toBe(true);
    expect((db.query('SELECT COUNT(*) AS n FROM fish_scans WHERE id = ?').get(scanId) as { n: number }).n).toBe(0);
  });

  test('keeps one scan, replays exact input, and appends a changed observation', async () => {
    const scanId = crypto.randomUUID();
    const first = await postObservation(request(input(scanId)));
    const created = await first.json();
    expect(first.status).toBe(201);
    expect(created.replayed).toBe(false);
    expect(created.replaced).toBe(false);

    const repeat = await postObservation(request(input(scanId)));
    const replay = await repeat.json();
    expect(repeat.status).toBe(200);
    expect(replay.replayed).toBe(true);
    expect(replay.observation.id).toBe(created.observation.id);

    const changed = await postObservation(request({ ...input(scanId), weight_g: 1490 }));
    const replacement = await changed.json();
    expect(changed.status).toBe(201);
    expect(replacement.replayed).toBe(false);
    expect(replacement.replaced).toBe(true);
    expect(replacement.observation.id).not.toBe(created.observation.id);

    const persisted = await getObservation(scanId).json();
    expect(persisted.observation.id).toBe(replacement.observation.id);
    expect(persisted.observation.weight_g).toBe(1490);
    expect((db.query('SELECT COUNT(*) AS n FROM fish_scans WHERE id = ?').get(scanId) as { n: number }).n).toBe(1);
    expect((db.query('SELECT COUNT(*) AS n FROM observations WHERE scan_id = ?').get(scanId) as { n: number }).n).toBe(2);
    expect((db.query("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'FishScan' AND entity_id = ?").get(scanId) as { n: number }).n).toBe(1);
  });
});
