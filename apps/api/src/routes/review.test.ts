import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { expect, test } from 'bun:test';
import { seedDemoData } from '../../../../scripts/seed';
import { getLotReview, postLotReview } from './review';

async function freshDb(): Promise<Database> {
  const db = new Database(':memory:', { strict: true });
  db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  await seedDemoData(db);
  return db;
}

function request(field: string, humanValue: unknown, actorId = 'demo-operator'): Request {
  return new Request('http://localhost/v1/lots/demo/review', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ field, human_value: humanValue, reason: 'Operator checked the measured landing record.', actor_id: actorId, attest: true }),
  });
}

function scanTransitions(db: Database, scanId: string) {
  return db.query(`SELECT actor_kind, actor_id, from_status, to_status, request_id, payload_json
    FROM audit_log WHERE entity_type = 'FishScan' AND entity_id = ? ORDER BY at, rowid`).all(scanId) as
    Array<{ actor_kind: string; actor_id: string; from_status: string; to_status: string; request_id: string; payload_json: string }>;
}

test('forced-low decision stays immutable while an attributed human correction approves the lot once', async () => {
  const db = await freshDb();
  try {
    const before = db.query('SELECT payload_json FROM decisions WHERE id = ?').get('demo-decision-saba') as { payload_json: string };
    const response = await postLotReview(db, 'demo-lot-saba', request('weight_g', 875));
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.human_approved).toBe(true);
    expect(body.lot.status).toBe('approved');
    expect(body.review.original_gate).toEqual({ route: 'pending_review', reason: 'low_decision_confidence' });
    expect(body.review.effective_observation.weight_g).toBe(875);
    expect(body.review.original_observation.weight_g).toBe(880);
    expect(body.review.corrections[0]).toMatchObject({ field: 'weight_g', model_value: 880, human_value: 875, actor_id: 'demo-operator', human_supplied: true });
    expect((db.query('SELECT payload_json FROM decisions WHERE id = ?').get('demo-decision-saba') as { payload_json: string }).payload_json).toBe(before.payload_json);
    const transitions = db.query(`SELECT from_status, to_status, payload_json FROM audit_log
      WHERE entity_type = 'Lot' AND entity_id = ? AND from_status = 'pending_review'`).all('demo-lot-saba') as
      Array<{ from_status: string; to_status: string; payload_json: string }>;
    expect(transitions).toHaveLength(1);
    expect(transitions[0].to_status).toBe('approved');
    expect(JSON.parse(transitions[0].payload_json)).toMatchObject({ human_approved: true, original_gate: { reason: 'low_decision_confidence' } });
    expect((db.query('SELECT count(*) AS count FROM corrections WHERE lot_id = ?').get('demo-lot-saba') as { count: number }).count).toBe(1);
    expect((db.query('SELECT status FROM fish_scans WHERE id = ?').get('demo-scan-saba') as { status: string }).status).toBe('promoted');
    const scanAudit = scanTransitions(db, 'demo-scan-saba');
    expect(scanAudit.map(({ from_status, to_status }) => `${from_status}->${to_status}`)).toEqual(['decided->reviewed', 'reviewed->promoted']);
    expect(scanAudit.map(({ actor_kind, actor_id }) => `${actor_kind}:${actor_id}`)).toEqual(['user:demo-operator', 'user:demo-operator']);
    expect(scanAudit[0].request_id).toBe(body.correction.id);
    expect(scanAudit[1].request_id).toBe(body.correction.id);
    expect(JSON.parse(scanAudit[1].payload_json)).toMatchObject({ lot_id: 'demo-lot-saba', human_approved: true });
    expect((await postLotReview(db, 'demo-lot-saba', request('weight_g', 870))).status).toBe(409);
    expect(scanTransitions(db, 'demo-scan-saba')).toHaveLength(2);
  } finally { db.close(); }
});

test('false completeness noul is not abstention; an incomplete correction stays pending before reviewer approval', async () => {
  const db = await freshDb();
  try {
    const first = await postLotReview(db, 'demo-lot-hotate', request('scale_grams', 221));
    expect(first.status).toBe(200);
    const pending = await first.json() as any;
    expect(pending.human_approved).toBe(false);
    expect(pending.lot).toMatchObject({ status: 'pending_review', gate_reason: 'missing_measurements' });
    expect(pending.review.original_gate).toEqual({ route: 'pending_review', reason: 'noul' });
    expect(pending.review.original_decision).toMatchObject({ kind: 'noul', noul_value: false, confidence: 1 });
    expect(db.query(`SELECT 1 FROM audit_log WHERE entity_type = 'Lot' AND entity_id = ? AND from_status = 'pending_review'`).get('demo-lot-hotate')).toBeNull();
    expect((db.query('SELECT status FROM fish_scans WHERE id = ?').get('demo-scan-hotate') as { status: string }).status).toBe('reviewed');
    expect(scanTransitions(db, 'demo-scan-hotate').map(({ from_status, to_status }) => `${from_status}->${to_status}`)).toEqual(['decided->reviewed']);

    const second = await postLotReview(db, 'demo-lot-hotate', request('scale_stable', true));
    const approved = await second.json() as any;
    expect(approved.human_approved).toBe(true);
    expect(approved.lot.status).toBe('approved');
    expect(approved.review.corrections).toHaveLength(2);
    expect(approved.review.original_decision.noul_value).toBe(false);
    expect((db.query(`SELECT count(*) AS count FROM decisions WHERE scan_id = ?`).get('demo-scan-hotate') as { count: number }).count).toBe(1);
    expect((db.query('SELECT status FROM fish_scans WHERE id = ?').get('demo-scan-hotate') as { status: string }).status).toBe('promoted');
    const scanAudit = scanTransitions(db, 'demo-scan-hotate');
    expect(scanAudit.map(({ from_status, to_status }) => `${from_status}->${to_status}`)).toEqual(['decided->reviewed', 'reviewed->promoted']);
    expect(scanAudit[0].request_id).toBe(pending.correction.id);
    expect(scanAudit[1].request_id).toBe(approved.correction.id);
  } finally { db.close(); }
});

test('server rejects unauthorized, unattested, and non-pending review attempts without writes', async () => {
  const db = await freshDb();
  try {
    expect((await postLotReview(db, 'demo-lot-saba', request('weight_g', 875, 'unknown-reviewer'))).status).toBe(403);
    expect((await postLotReview(db, 'demo-lot-sanma', request('weight_g', 1478))).status).toBe(409);
    const unattested = new Request('http://localhost/v1/lots/demo/review', { method: 'POST',
      body: JSON.stringify({ field: 'weight_g', human_value: 875, reason: 'Operator checked the measured landing record.', actor_id: 'demo-operator', attest: false }) });
    expect((await postLotReview(db, 'demo-lot-saba', unattested)).status).toBe(400);
    expect((db.query('SELECT count(*) AS count FROM corrections').get() as { count: number }).count).toBe(0);
    expect(scanTransitions(db, 'demo-scan-saba')).toHaveLength(0);

    db.query("UPDATE fish_scans SET status = 'observed' WHERE id = 'demo-scan-saba'").run();
    const wrongScan = await postLotReview(db, 'demo-lot-saba', request('weight_g', 875));
    expect(wrongScan.status).toBe(409);
    expect((await wrongScan.json()).error).toBe('scan_not_reviewable');
    expect((db.query('SELECT count(*) AS count FROM corrections').get() as { count: number }).count).toBe(0);
    expect(scanTransitions(db, 'demo-scan-saba')).toHaveLength(0);
  } finally { db.close(); }
});

test('a failed promotion audit rolls back scan, lot, and correction together', async () => {
  const db = await freshDb();
  try {
    db.exec(`CREATE TRIGGER reject_scan_promotion BEFORE INSERT ON audit_log
      WHEN NEW.entity_type = 'FishScan' AND NEW.to_status = 'promoted'
      BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END;`);
    await expect(postLotReview(db, 'demo-lot-saba', request('weight_g', 875))).rejects.toThrow('injected audit failure');
    expect((db.query('SELECT status FROM fish_scans WHERE id = ?').get('demo-scan-saba') as { status: string }).status).toBe('decided');
    expect((db.query('SELECT status FROM lots WHERE id = ?').get('demo-lot-saba') as { status: string }).status).toBe('pending_review');
    expect((db.query('SELECT count(*) AS count FROM corrections WHERE lot_id = ?').get('demo-lot-saba') as { count: number }).count).toBe(0);
    expect(scanTransitions(db, 'demo-scan-saba')).toHaveLength(0);
  } finally { db.close(); }
});

test('review snapshot is read-only and visibly separates original and human-supplied facts', async () => {
  const db = await freshDb();
  try {
    expect((await getLotReview(db, 'unknown')).status).toBe(404);
    await postLotReview(db, 'demo-lot-saba', request('weight_g', 875));
    const result = await getLotReview(db, 'demo-lot-saba');
    expect(result.status).toBe(200);
    const body = await result.json() as any;
    expect(body.review.original_observation.weight_g).toBe(880);
    expect(body.review.effective_observation.weight_g).toBe(875);
    expect(body.review.corrections[0].human_supplied).toBe(true);
  } finally { db.close(); }
});
