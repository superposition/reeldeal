import type { Database } from 'bun:sqlite';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  PaymentSchema, SaleSchema, bidMachine, listingMachine, lotMachine, paymentMachine, saleMachine,
} from '@reeldeal/domain';
import { json } from './stub';

const REQUEST_ID = /^[A-Za-z0-9._-]{1,80}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ACTOR_ID = 'demo-seller-operator';
const EVIDENCE = { demo: true, verification: 'unverified' } as const;

type ListingRow = { id: string; lot_id: string; seller_org_id: string; status: string };
type LotRow = { id: string; org_id: string; status: string };
type BidRow = { id: string; listing_id: string; bidder_user_id: string; amount_jpy: number; status: string; buyer_status: string };
type SaleRow = {
  id: string; listing_id: string; bid_id: string; org_id: string; buyer_user_id: string;
  amount_jpy: number; status: string; created_at: number; updated_at: number;
};
type PaymentRow = {
  id: string; sale_id: string; org_id: string; amount_jpy: number; tx_hash: string | null;
  status: string; created_at: number; updated_at: number;
};

function sellerAuthorized(request: Request, token: string | null): Response | null {
  if (!token) return json({ error: 'seller_actions_disabled' }, 503);
  const provided = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!provided) return json({ error: 'seller_required' }, 401);
  const expectedHash = createHash('sha256').update(token).digest();
  const providedHash = createHash('sha256').update(provided).digest();
  return timingSafeEqual(expectedHash, providedHash) ? null : json({ error: 'seller_required' }, 401);
}

function requestId(request: Request): string {
  const supplied = request.headers.get('x-request-id');
  return supplied && REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID();
}

function saleWire(row: SaleRow) {
  return SaleSchema.parse({
    id: row.id, listing_id: row.listing_id, bid_id: row.bid_id, org_id: row.org_id,
    buyer_user_id: row.buyer_user_id, amount_jpy: row.amount_jpy, status: row.status,
    created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString(),
  });
}

function paymentWire(row: PaymentRow) {
  return PaymentSchema.parse({
    id: row.id, sale_id: row.sale_id, org_id: row.org_id, amount_jpy: row.amount_jpy,
    tx_hash: row.tx_hash, status: row.status,
    created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString(),
  });
}

function audit(database: Database, entry: {
  entity: string; id: string; org: string; from: string | null; to: string;
  requestId: string; payload: Record<string, unknown>;
}, at: number): void {
  database.query(`INSERT INTO audit_log
    (id,entity_type,entity_id,org_id,actor_kind,actor_id,from_status,to_status,request_id,payload_json,at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), entry.entity, entry.id, entry.org, 'system', ACTOR_ID,
    entry.from, entry.to, entry.requestId, JSON.stringify(entry.payload), at,
  );
}

function parseObject(raw: unknown, expected: string): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  return Object.keys(body).every((key) => key === expected) ? body : null;
}

/** A seller token authorizes a demo API action; it does not authenticate a human user. */
export async function postAccept(database: Database, listingId: string, request: Request, token: string | null): Promise<Response> {
  const denied = sellerAuthorized(request, token);
  if (denied) return denied;
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return json({ error: 'invalid_input', issues: [{ path: ['body'], message: 'Expected JSON' }] }, 400); }
  const body = parseObject(raw, 'bid_id');
  if (!body || typeof body.bid_id !== 'string' || !body.bid_id || body.bid_id.length > 200) {
    return json({ error: 'invalid_input', issues: [{ path: ['bid_id'], message: 'Expected a bid ID only' }] }, 400);
  }
  const bidId = body.bid_id;
  const rid = requestId(request);

  try {
    const result = database.transaction(() => {
      const listing = database.query('SELECT id,lot_id,seller_org_id,status FROM listings WHERE id = ?')
        .get(listingId) as ListingRow | null;
      if (!listing) return { status: 404, body: { error: 'listing_not_found' } };
      if (listing.status !== 'open') {
        const winner = database.query('SELECT bid_id FROM sales WHERE listing_id = ?').get(listing.id) as { bid_id: string } | null;
        if (!winner) return { status: 409, body: { error: 'listing_not_open' } };
        // Failed acceptance is an attempt event, not a status transition.
        audit(database, { entity: 'Listing', id: listing.id, org: listing.seller_org_id,
          from: listing.status, to: listing.status, requestId: rid,
          payload: { action: 'accept', outcome: 'conflict', attempted_bid_id: bidId, winning_bid_id: winner.bid_id, ...EVIDENCE },
        }, Date.now());
        return { status: 409, body: { error: 'listing_already_accepted', winning_bid_id: winner.bid_id } };
      }
      const lot = database.query('SELECT id,org_id,status FROM lots WHERE id = ?').get(listing.lot_id) as LotRow | null;
      const chosen = database.query(`SELECT b.id,b.listing_id,b.bidder_user_id,b.amount_jpy,b.status,u.status AS buyer_status
        FROM bids b JOIN users u ON u.id = b.bidder_user_id WHERE b.id = ?`).get(bidId) as BidRow | null;
      if (!lot || lot.org_id !== listing.seller_org_id || lot.status !== 'listed') {
        return { status: 409, body: { error: 'lot_not_listed' } };
      }
      if (!chosen || chosen.listing_id !== listing.id || chosen.status !== 'placed' || chosen.buyer_status !== 'active') {
        return { status: 409, body: { error: 'bid_not_eligible' } };
      }
      const losers = database.query("SELECT id,status FROM bids WHERE listing_id = ? AND id <> ? AND status = 'placed'")
        .all(listing.id, chosen.id) as Array<{ id: string; status: string }>;
      const at = Date.now();
      const saleId = crypto.randomUUID();
      const paymentId = crypto.randomUUID();

      const winning = bidMachine.transition('placed', 'winning');
      database.query('UPDATE bids SET status = ?, updated_at = ? WHERE id = ?').run(winning, at, chosen.id);
      audit(database, { entity: 'Bid', id: chosen.id, org: listing.seller_org_id, from: 'placed', to: winning,
        requestId: rid, payload: { action: 'accept', outcome: 'winning', listing_id: listing.id, sale_id: saleId, ...EVIDENCE },
      }, at);
      const acceptedBid = bidMachine.transition(winning, 'accepted');
      database.query('UPDATE bids SET status = ?, updated_at = ? WHERE id = ?').run(acceptedBid, at, chosen.id);
      audit(database, { entity: 'Bid', id: chosen.id, org: listing.seller_org_id, from: winning, to: acceptedBid,
        requestId: rid, payload: { action: 'accept', outcome: 'accepted', listing_id: listing.id, sale_id: saleId, ...EVIDENCE },
      }, at);
      for (const loser of losers) {
        const outbid = bidMachine.transition('placed', 'outbid');
        database.query('UPDATE bids SET status = ?, updated_at = ? WHERE id = ?').run(outbid, at, loser.id);
        audit(database, { entity: 'Bid', id: loser.id, org: listing.seller_org_id, from: 'placed', to: outbid,
          requestId: rid, payload: { action: 'accept', outcome: 'outbid', winning_bid_id: chosen.id, ...EVIDENCE },
        }, at);
      }

      const acceptedListing = listingMachine.transition('open', 'accepted');
      database.query('UPDATE listings SET status = ?, updated_at = ? WHERE id = ?').run(acceptedListing, at, listing.id);
      audit(database, { entity: 'Listing', id: listing.id, org: listing.seller_org_id,
        from: 'open', to: acceptedListing, requestId: rid,
        payload: { action: 'accept', outcome: 'accepted', winning_bid_id: chosen.id, sale_id: saleId, ...EVIDENCE },
      }, at);
      const reservedLot = lotMachine.transition('listed', 'reserved');
      database.query('UPDATE lots SET status = ?, updated_at = ? WHERE id = ?').run(reservedLot, at, lot.id);
      audit(database, { entity: 'Lot', id: lot.id, org: lot.org_id, from: 'listed', to: reservedLot,
        requestId: rid, payload: { action: 'accept', sale_id: saleId, winning_bid_id: chosen.id, ...EVIDENCE },
      }, at);
      database.query(`INSERT INTO sales
        (id,listing_id,bid_id,org_id,buyer_user_id,amount_jpy,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'agreed',?,?)`).run(
        saleId, listing.id, chosen.id, listing.seller_org_id, chosen.bidder_user_id, chosen.amount_jpy, at, at,
      );
      audit(database, { entity: 'Sale', id: saleId, org: listing.seller_org_id, from: null, to: 'agreed',
        requestId: rid, payload: { action: 'accept', listing_id: listing.id, bid_id: chosen.id, ...EVIDENCE },
      }, at);
      database.query(`INSERT INTO payments
        (id,sale_id,org_id,amount_jpy,tx_hash,status,created_at,updated_at)
        VALUES (?,?,?,?,NULL,'quoted',?,?)`).run(
        paymentId, saleId, listing.seller_org_id, chosen.amount_jpy, at, at,
      );
      audit(database, { entity: 'Payment', id: paymentId, org: listing.seller_org_id, from: null, to: 'quoted',
        requestId: rid, payload: { action: 'accept', sale_id: saleId, reference_recorded: false, ...EVIDENCE },
      }, at);
      const sale = database.query('SELECT * FROM sales WHERE id = ?').get(saleId) as SaleRow;
      return { status: 201, body: { sale: saleWire(sale), ...EVIDENCE } };
    }).immediate();
    return json(result.body, result.status);
  } catch {
    return json({ error: 'internal_error' }, 500);
  }
}

export async function postPay(database: Database, saleId: string, request: Request, token: string | null): Promise<Response> {
  const denied = sellerAuthorized(request, token);
  if (denied) return denied;
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return json({ error: 'invalid_input', issues: [{ path: ['body'], message: 'Expected JSON' }] }, 400); }
  const body = parseObject(raw, 'tx_hash');
  if (!body || typeof body.tx_hash !== 'string' || !TX_HASH.test(body.tx_hash)) {
    return json({ error: 'invalid_input', issues: [{ path: ['tx_hash'], message: 'Expected a 0x-prefixed 64-hex reference' }] }, 400);
  }
  const txHash = body.tx_hash;
  const rid = requestId(request);

  try {
    const result = database.transaction(() => {
      const sale = database.query('SELECT * FROM sales WHERE id = ?').get(saleId) as SaleRow | null;
      if (!sale) return { status: 404, body: { error: 'sale_not_found' } };
      if (sale.status === 'paid') return { status: 409, body: { error: 'sale_already_paid' } };
      const listing = database.query('SELECT id,lot_id,seller_org_id,status FROM listings WHERE id = ?')
        .get(sale.listing_id) as ListingRow | null;
      const lot = listing && database.query('SELECT id,org_id,status FROM lots WHERE id = ?').get(listing.lot_id) as LotRow | null;
      const payment = database.query('SELECT * FROM payments WHERE sale_id = ?').get(sale.id) as PaymentRow | null;
      if (sale.status !== 'agreed' || !listing || listing.status !== 'accepted' ||
          !lot || lot.status !== 'reserved' || lot.org_id !== sale.org_id ||
          !payment || payment.status !== 'quoted' || payment.tx_hash !== null ||
          payment.org_id !== sale.org_id || payment.amount_jpy !== sale.amount_jpy) {
        return { status: 409, body: { error: 'sale_not_payable' } };
      }
      const at = Date.now();
      const paid = saleMachine.transition('agreed', 'paid');
      database.query('UPDATE sales SET status = ?, updated_at = ? WHERE id = ?').run(paid, at, sale.id);
      audit(database, { entity: 'Sale', id: sale.id, org: sale.org_id, from: 'agreed', to: paid,
        requestId: rid, payload: { action: 'pay', payment_id: payment.id, reference_recorded: true, ...EVIDENCE },
      }, at);
      const sold = lotMachine.transition('reserved', 'sold');
      database.query('UPDATE lots SET status = ?, updated_at = ? WHERE id = ?').run(sold, at, lot.id);
      audit(database, { entity: 'Lot', id: lot.id, org: lot.org_id, from: 'reserved', to: sold,
        requestId: rid, payload: { action: 'pay', sale_id: sale.id, reference_recorded: true, ...EVIDENCE },
      }, at);
      const settled = listingMachine.transition('accepted', 'settled');
      database.query('UPDATE listings SET status = ?, updated_at = ? WHERE id = ?').run(settled, at, listing.id);
      audit(database, { entity: 'Listing', id: listing.id, org: listing.seller_org_id, from: 'accepted', to: settled,
        requestId: rid, payload: { action: 'pay', sale_id: sale.id, reference_recorded: true, ...EVIDENCE },
      }, at);
      const captured = paymentMachine.transition('quoted', 'captured');
      database.query('UPDATE payments SET status = ?, tx_hash = ?, updated_at = ? WHERE id = ?').run(captured, txHash, at, payment.id);
      audit(database, { entity: 'Payment', id: payment.id, org: payment.org_id, from: 'quoted', to: captured,
        requestId: rid, payload: { action: 'pay', sale_id: sale.id, reference_recorded: true, ...EVIDENCE },
      }, at);
      const stored = database.query('SELECT * FROM payments WHERE id = ?').get(payment.id) as PaymentRow;
      return { status: 201, body: { payment: paymentWire(stored), ...EVIDENCE } };
    }).immediate();
    return json(result.body, result.status);
  } catch {
    return json({ error: 'internal_error' }, 500);
  }
}
