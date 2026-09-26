import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'bun:test';
import { gate, ObservationSchema, TypedDecisionInputSchema } from '../packages/domain/src/index';
import { demoFixtures, previewDemoLots, seedDemoData } from './seed';

function freshDb(): Database {
  const db = new Database(':memory:', { strict: true });
  db.exec(readFileSync(new URL('../apps/api/src/db/schema.sql', import.meta.url), 'utf8'));
  return db;
}

const count = (db: Database, table: string): number =>
  Number((db.query(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count);

test('seeds six exact Kesennuma fixtures with two lots in each demo status', async () => {
  const db = freshDb();
  try {
    expect(await seedDemoData(db)).toEqual({ inserted: 6, skipped: 0 });
    const preview = previewDemoLots(db);
    expect(preview).toHaveLength(6);
    expect(preview.map(({ species, species_ja, length_mm, weight_g }) => [species, species_ja, length_mm, weight_g])).toEqual(
      demoFixtures.map((fixture) => [fixture.slug, fixture.speciesJa, fixture.lengthMm, fixture.weightG]),
    );
    expect(preview.map((lot) => lot.status)).toEqual(['listed', 'listed', 'pending_review', 'pending_review', 'sold', 'sold']);
    expect(preview.map((lot) => lot.gate_reason)).toEqual([null, null, 'low_decision_confidence', 'noul', null, null]);
    expect(preview[3].confidence).toBe(1);
    expect(preview[3].decision_kind).toBe('noul');

    expect(count(db, 'fish_scans')).toBe(6);
    expect(count(db, 'observations')).toBe(6);
    expect(count(db, 'decisions')).toBe(6);
    expect(count(db, 'lots')).toBe(6);
    expect(count(db, 'listings')).toBe(4);
    expect((db.query('SELECT status FROM listings ORDER BY id').all() as Array<{ status: string }>).map((row) => row.status))
      .toEqual(['settled', 'open', 'settled', 'open']);
  } finally {
    db.close();
  }
});

test('decisions are real deterministic stub outputs and false completeness cannot auto-approve', async () => {
  const db = freshDb();
  try {
    await seedDemoData(db);
    const rows = db.query(`SELECT o.payload_json AS observation, d.payload_json AS decision, l.status, l.gate_reason
      FROM lots l JOIN observations o ON o.scan_id = l.scan_id JOIN decisions d ON d.id = l.decision_id`).all() as
      Array<{ observation: string; decision: string; status: string; gate_reason: string | null }>;
    for (const row of rows) {
      const observation = ObservationSchema.parse(JSON.parse(row.observation));
      const decision = TypedDecisionInputSchema.parse(JSON.parse(row.decision));
      expect(decision.model.id).toMatch(/^reeldeal-(stub|policy)$/);
      const verdict = gate(decision, observation);
      expect(verdict.route).toBe(row.status === 'pending_review' ? 'pending_review' : 'auto_approve');
      if (verdict.route === 'pending_review') expect(row.gate_reason).toBe(verdict.reason);
      if (decision.kind === 'noul') {
        expect(decision.question_id).toBe('completeness');
        expect(decision.noul_value).toBe(false);
        expect(decision.noul_probability).toBe(0);
        expect(decision.confidence).toBe(1);
      }
    }
  } finally {
    db.close();
  }
});

test('provenance is visibly demo-only, hash-backed, pending, and never claims a transaction', async () => {
  const db = freshDb();
  try {
    await seedDemoData(db);
    const rows = db.query(`SELECT p.id, p.payload_hash, p.anchor_status, p.tx_hash,
        o.payload_json AS observation, d.payload_json AS decision, a.payload_json AS audit
      FROM provenance_records p
      JOIN lots l ON l.id = p.lot_id
      JOIN observations o ON o.scan_id = l.scan_id
      JOIN decisions d ON d.id = l.decision_id
      JOIN audit_log a ON a.entity_id = l.id`).all() as Array<{
        id: string; payload_hash: string; anchor_status: string; tx_hash: string | null;
        observation: string; decision: string; audit: string;
      }>;
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.id).toStartWith('demo-provenance-');
      expect(row.anchor_status).toBe('pending');
      expect(row.tx_hash).toBeNull();
      expect(JSON.parse(row.audit)).toMatchObject({ demo: true, synthetic: true, no_real_sale_or_chain_tx: true });
      const expectedHash = `0x${createHash('sha256').update(JSON.stringify({
        demo: true, observation: JSON.parse(row.observation), decision: JSON.parse(row.decision),
      })).digest('hex')}`;
      expect(row.payload_hash).toBe(expectedHash);
    }
    expect(count(db, 'bids')).toBe(0);
    expect(count(db, 'sales')).toBe(0);
    expect(count(db, 'payments')).toBe(0);
  } finally {
    db.close();
  }
});

test('second run is idempotent and preview is read-only', async () => {
  const db = freshDb();
  try {
    await seedDemoData(db);
    db.query('UPDATE lots SET price_jpy = 2999 WHERE id = ?').run('demo-lot-sanma');
    expect(await seedDemoData(db)).toEqual({ inserted: 0, skipped: 6 });
    expect(count(db, 'lots')).toBe(6);
    expect(count(db, 'provenance_records')).toBe(6);
    expect(count(db, 'audit_log')).toBe(6);
    const before = count(db, 'lots');
    expect(previewDemoLots(db)[0].price_jpy).toBe(2999);
    expect(count(db, 'lots')).toBe(before);
  } finally {
    db.close();
  }
});
