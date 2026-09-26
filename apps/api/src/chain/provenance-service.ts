import type { Database } from 'bun:sqlite';
import {
  canonicalJson, ChainUnavailable, explorerUrl, sha256Hex,
  type AnchorStatus, type ChainGateway, type ChainProblem, type Hex,
} from './provenance';

type LotSnapshotRow = {
  lot_id: string;
  org_id: string;
  scan_id: string;
  decision_id: string;
  observation_id: string;
  observation_json: string;
  decision_json: string;
};

type CorrectionRow = {
  id: string;
  field: string;
  model_value: string | null;
  human_value: string;
  reason: string;
  actor_id: string;
  created_at: number;
};

type RecordRow = {
  id: string;
  lot_id: string;
  org_id: string;
  payload_hash: Hex;
  chain_id: number;
  tx_hash: Hex | null;
  anchor_status: AnchorStatus;
  created_at: number;
  updated_at: number;
};

export type PublicProvenanceRecord = RecordRow & {
  registry_address: Hex | null;
  explorer_url: string | null;
};

export type AnchorOutcome = {
  provenance_record: PublicProvenanceRecord;
  reason?: ChainProblem;
};

export class LotNotFound extends Error {}

export class ProvenanceService {
  private readonly inFlight = new Map<string, Promise<AnchorOutcome>>();

  constructor(private readonly db: Database, private readonly chain: ChainGateway) {}

  private lot(lotId: string): LotSnapshotRow {
    const row = this.db.query(`
      SELECT l.id AS lot_id, l.org_id, l.scan_id, l.decision_id,
             o.id AS observation_id, o.payload_json AS observation_json,
             d.payload_json AS decision_json
      FROM lots AS l
      JOIN decisions AS d ON d.id = l.decision_id AND d.scan_id = l.scan_id
      JOIN observations AS o ON o.id = d.observation_id AND o.scan_id = l.scan_id
      WHERE l.id = ?
    `).get(lotId) as LotSnapshotRow | null;
    if (!row) throw new LotNotFound(`Lot ${lotId} has no pinned observation and decision`);
    return row;
  }

  private async snapshot(lotId: string): Promise<{ orgId: string; hash: Hex; lotHash: Hex }> {
    const lot = this.lot(lotId);
    const corrections = this.db.query(`
      SELECT id, field, model_value, human_value, reason, actor_id, created_at
      FROM corrections
      WHERE scan_id = ? AND (lot_id IS NULL OR lot_id = ?)
      ORDER BY created_at, id
    `).all(lot.scan_id, lotId) as CorrectionRow[];
    const payload = {
      schema: 'reeldeal.provenance.v1',
      lot_id: lot.lot_id,
      scan_id: lot.scan_id,
      observation: { ...JSON.parse(lot.observation_json) as object, id: lot.observation_id },
      decision: { ...JSON.parse(lot.decision_json) as object, id: lot.decision_id },
      corrections,
    };
    return {
      orgId: lot.org_id,
      hash: await sha256Hex(canonicalJson(payload)),
      lotHash: await sha256Hex(lotId),
    };
  }

  private find(lotId: string, payloadHash: Hex): RecordRow | null {
    return this.db.query(`
      SELECT * FROM provenance_records
      WHERE lot_id = ? AND chain_id = ? AND payload_hash = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(lotId, this.chain.config.chainId, payloadHash) as RecordRow | null;
  }

  private all(lotId: string): RecordRow[] {
    return this.db.query(`
      SELECT * FROM provenance_records WHERE lot_id = ? ORDER BY created_at DESC, rowid DESC
    `).all(lotId) as RecordRow[];
  }

  private publicRecord(row: RecordRow): PublicProvenanceRecord {
    return {
      ...row,
      registry_address: row.chain_id === this.chain.config.chainId
        ? this.chain.config.registryAddress : null,
      explorer_url: explorerUrl(row.chain_id, row.tx_hash),
    };
  }

  private event(row: RecordRow, from: AnchorStatus | null, to: AnchorStatus, reason?: ChainProblem): void {
    this.db.query(`
      INSERT INTO audit_log
        (id, entity_type, entity_id, org_id, actor_kind, actor_id,
         from_status, to_status, request_id, payload_json, at)
      VALUES (?, 'ProvenanceRecord', ?, ?, 'system', 'chain-adapter', ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), row.id, row.org_id, from, to, crypto.randomUUID(),
      JSON.stringify({ payload_hash: row.payload_hash, chain_id: row.chain_id, reason: reason ?? null }),
      Date.now(),
    );
  }

  private create(lotId: string, orgId: string, payloadHash: Hex): RecordRow {
    return this.db.transaction(() => {
      const existing = this.find(lotId, payloadHash);
      if (existing) return existing;
      const timestamp = Date.now();
      const row: RecordRow = {
        id: crypto.randomUUID(), lot_id: lotId, org_id: orgId,
        payload_hash: payloadHash, chain_id: this.chain.config.chainId,
        tx_hash: null, anchor_status: 'pending',
        created_at: timestamp, updated_at: timestamp,
      };
      this.db.query(`
        INSERT INTO provenance_records
          (id, lot_id, org_id, payload_hash, chain_id, tx_hash, anchor_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NULL, 'pending', ?, ?)
      `).run(row.id, row.lot_id, row.org_id, row.payload_hash, row.chain_id, timestamp, timestamp);
      this.event(row, null, 'pending');
      return row;
    })();
  }

  private transition(row: RecordRow, to: AnchorStatus, txHash: Hex | null, reason?: ChainProblem): RecordRow {
    return this.db.transaction(() => {
      const current = this.db.query('SELECT * FROM provenance_records WHERE id = ?').get(row.id) as RecordRow;
      if (current.anchor_status !== row.anchor_status || current.tx_hash !== row.tx_hash) return current;
      const updated = { ...current, anchor_status: to, tx_hash: txHash, updated_at: Date.now() };
      this.db.query(`
        UPDATE provenance_records SET anchor_status = ?, tx_hash = ?, updated_at = ? WHERE id = ?
      `).run(to, txHash, updated.updated_at, row.id);
      this.event(updated, current.anchor_status, to, reason);
      return updated;
    })();
  }

  private async reconcile(row: RecordRow, lotHash: Hex): Promise<AnchorOutcome> {
    if (row.chain_id !== this.chain.config.chainId || !row.tx_hash || row.anchor_status !== 'submitted') {
      return { provenance_record: this.publicRecord(row) };
    }
    try {
      const receipt = await this.chain.receipt(row.tx_hash, lotHash, row.payload_hash);
      if (receipt.state === 'waiting') return { provenance_record: this.publicRecord(row) };
      if (receipt.state === 'confirmed') {
        row = this.transition(row, 'confirmed', row.tx_hash);
        return { provenance_record: this.publicRecord(row) };
      }
      row = this.transition(row, 'failed', row.tx_hash, receipt.reason);
      return { provenance_record: this.publicRecord(row), reason: receipt.reason };
    } catch (error) {
      const reason = error instanceof ChainUnavailable ? error.reason : 'rpc_unavailable';
      return { provenance_record: this.publicRecord(row), reason };
    }
  }

  async anchor(lotId: string): Promise<AnchorOutcome> {
    const current = this.inFlight.get(lotId);
    if (current) return current;
    const task = this.anchorOnce(lotId);
    this.inFlight.set(lotId, task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(lotId);
    }
  }

  private async anchorOnce(lotId: string): Promise<AnchorOutcome> {
    const { orgId, hash, lotHash } = await this.snapshot(lotId);
    let row = this.create(lotId, orgId, hash);
    if (row.anchor_status === 'submitted') return this.reconcile(row, lotHash);
    if (row.anchor_status === 'confirmed' || row.anchor_status === 'failed') {
      return { provenance_record: this.publicRecord(row) };
    }

    try {
      // Recover a mined transaction if the process died after broadcast but
      // before its hash was committed to SQLite. Fail closed when lookup fails.
      const existingTx = await this.chain.findExisting(lotHash, hash);
      if (existingTx) {
        row = this.transition(row, 'submitted', existingTx);
        return this.reconcile(row, lotHash);
      }
      const uri = `https://superposition.github.io/reeldeal/provenance/?lot_id=${encodeURIComponent(lotId)}`;
      const txHash = await this.chain.submit(lotHash, hash, uri);
      row = this.transition(row, 'submitted', txHash);
      return { provenance_record: this.publicRecord(row) };
    } catch (error) {
      const reason = error instanceof ChainUnavailable ? error.reason : 'broadcast_failed';
      this.event(row, 'pending', 'pending', reason);
      return { provenance_record: this.publicRecord(row), reason };
    }
  }

  async get(lotId: string): Promise<{ lot_id: string; current_payload_hash: Hex; records: PublicProvenanceRecord[] }> {
    const { hash, lotHash } = await this.snapshot(lotId);
    const rows = this.all(lotId);
    const records: PublicProvenanceRecord[] = [];
    for (const row of rows) {
      const outcome = await this.reconcile(row, lotHash);
      records.push(outcome.provenance_record);
    }
    return { lot_id: lotId, current_payload_hash: hash, records };
  }
}
