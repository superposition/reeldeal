import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BID_TYPES, bidDomain } from '@reeldeal/domain';
import { seedDemoData } from '../../../scripts/seed';
import { postBid } from '../src/routes/bid-service';
import { makeAuditRoutes } from '../src/routes/audit';
import { getLot, postPublish } from '../src/routes/lot-service';
import { serializePublicAudit, type AuditRow } from '../src/routes/public-audit';
import { postLotReview } from '../src/routes/review';
import { postAccept, postPay } from '../src/routes/sale-service';

// Public fixed keys and token for a disposable test database only.
const buyers = [
  privateKeyToAccount(`0x${'11'.repeat(32)}` as Hex),
  privateKeyToAccount(`0x${'22'.repeat(32)}` as Hex),
];
const token = 'local-test-token-not-a-secret';

test('public audit serialization removes nested buyer IDs but preserves evidence and settlement references', () => {
  const wallet = buyers[0]!.address;
  const row: AuditRow = {
    id: 'event-1', entity_type: 'Bid', entity_id: 'bid-1', org_id: 'org-1',
    actor_kind: 'wallet', actor_id: wallet, from_status: null, to_status: 'placed',
    request_id: 'request-1', at: 123,
    payload_json: JSON.stringify({
      bidder_user_id: 'private-bidder', buyer_user_id: 'private-buyer',
      details: [{ buyer_user_id: 'private-nested', signer: wallet }],
      source_model: { sha256: 'model-sha' }, settlement: { tx_hash: `0x${'a1'.repeat(32)}` },
    }),
  };
  const visible = serializePublicAudit(row);
  const otherCase = serializePublicAudit({ ...row, actor_id: wallet.toLowerCase() });
  expect(visible.actor_id).toBe(otherCase.actor_id);
  expect(visible.actor_kind).toBe('wallet');
  expect(visible.payload).toEqual({
    details: [{ signer: visible.actor_id }],
    source_model: { sha256: 'model-sha' }, settlement: { tx_hash: `0x${'a1'.repeat(32)}` },
  });
  expect(row.actor_id).toBe(wallet);
  expect(row.payload_json).toContain('private-bidder');
});

async function bid(db: Database, listingId: string, buyerIndex: number): Promise<string> {
  const buyer = buyers[buyerIndex]!;
  const amount_jpy = 2600 + buyerIndex * 100;
  const nonce = String(buyerIndex + 1);
  const signature = await buyer.signTypedData({
    domain: bidDomain(1), types: BID_TYPES, primaryType: 'Bid',
    message: { listing_id: listingId, amount_jpy: BigInt(amount_jpy), bidder: buyer.address, nonce: BigInt(nonce) },
  });
  const response = await postBid(db, listingId, new Request(`http://localhost/v1/listings/${listingId}/bids`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ listing_id: listingId, amount_jpy, bidder: buyer.address, nonce, signature }),
  }), 1);
  expect(response.status).toBe(201);
  return (await response.json()).bid.id as string;
}

async function acceptAndPay(db: Database, listingId: string, bidId: string) {
  const accepted = await postAccept(db, listingId, new Request(`http://localhost/v1/listings/${listingId}/accept`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ bid_id: bidId }),
  }), token);
  expect(accepted.status).toBe(201);
  const { sale } = await accepted.json();
  const paid = await postPay(db, sale.id, new Request(`http://localhost/v1/sales/${sale.id}/pay`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ tx_hash: `0x${'a1'.repeat(32)}` }),
  }), token);
  expect(paid.status).toBe(201);
  const payment = await paid.json();
  expect(payment).toMatchObject({ demo: true, verification: 'unverified' });
  return { saleId: sale.id as string, paymentId: payment.payment.id as string };
}

test('lot detail includes only its ordered, attributed review and marketplace audit trail', async () => {
  const db = new Database(':memory:', { strict: true });
  db.exec(readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  try {
    await seedDemoData(db);
    const lotId = 'demo-lot-saba';
    db.query(`INSERT INTO audit_log
      (id,entity_type,entity_id,org_id,actor_kind,actor_id,from_status,to_status,request_id,payload_json,at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      'device-audit-test', 'FishScan', 'demo-scan-saba', 'demo-kesennuma', 'device', 'browser-scanner',
      'captured', 'observed', 'device-request', JSON.stringify({ source: 'manual' }), 1,
    );
    const review = await postLotReview(db, lotId, new Request(`http://localhost/v1/lots/${lotId}/review`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ field: 'weight_g', human_value: 875,
        reason: 'Operator checked the measured landing record.', actor_id: 'demo-operator', attest: true }),
    }));
    expect(review.status).toBe(200);
    const correctionId = (await review.json()).correction.id as string;
    const published = postPublish(db, lotId);
    expect(published.status).toBe(201);
    const listingId = (await published.json()).listing.id as string;
    const bidId = await bid(db, listingId, 0);
    const { saleId, paymentId } = await acceptAndPay(db, listingId, bidId);
    const conflict = await postAccept(db, listingId, new Request(`http://localhost/v1/listings/${listingId}/accept`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ bid_id: bidId }),
    }), token);
    expect(conflict.status).toBe(409);

    // A separate lot has its own real bid/sale/payment events; none may leak into saba detail.
    const unrelatedListing = 'demo-listing-katsuo';
    const unrelatedBid = await bid(db, unrelatedListing, 1);
    const unrelated = await acceptAndPay(db, unrelatedListing, unrelatedBid);

    const detail = await getLot(db, lotId).json() as { audit: Array<{
      id: string; entity_type: string; entity_id: string; actor_kind: string; actor_id: string;
      at: string; payload: Record<string, unknown> | null;
    }> };
    const linked = new Set([
      lotId, 'demo-scan-saba', 'demo-observation-saba', 'demo-decision-saba', correctionId,
      listingId, bidId, saleId, paymentId,
    ]);
    const stored = db.query('SELECT id,entity_id FROM audit_log ORDER BY at,rowid')
      .all() as Array<{ id: string; entity_id: string }>;
    expect(detail.audit.map((event) => event.id)).toEqual(stored.filter((event) => linked.has(event.entity_id)).map((event) => event.id));
    expect(detail.audit.every((event) => linked.has(event.entity_id))).toBe(true);
    expect(detail.audit.map((event) => event.at)).toEqual([...detail.audit.map((event) => event.at)].sort());
    expect(detail.audit.filter((event) => event.entity_type === 'Listing' && event.payload?.action === 'accept')
      .map((event) => event.payload?.outcome)).toEqual(['accepted', 'conflict']);
    for (const [entity, id] of [['Listing', listingId], ['Bid', bidId], ['Sale', saleId], ['Payment', paymentId]]) {
      expect(detail.audit.some((event) => event.entity_type === entity && event.entity_id === id)).toBe(true);
    }
    expect(detail.audit).toContainEqual(expect.objectContaining({ entity_type: 'Correction', entity_id: correctionId,
      actor_kind: 'user', actor_id: 'demo-operator' }));
    expect(detail.audit).toContainEqual(expect.objectContaining({ entity_type: 'FishScan', entity_id: 'demo-scan-saba',
      actor_kind: 'device', actor_id: 'browser-scanner' }));
    const alias = (address: string) => `wallet:${createHash('sha256').update(address.toLowerCase()).digest('hex').slice(0, 12)}`;
    expect(detail.audit).toContainEqual(expect.objectContaining({ entity_type: 'Bid', entity_id: bidId,
      actor_kind: 'wallet', actor_id: alias(buyers[0]!.address) }));
    expect(detail.audit).toContainEqual(expect.objectContaining({ entity_type: 'Payment', entity_id: paymentId,
      actor_kind: 'system', actor_id: 'demo-seller-operator',
      payload: expect.objectContaining({ action: 'pay', demo: true, verification: 'unverified' }) }));
    expect(detail.audit.some((event) => [unrelatedListing, unrelatedBid, unrelated.saleId, unrelated.paymentId, 'demo-lot-katsuo']
      .includes(event.entity_id))).toBe(false);

    const storedBid = db.query("SELECT actor_id,payload_json FROM audit_log WHERE entity_type = 'Bid' AND entity_id = ?")
      .get(bidId) as { actor_id: string; payload_json: string };
    const buyerUserId = (db.query('SELECT bidder_user_id FROM bids WHERE id = ?').get(bidId) as { bidder_user_id: string }).bidder_user_id;
    expect(storedBid.actor_id).toBe(buyers[0]!.address);
    expect(JSON.parse(storedBid.payload_json).bidder_user_id).toBe(buyerUserId);

    const auditRoute = makeAuditRoutes(db)['/v1/audit'].GET;
    const allPublic = await auditRoute(new Request('http://localhost/v1/audit?limit=200')).json() as { events: Array<{
      entity_type: string; entity_id: string; actor_kind: string; actor_id: string; payload: Record<string, unknown> | null;
    }> };
    const firstWallet = allPublic.events.find((event) => event.entity_type === 'Bid' && event.entity_id === bidId && event.actor_kind === 'wallet')!;
    const secondWallet = allPublic.events.find((event) => event.entity_type === 'Bid' && event.entity_id === unrelatedBid && event.actor_kind === 'wallet')!;
    expect(firstWallet.actor_id).toBe(alias(buyers[0]!.address));
    expect(secondWallet.actor_id).toBe(alias(buyers[1]!.address));
    expect(firstWallet.actor_id).not.toBe(secondWallet.actor_id);
    expect(allPublic.events.find((event) => event.entity_id === correctionId)?.actor_id).toBe('demo-operator');
    expect(allPublic.events.find((event) => event.entity_id === 'demo-scan-saba' && event.actor_kind === 'device')?.actor_id).toBe('browser-scanner');
    expect(allPublic.events.find((event) => event.entity_id === paymentId && event.actor_kind === 'system')?.actor_id).toBe('demo-seller-operator');
    for (const publicResponse of [detail, allPublic]) {
      const text = JSON.stringify(publicResponse).toLowerCase();
      expect(text).not.toContain(buyers[0]!.address.toLowerCase());
      expect(text).not.toContain(buyers[1]!.address.toLowerCase());
      expect(text).not.toContain(buyerUserId.toLowerCase());
      expect(text).not.toContain('buyer_user_id');
      expect(text).not.toContain('bidder_user_id');
    }
  } finally {
    db.close();
  }
});
