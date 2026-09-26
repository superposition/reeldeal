import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BID_TYPES, bidDomain } from '@reeldeal/domain';
import { seedDemoData } from '../../../scripts/seed';
import { postBid } from '../src/routes/bid-service';
import { getLot, postPublish } from '../src/routes/lot-service';
import { postLotReview } from '../src/routes/review';
import { postAccept, postPay } from '../src/routes/sale-service';

// Public fixed keys and token for a disposable test database only.
const buyers = [
  privateKeyToAccount(`0x${'11'.repeat(32)}` as Hex),
  privateKeyToAccount(`0x${'22'.repeat(32)}` as Hex),
];
const token = 'local-test-token-not-a-secret';

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
    expect(detail.audit).toContainEqual(expect.objectContaining({ entity_type: 'Bid', entity_id: bidId,
      actor_kind: 'wallet', actor_id: buyers[0]!.address }));
    expect(detail.audit).toContainEqual(expect.objectContaining({ entity_type: 'Payment', entity_id: paymentId,
      actor_kind: 'system', actor_id: 'demo-seller-operator',
      payload: expect.objectContaining({ action: 'pay', demo: true, verification: 'unverified' }) }));
    expect(detail.audit.some((event) => [unrelatedListing, unrelatedBid, unrelated.saleId, unrelated.paymentId, 'demo-lot-katsuo']
      .includes(event.entity_id))).toBe(false);
  } finally {
    db.close();
  }
});
