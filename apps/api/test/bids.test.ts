import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BID_TYPES, bidDomain } from '@reeldeal/domain';
import { seedDemoData } from '../../../scripts/seed';
import { getLot } from '../src/routes/lot-service';
import { postBid } from '../src/routes/bid-service';
import { makeBidRoutes } from '../src/routes/bids';

// Public, deterministic test fixture only. Never fund or use this account outside tests.
const buyer = privateKeyToAccount(`0x${'11'.repeat(32)}` as Hex);
const listingId = 'demo-listing-sanma';

async function freshDb(): Promise<Database> {
  const db = new Database(':memory:', { strict: true });
  db.exec(readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  await seedDemoData(db);
  return db;
}

async function signedBody(options: { listingId?: string; amount?: number; nonce?: string; chainId?: number } = {}) {
  const listing_id = options.listingId ?? listingId;
  const amount_jpy = options.amount ?? 2600;
  const nonce = options.nonce ?? '7';
  const signature = await buyer.signTypedData({
    domain: bidDomain(options.chainId ?? 1), types: BID_TYPES, primaryType: 'Bid',
    message: { listing_id, amount_jpy: BigInt(amount_jpy), bidder: buyer.address, nonce: BigInt(nonce) },
  });
  return { listing_id, amount_jpy, bidder: buyer.address, nonce, signature };
}

function request(body: unknown, pathId = listingId): Request {
  return new Request(`http://localhost/v1/listings/${pathId}/bids`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'bid-test-request' },
    body: JSON.stringify(body),
  });
}

function counts(db: Database) {
  const count = (table: string) => (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { users: count('users'), bids: count('bids'), audit: count('audit_log') };
}

describe('signed bid API', () => {
  test('valid wallet signature creates one bid and one wallet-attributed audit atomically', async () => {
    const db = await freshDb();
    const before = counts(db);
    const body = await signedBody();
    const response = await postBid(db, listingId, request(body), 1);
    expect(response.status).toBe(201);
    const { bid } = await response.json();
    expect(bid).toMatchObject({ listing_id: listingId, amount_jpy: 2600, bidder: buyer.address,
      nonce: '7', signature: body.signature, status: 'placed' });
    expect(bid.bidder_user_id).toBeString();
    expect(counts(db)).toEqual({ users: before.users + 1, bids: before.bids + 1, audit: before.audit + 1 });
    expect(db.query('SELECT wallet,role FROM users WHERE id = ?').get(bid.bidder_user_id))
      .toMatchObject({ wallet: buyer.address, role: 'buyer' });
    expect(db.query("SELECT actor_kind,actor_id,from_status,to_status,request_id FROM audit_log WHERE entity_type = 'Bid' AND entity_id = ?").get(bid.id))
      .toMatchObject({ actor_kind: 'wallet', actor_id: buyer.address, from_status: null,
        to_status: 'placed', request_id: 'bid-test-request' });
    expect((db.query('SELECT status FROM listings WHERE id = ?').get(listingId) as { status: string }).status).toBe('open');
    db.close();
  });

  test('tampered amount, bidder, listing, or domain fails before any write', async () => {
    const db = await freshDb();
    const before = counts(db);
    const original = await signedBody();
    for (const changed of [
      { ...original, amount_jpy: 2601 },
      { ...original, bidder: '0x0000000000000000000000000000000000000001' },
      { ...original, listing_id: 'demo-listing-katsuo' },
      await signedBody({ chainId: 11155111 }),
    ]) {
      const response = await postBid(db, changed.listing_id, request(changed, changed.listing_id), 1);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'signature_mismatch' });
      expect(counts(db)).toEqual(before);
    }
    db.close();
  });

  test('same numeric nonce with leading zeros is rejected by the unique index', async () => {
    const db = await freshDb();
    const first = await signedBody({ nonce: '7' });
    expect((await postBid(db, listingId, request(first), 1)).status).toBe(201);
    const afterFirst = counts(db);
    const replay = await signedBody({ nonce: '0007' });
    const response = await postBid(db, listingId, request(replay), 1);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'nonce_reused' });
    expect(counts(db)).toEqual(afterFirst);
    expect((db.query('SELECT nonce FROM bids WHERE listing_id = ?').get(listingId) as { nonce: string }).nonce).toBe('7');
    db.close();
  });

  test('concurrent retry produces exactly one placed bid and audit', async () => {
    const db = await freshDb();
    const before = counts(db);
    const body = await signedBody({ nonce: '10' });
    const results = await Promise.all([
      postBid(db, listingId, request(body), 1),
      postBid(db, listingId, request(body), 1),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(counts(db)).toEqual({ users: before.users + 1, bids: before.bids + 1, audit: before.audit + 1 });
    db.close();
  });

  test('valid signature cannot bid on non-open listing and cannot create a buyer', async () => {
    const db = await freshDb();
    const before = counts(db);
    const settled = await signedBody({ listingId: 'demo-listing-maguro' });
    const response = await postBid(db, 'demo-listing-maguro', request(settled), 1);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'listing_not_open' });
    expect(counts(db)).toEqual(before);
    db.close();
  });

  test('rejects path/body mismatch, unsafe amount, extra identity, and uint256 overflow', async () => {
    const db = await freshDb();
    const before = counts(db);
    const body = await signedBody();
    const invalid = [
      { ...body, listing_id: 'demo-listing-katsuo' },
      { ...body, amount_jpy: Number.MAX_SAFE_INTEGER + 1 },
      { ...body, amount_jpy: 0 },
      { ...body, amount_jpy: 12.5 },
      { ...body, buyer_user_id: 'demo-operator' },
      { ...body, bidder: '0xnot-an-address' },
      { ...body, nonce: (1n << 256n).toString() },
    ];
    for (const candidate of invalid) {
      const response = await postBid(db, listingId, request(candidate), 1);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('invalid_input');
      expect(counts(db)).toEqual(before);
    }
    db.close();
  });

  test('malformed hex and signature from a different wallet are unauthorized, without writes', async () => {
    const db = await freshDb();
    const before = counts(db);
    const body = await signedBody();
    for (const candidate of [
      { ...body, signature: `0x${'zz'.repeat(65)}` },
      { ...body, signature: `0x${'00'.repeat(65)}` },
      { ...body, signature: `0x${'00'.repeat(64)}` },
      { ...body, bidder: '0x0000000000000000000000000000000000000001' },
    ]) {
      const response = await postBid(db, listingId, request(candidate), 1);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'signature_mismatch' });
      expect(counts(db)).toEqual(before);
    }
    db.close();
  });

  test('maximum uint256 nonce survives signing and storage as exact decimal text', async () => {
    const db = await freshDb();
    const nonce = ((1n << 256n) - 1n).toString();
    const response = await postBid(db, listingId, request(await signedBody({ nonce })), 1);
    expect(response.status).toBe(201);
    expect((await response.json()).bid.nonce).toBe(nonce);
    db.close();
  });

  test('the HTTP route binds its listing ID and returns 201, 401, then 409', async () => {
    const db = await freshDb();
    const server = Bun.serve({
      hostname: '127.0.0.1', port: 0, routes: makeBidRoutes(db, 1),
      fetch: () => Response.json({ error: 'not_found' }, { status: 404 }),
    });
    try {
      const url = new URL(`/v1/listings/${listingId}/bids`, server.url);
      const post = (body: unknown) => fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const body = await signedBody();
      const valid = await post(body);
      expect(valid.status).toBe(201);
      expect((await valid.json()).bid.nonce).toBe('7');
      const tampered = await post({ ...body, amount_jpy: 2601 });
      expect(tampered.status).toBe(401);
      expect(await tampered.json()).toEqual({ error: 'signature_mismatch' });
      const replay = await post(body);
      expect(replay.status).toBe(409);
      expect(await replay.json()).toEqual({ error: 'nonce_reused' });
    } finally {
      server.stop(true);
      db.close();
    }
  });

  test('a verified repeat wallet reuses its buyer row; inactive buyer cannot bid', async () => {
    const db = await freshDb();
    const first = await (await postBid(db, listingId, request(await signedBody()), 1)).json();
    const second = await (await postBid(db, listingId, request(await signedBody({ nonce: '8' })), 1)).json();
    expect(second.bid.bidder_user_id).toBe(first.bid.bidder_user_id);
    const before = counts(db);
    db.query("UPDATE users SET status = 'inactive' WHERE id = ?").run(first.bid.bidder_user_id);
    const blocked = await postBid(db, listingId, request(await signedBody({ nonce: '9' })), 1);
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: 'buyer_unavailable' });
    expect(counts(db)).toEqual(before);
    db.close();
  });

  test('audit insert failure rolls back buyer and bid together', async () => {
    const db = await freshDb();
    const before = counts(db);
    db.exec(`CREATE TRIGGER fail_bid_audit BEFORE INSERT ON audit_log
      WHEN NEW.entity_type = 'Bid' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);
    const response = await postBid(db, listingId, request(await signedBody()), 1);
    expect(response.status).toBe(500);
    expect(counts(db)).toEqual(before);
    db.close();
  });

  test('lot detail exposes its listing or null for a review-only lot', async () => {
    const db = await freshDb();
    const listed = await getLot(db, 'demo-lot-sanma').json();
    const review = await getLot(db, 'demo-lot-saba').json();
    expect(listed.listing).toMatchObject({ id: listingId, status: 'open' });
    expect(review.listing).toBeNull();
    db.close();
  });
});
