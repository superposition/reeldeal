import { afterAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import {
  canonicalJson, CastChainGateway, ChainUnavailable, sha256Hex,
  type ChainGateway, type ChainConfig, type Hex, type ReceiptResult,
} from '../src/chain/provenance';
import { ProvenanceService } from '../src/chain/provenance-service';

const LOT_ID = 'lot-0001';
const TX = `0x${'a'.repeat(64)}` as Hex;
const REGISTRY = `0x${'1'.repeat(40)}` as Hex;

class FakeChain implements ChainGateway {
  readonly config: ChainConfig = {
    chainId: 11155111,
    registryAddress: REGISTRY,
    rpcUrl: null,
    account: null,
    passwordFile: null,
  };
  submissions = 0;
  failure: 'signer_unavailable' | 'rpc_unavailable' | null = null;
  receiptResult: ReceiptResult = { state: 'waiting' };
  existingTx: Hex | null = null;

  async findExisting(_lotHash: Hex, _payloadHash: Hex): Promise<Hex | null> {
    if (this.failure === 'rpc_unavailable') throw new ChainUnavailable('rpc_unavailable');
    return this.existingTx;
  }

  async submit(_lotHash: Hex, _payloadHash: Hex, _uri: string): Promise<Hex> {
    this.submissions++;
    if (this.failure) throw new ChainUnavailable(this.failure);
    return TX;
  }

  async receipt(_txHash: Hex, _lotHash: Hex, _payloadHash: Hex): Promise<ReceiptResult> {
    if (this.failure === 'rpc_unavailable') throw new ChainUnavailable('rpc_unavailable');
    return this.receiptResult;
  }
}

function fixture() {
  const db = new Database(':memory:');
  db.exec(readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  const timestamp = 1_790_000_000_000;
  db.query(`INSERT INTO orgs (id, slug, name, created_at, updated_at)
    VALUES ('org-1', 'kessenuma', 'Kesennuma', ?, ?)`).run(timestamp, timestamp);
  db.query(`INSERT INTO fish_scans
    (id, org_id, captured_at, image_ref, source, created_at, updated_at)
    VALUES ('scan-1', 'org-1', ?, 'demo://fish', 'webcam', ?, ?)`).run(timestamp, timestamp, timestamp);
  db.query(`INSERT INTO observations
    (id, scan_id, org_id, payload_json, created_at, updated_at)
    VALUES ('observation-1', 'scan-1', 'org-1', ?, ?, ?)`)
    .run(JSON.stringify({ weight_g: 1480, length_mm: 412 }), timestamp, timestamp);
  db.query(`INSERT INTO decisions
    (id, scan_id, observation_id, org_id, question_id, kind, payload_json,
     confidence, confidence_source, model_id, model_version, runtime, latency_ms,
     created_at, updated_at)
    VALUES ('decision-1', 'scan-1', 'observation-1', 'org-1', 'grade', 'choice', ?,
      0.9, 'stub_heuristic', 'stub', 'v1', 'bun', 1, ?, ?)`)
    .run(JSON.stringify({ kind: 'choice', choice: 'accept', confidence: 0.9 }), timestamp, timestamp);
  db.query(`INSERT INTO lots
    (id, org_id, scan_id, decision_id, species_label, weight_g, price_jpy, status, created_at, updated_at)
    VALUES (?, 'org-1', 'scan-1', 'decision-1', 'sanma', 1480, 2400, 'approved', ?, ?)`)
    .run(LOT_ID, timestamp, timestamp);
  const chain = new FakeChain();
  return { db, chain, service: new ProvenanceService(db, chain) };
}

test('canonical provenance hash ignores JSON key insertion order', async () => {
  const first = canonicalJson({ b: 1, a: { y: 2, x: 3 } });
  const second = canonicalJson({ a: { x: 3, y: 2 }, b: 1 });
  expect(first).toBe(second);
  expect(await sha256Hex(first)).toMatch(/^0x[0-9a-f]{64}$/);
});

test('chain receipt confirms only the expected registry, lot, and payload event', async () => {
  const lotHash = await sha256Hex(LOT_ID);
  const payloadHash = await sha256Hex('bundle');
  let loggedPayload = payloadHash;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { method } = await request.json() as { method: string };
      const result = method === 'eth_chainId' ? '0xaa36a7'
        : method === 'eth_getCode' ? '0x6000'
        : {
          status: '0x1', logs: [{
            address: REGISTRY,
            topics: [
              '0xc963b62fcab47ee98618999ec6878152a4dcaa1329a800227b6e49451c23bf0c',
              lotHash,
              `0x${'0'.repeat(24)}${'2'.repeat(40)}`,
            ],
            data: `${loggedPayload}${'0'.repeat(64)}`,
          }],
        };
      return Response.json({ jsonrpc: '2.0', id: 1, result });
    },
  });
  try {
    const chain = new CastChainGateway({
      chainId: 11155111, registryAddress: REGISTRY,
      rpcUrl: server.url.toString(), account: null, passwordFile: null,
    });
    expect((await chain.receipt(TX, lotHash, payloadHash)).state).toBe('confirmed');
    loggedPayload = await sha256Hex('tampered');
    expect((await chain.receipt(TX, lotHash, payloadHash)).state).toBe('failed');
  } finally {
    server.stop();
  }
});

test('chain log recovery matches the exact lot and payload before reusing a transaction', async () => {
  const lotHash = await sha256Hex(LOT_ID);
  const payloadHash = await sha256Hex('bundle');
  let loggedPayload = payloadHash;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { method } = await request.json() as { method: string };
      const result = method === 'eth_chainId' ? '0xaa36a7'
        : method === 'eth_getCode' ? '0x6000'
        : [{
          address: REGISTRY,
          topics: ['0xc963b62fcab47ee98618999ec6878152a4dcaa1329a800227b6e49451c23bf0c', lotHash],
          data: `${loggedPayload}${'0'.repeat(64)}`,
          transactionHash: TX,
        }];
      return Response.json({ jsonrpc: '2.0', id: 1, result });
    },
  });
  try {
    const chain = new CastChainGateway({
      chainId: 11155111, registryAddress: REGISTRY, deploymentBlock: 10,
      rpcUrl: server.url.toString(), account: null, passwordFile: null,
    });
    expect(await chain.findExisting(lotHash, payloadHash)).toBe(TX);
    loggedPayload = await sha256Hex('different bundle');
    expect(await chain.findExisting(lotHash, payloadHash)).toBeNull();
  } finally {
    server.stop();
  }
});

test('RPC failure preserves one pending anchor, retry submits once, receipt confirms it', async () => {
  const { db, chain, service } = fixture();
  chain.failure = 'rpc_unavailable';
  const pending = await service.anchor(LOT_ID);
  expect(pending.provenance_record.anchor_status).toBe('pending');
  expect(pending.reason).toBe('rpc_unavailable');
  expect((await service.get(LOT_ID)).records).toHaveLength(1);

  chain.failure = null;
  const [first, concurrent] = await Promise.all([service.anchor(LOT_ID), service.anchor(LOT_ID)]);
  expect(first.provenance_record.anchor_status).toBe('submitted');
  expect(concurrent.provenance_record.tx_hash).toBe(TX);
  expect(chain.submissions).toBe(1); // RPC preflight failed before broadcast
  expect((await service.get(LOT_ID)).records[0]?.anchor_status).toBe('submitted');

  chain.receiptResult = { state: 'confirmed' };
  const confirmed = await service.get(LOT_ID);
  expect(confirmed.records[0]?.anchor_status).toBe('confirmed');
  expect(confirmed.records[0]?.explorer_url).toBe(`https://sepolia.etherscan.io/tx/${TX}`);
  expect((await service.anchor(LOT_ID)).provenance_record.anchor_status).toBe('confirmed');
  expect(chain.submissions).toBe(1);
  db.close();
});

test('a mined transaction missing from SQLite is recovered without another broadcast', async () => {
  const { db, chain, service } = fixture();
  chain.existingTx = TX;
  chain.receiptResult = { state: 'confirmed' };
  const outcome = await service.anchor(LOT_ID);
  expect(outcome.provenance_record.anchor_status).toBe('confirmed');
  expect(outcome.provenance_record.tx_hash).toBe(TX);
  expect(chain.submissions).toBe(0);
  db.close();
});

test('a later human correction creates a new commitment without rewriting the old one', async () => {
  const { db, service } = fixture();
  const first = await service.anchor(LOT_ID);
  db.query(`INSERT INTO corrections
    (id, scan_id, lot_id, org_id, field, model_value, human_value, reason, actor_id, created_at, updated_at)
    VALUES ('correction-1', 'scan-1', ?, 'org-1', 'species_label', 'unknown', 'sanma',
      'operator confirmed', 'operator-1', 1790000000001, 1790000000001)`).run(LOT_ID);
  const second = await service.anchor(LOT_ID);
  expect(second.provenance_record.payload_hash).not.toBe(first.provenance_record.payload_hash);
  const result = await service.get(LOT_ID);
  expect(result.records).toHaveLength(2);
  expect(result.current_payload_hash).toBe(second.provenance_record.payload_hash);
  db.close();
});

test('a mismatched receipt never becomes a confirmed anchor', async () => {
  const { db, chain, service } = fixture();
  await service.anchor(LOT_ID);
  chain.receiptResult = { state: 'failed', reason: 'receipt_mismatch' };
  const result = await service.get(LOT_ID);
  expect(result.records[0]?.anchor_status).toBe('failed');
  expect((await service.anchor(LOT_ID)).provenance_record.anchor_status).toBe('failed');
  expect(chain.submissions).toBe(1);
  db.close();
});

// Import route bindings only after forcing its default singleton to use memory.
process.env.DB_PATH = ':memory:';
const { makeProvenanceRoutes } = await import('../src/routes/provenance');
afterAll(() => { delete process.env.DB_PATH; });

test('anchor POST requires a server-side operator token; GET remains public', async () => {
  const { db, service } = fixture();
  const disabled = makeProvenanceRoutes(service, null);
  const path = `http://127.0.0.1/v1/provenance/${LOT_ID}/anchor`;
  const disabledResponse = await disabled['/v1/provenance/:lot_id/anchor'].POST(new Request(path, { method: 'POST' }));
  expect(disabledResponse.status).toBe(503);

  const routes = makeProvenanceRoutes(service, 'operator-test-token');
  const denied = await routes['/v1/provenance/:lot_id/anchor'].POST(new Request(path, { method: 'POST' }));
  expect(denied.status).toBe(401);
  const accepted = await routes['/v1/provenance/:lot_id/anchor'].POST(new Request(path, {
    method: 'POST', headers: { authorization: 'Bearer operator-test-token' },
  }));
  expect(accepted.status).toBe(202);
  const get = await routes['/v1/provenance/:lot_id'].GET(new Request(`http://127.0.0.1/v1/provenance/${LOT_ID}`));
  expect(get.status).toBe(200);
  expect((await get.json()).records).toHaveLength(1);
  db.close();
});
