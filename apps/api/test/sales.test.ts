import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BID_TYPES, bidDomain } from '@reeldeal/domain';
import { seedDemoData } from '../../../scripts/seed';
import { postBid } from '../src/routes/bid-service';
import { postAccept, postPay } from '../src/routes/sale-service';
import { makeSaleRoutes } from '../src/routes/sales';

// Public deterministic keys and token for isolated tests only. Never fund these wallets.
const buyers = [
  privateKeyToAccount(`0x${'11'.repeat(32)}` as Hex),
  privateKeyToAccount(`0x${'22'.repeat(32)}` as Hex),
];
const TOKEN = 'local-test-token-not-a-secret';
const LISTING_ID = 'demo-listing-sanma';
const TX = `0x${'a1'.repeat(32)}`;

async function freshDb(): Promise<Database> {
  const db = new Database(':memory:', { strict: true });
  db.exec(readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  await seedDemoData(db);
  return db;
}

async function place(db: Database, buyerIndex: number, listingId = LISTING_ID): Promise<string> {
  const buyer = buyers[buyerIndex]!;
  const amount_jpy = 2600 + buyerIndex * 100;
  const nonce = String(buyerIndex + 1);
  const signature = await buyer.signTypedData({
    domain: bidDomain(1), types: BID_TYPES, primaryType: 'Bid',
    message: { listing_id: listingId, amount_jpy: BigInt(amount_jpy), bidder: buyer.address, nonce: BigInt(nonce) },
  });
  const body = { listing_id: listingId, amount_jpy, bidder: buyer.address, nonce, signature };
  const response = await postBid(db, listingId, new Request(`http://localhost/v1/listings/${listingId}/bids`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), 1);
  expect(response.status).toBe(201);
  return (await response.json()).bid.id as string;
}

function acceptRequest(bidId: string, auth: string | null = TOKEN): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-request-id': `accept-${bidId}` };
  if (auth !== null) headers.authorization = `Bearer ${auth}`;
  return new Request(`http://localhost/v1/listings/${LISTING_ID}/accept`, {
    method: 'POST', headers, body: JSON.stringify({ bid_id: bidId }),
  });
}

function payRequest(saleId: string, body: unknown = { tx_hash: TX }, auth: string | null = TOKEN): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-request-id': `pay-${saleId}` };
  if (auth !== null) headers.authorization = `Bearer ${auth}`;
  return new Request(`http://localhost/v1/sales/${saleId}/pay`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
}

function count(db: Database, table: string): number {
  return (db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function status(db: Database, table: string, id: string): string {
  return (db.query(`SELECT status FROM ${table} WHERE id = ?`).get(id) as { status: string }).status;
}

function listingAttempts(db: Database): Array<{ from_status: string; to_status: string; actor_kind: string; actor_id: string; request_id: string; payload: Record<string, unknown> }> {
  const rows = db.query("SELECT from_status,to_status,actor_kind,actor_id,request_id,payload_json FROM audit_log WHERE entity_type = 'Listing' AND entity_id = ? ORDER BY at,rowid")
    .all(LISTING_ID) as Array<{ from_status: string; to_status: string; actor_kind: string; actor_id: string; request_id: string; payload_json: string }>;
  return rows.map(({ payload_json, ...row }) => ({ ...row, payload: JSON.parse(payload_json) }));
}

describe('single-winner demo sale', () => {
  test('mounted HTTP routes return 201/409 for accept and 201 for unverified demo pay', async () => {
    const db = await freshDb();
    const [first, second] = await Promise.all([place(db, 0), place(db, 1)]);
    const server = Bun.serve({
      hostname: '127.0.0.1', port: 0, routes: makeSaleRoutes(db, TOKEN),
      fetch: () => Response.json({ error: 'not_found' }, { status: 404 }),
    });
    try {
      const url = new URL(`/v1/listings/${LISTING_ID}/accept`, server.url);
      const send = (bidId: string) => fetch(url, {
        method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ bid_id: bidId }),
      });
      const outcomes = await Promise.all([send(first), send(second)]);
      expect(outcomes.map((response) => response.status).sort()).toEqual([201, 409]);
      const bodies = await Promise.all(outcomes.map((response) => response.json()));
      const sale = bodies[outcomes.findIndex((response) => response.status === 201)].sale;
      expect(bodies[outcomes.findIndex((response) => response.status === 409)].winning_bid_id).toBe(sale.bid_id);
      const paid = await fetch(new URL(`/v1/sales/${sale.id}/pay`, server.url), {
        method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ tx_hash: TX }),
      });
      expect(paid.status).toBe(201);
      expect(await paid.json()).toMatchObject({ demo: true, verification: 'unverified', payment: { tx_hash: TX, status: 'captured' } });
    } finally {
      server.stop(true);
      db.close();
    }
  });

  test('two signed buyers racing to accept yield one sale, one winning bid, and both attempt audits', async () => {
    const db = await freshDb();
    const [first, second] = await Promise.all([place(db, 0), place(db, 1)]);
    const outcomes = await Promise.all([
      postAccept(db, LISTING_ID, acceptRequest(first), TOKEN),
      postAccept(db, LISTING_ID, acceptRequest(second), TOKEN),
    ]);
    expect(outcomes.map((response) => response.status).sort()).toEqual([201, 409]);
    const bodies = await Promise.all(outcomes.map((response) => response.json()));
    const success = bodies[outcomes.findIndex((response) => response.status === 201)];
    const conflict = bodies[outcomes.findIndex((response) => response.status === 409)];
    const sale = success.sale;
    expect(success).toMatchObject({ demo: true, verification: 'unverified' });
    expect(conflict).toMatchObject({ error: 'listing_already_accepted', winning_bid_id: sale.bid_id });
    expect([first, second]).toContain(sale.bid_id);
    expect(count(db, 'sales')).toBe(1);
    expect(count(db, 'payments')).toBe(1);
    expect(status(db, 'listings', LISTING_ID)).toBe('accepted');
    expect(status(db, 'lots', 'demo-lot-sanma')).toBe('reserved');
    expect(status(db, 'bids', sale.bid_id)).toBe('accepted');
    expect(status(db, 'bids', sale.bid_id === first ? second : first)).toBe('outbid');
    expect(status(db, 'payments', (db.query('SELECT id FROM payments WHERE sale_id = ?').get(sale.id) as { id: string }).id)).toBe('quoted');
    const attempts = listingAttempts(db);
    expect(attempts).toHaveLength(2);
    expect(attempts.map((attempt) => attempt.payload.outcome)).toEqual(['accepted', 'conflict']);
    expect(attempts.every((attempt) => attempt.payload.action === 'accept')).toBe(true);
    expect(attempts.map((attempt) => attempt.request_id).sort()).toEqual([`accept-${first}`, `accept-${second}`].sort());
    expect(attempts.every((attempt) => attempt.actor_kind === 'system' && attempt.actor_id === 'demo-seller-operator')).toBe(true);
    expect(db.query("SELECT count(*) AS n FROM audit_log WHERE entity_type = 'Sale' AND entity_id = ?").get(sale.id)).toEqual({ n: 1 });
    expect(db.query("SELECT count(*) AS n FROM audit_log WHERE entity_type = 'Bid' AND entity_id = ? AND to_status = 'winning'").get(sale.bid_id)).toEqual({ n: 1 });
    expect(db.query("SELECT count(*) AS n FROM audit_log WHERE entity_type = 'Bid' AND entity_id = ? AND to_status = 'accepted'").get(sale.bid_id)).toEqual({ n: 1 });
    db.close();
  });

  test('missing configuration and wrong or missing bearer fail closed without writes', async () => {
    const db = await freshDb();
    const bid = await place(db, 0);
    const before = { sales: count(db, 'sales'), payments: count(db, 'payments'), audit: count(db, 'audit_log') };
    expect((await postAccept(db, LISTING_ID, acceptRequest(bid), null)).status).toBe(503);
    for (const auth of [null, 'wrong']) {
      const response = await postAccept(db, LISTING_ID, acceptRequest(bid, auth), TOKEN);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'seller_required' });
    }
    expect({ sales: count(db, 'sales'), payments: count(db, 'payments'), audit: count(db, 'audit_log') }).toEqual(before);
    expect(status(db, 'listings', LISTING_ID)).toBe('open');
    expect(status(db, 'lots', 'demo-lot-sanma')).toBe('listed');
    db.close();
  });

  test('wrong-listing and non-placed bids cannot reserve stock', async () => {
    const db = await freshDb();
    const other = await place(db, 0, 'demo-listing-katsuo');
    const response = await postAccept(db, LISTING_ID, acceptRequest(other), TOKEN);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'bid_not_eligible' });
    expect(count(db, 'sales')).toBe(0);
    expect(status(db, 'listings', LISTING_ID)).toBe('open');
    db.close();
  });

  test('accept rejects extra actor claims and a disabled buyer before any sale write', async () => {
    const db = await freshDb();
    const bid = await place(db, 0);
    const beforeAudit = count(db, 'audit_log');
    for (const body of [{}, { bid_id: bid, actor_id: 'demo-operator' }, { bid_id: 123 }]) {
      const response = await postAccept(db, LISTING_ID, new Request(`http://localhost/v1/listings/${LISTING_ID}/accept`, {
        method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }), TOKEN);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('invalid_input');
    }
    const buyerId = (db.query('SELECT bidder_user_id FROM bids WHERE id = ?').get(bid) as { bidder_user_id: string }).bidder_user_id;
    db.query("UPDATE users SET status = 'disabled' WHERE id = ?").run(buyerId);
    const blocked = await postAccept(db, LISTING_ID, acceptRequest(bid), TOKEN);
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({ error: 'bid_not_eligible' });
    expect(count(db, 'sales')).toBe(0);
    expect(count(db, 'audit_log')).toBe(beforeAudit);
    expect(status(db, 'listings', LISTING_ID)).toBe('open');
    db.close();
  });

  test('audit write failure rolls all accept transitions back', async () => {
    const db = await freshDb();
    const bid = await place(db, 0);
    const beforeAudit = count(db, 'audit_log');
    db.exec("CREATE TRIGGER fail_sale_audit BEFORE INSERT ON audit_log WHEN NEW.entity_type = 'Sale' BEGIN SELECT RAISE(FAIL, 'audit blocked'); END");
    const response = await postAccept(db, LISTING_ID, acceptRequest(bid), TOKEN);
    expect(response.status).toBe(500);
    expect(count(db, 'sales')).toBe(0);
    expect(count(db, 'payments')).toBe(0);
    expect(count(db, 'audit_log')).toBe(beforeAudit);
    expect(status(db, 'bids', bid)).toBe('placed');
    expect(status(db, 'listings', LISTING_ID)).toBe('open');
    expect(status(db, 'lots', 'demo-lot-sanma')).toBe('listed');
    db.close();
  });

  test('pay records an unverified demo reference once and advances four aggregates atomically', async () => {
    const db = await freshDb();
    const bid = await place(db, 0);
    const accepted = await postAccept(db, LISTING_ID, acceptRequest(bid), TOKEN);
    const sale = (await accepted.json()).sale;
    const response = await postPay(db, sale.id, payRequest(sale.id), TOKEN);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ demo: true, verification: 'unverified', payment: { sale_id: sale.id, tx_hash: TX, status: 'captured' } });
    expect(status(db, 'sales', sale.id)).toBe('paid');
    expect(status(db, 'lots', 'demo-lot-sanma')).toBe('sold');
    expect(status(db, 'listings', LISTING_ID)).toBe('settled');
    const audit = db.query("SELECT entity_type,from_status,to_status,payload_json FROM audit_log WHERE request_id = ? ORDER BY rowid")
      .all(`pay-${sale.id}`) as Array<{ entity_type: string; from_status: string; to_status: string; payload_json: string }>;
    expect(audit.map((event) => [event.entity_type, event.from_status, event.to_status])).toEqual([
      ['Sale', 'agreed', 'paid'], ['Lot', 'reserved', 'sold'], ['Listing', 'accepted', 'settled'], ['Payment', 'quoted', 'captured'],
    ]);
    expect(audit.every((event) => JSON.parse(event.payload_json).demo === true && JSON.parse(event.payload_json).verification === 'unverified')).toBe(true);
    const before = { audit: count(db, 'audit_log'), payment: db.query('SELECT tx_hash FROM payments WHERE sale_id = ?').get(sale.id) };
    const replay = await postPay(db, sale.id, payRequest(sale.id, { tx_hash: `0x${'b2'.repeat(32)}` }), TOKEN);
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: 'sale_already_paid' });
    expect({ audit: count(db, 'audit_log'), payment: db.query('SELECT tx_hash FROM payments WHERE sale_id = ?').get(sale.id) }).toEqual(before);
    db.close();
  });

  test('pay requires a valid 0x64hex reference and server bearer; failures do not mutate', async () => {
    const db = await freshDb();
    const bid = await place(db, 0);
    const sale = (await (await postAccept(db, LISTING_ID, acceptRequest(bid), TOKEN)).json()).sale;
    const before = { audit: count(db, 'audit_log'), payment: db.query('SELECT status,tx_hash FROM payments WHERE sale_id = ?').get(sale.id) };
    for (const body of [{}, { tx_hash: '0x1234' }, { tx_hash: 'a1'.repeat(32) }, { tx_hash: TX, verified: true }]) {
      const response = await postPay(db, sale.id, payRequest(sale.id, body), TOKEN);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('invalid_input');
    }
    expect((await postPay(db, sale.id, payRequest(sale.id), null)).status).toBe(503);
    for (const auth of [null, 'wrong']) {
      const response = await postPay(db, sale.id, payRequest(sale.id, { tx_hash: TX }, auth), TOKEN);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'seller_required' });
    }
    expect({ audit: count(db, 'audit_log'), payment: db.query('SELECT status,tx_hash FROM payments WHERE sale_id = ?').get(sale.id) }).toEqual(before);
    expect(status(db, 'sales', sale.id)).toBe('agreed');
    db.close();
  });

  test('payment audit failure rolls back all state and keeps its quoted reference empty', async () => {
    const db = await freshDb();
    const bid = await place(db, 0);
    const sale = (await (await postAccept(db, LISTING_ID, acceptRequest(bid), TOKEN)).json()).sale;
    const beforeAudit = count(db, 'audit_log');
    db.exec("CREATE TRIGGER fail_payment_audit BEFORE INSERT ON audit_log WHEN NEW.entity_type = 'Payment' AND NEW.to_status = 'captured' BEGIN SELECT RAISE(FAIL, 'audit blocked'); END");
    const response = await postPay(db, sale.id, payRequest(sale.id), TOKEN);
    expect(response.status).toBe(500);
    expect(count(db, 'audit_log')).toBe(beforeAudit);
    expect(db.query('SELECT status,tx_hash FROM payments WHERE sale_id = ?').get(sale.id)).toEqual({ status: 'quoted', tx_hash: null });
    expect(status(db, 'sales', sale.id)).toBe('agreed');
    expect(status(db, 'lots', 'demo-lot-sanma')).toBe('reserved');
    expect(status(db, 'listings', LISTING_ID)).toBe('accepted');
    db.close();
  });
});
