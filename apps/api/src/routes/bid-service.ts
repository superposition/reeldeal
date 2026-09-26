import type { Database } from 'bun:sqlite';
import { BID_TYPES, BidSchema, bidDomain } from '@reeldeal/domain';
import { getAddress, isAddress, verifyTypedData, type Address, type Hex } from 'viem';
import { json } from './stub';

const MAX_UINT256 = (1n << 256n) - 1n;
const REQUEST_ID = /^[A-Za-z0-9._-]{1,80}$/;

type BidInput = {
  listing_id: string;
  amount_jpy: number;
  bidder: Address;
  nonce: string;
  signature: Hex;
};

type ListingRow = { id: string; seller_org_id: string; status: string };
type BuyerRow = { id: string; status: string };
type BidRow = {
  id: string; listing_id: string; bidder_user_id: string; amount_jpy: number;
  bidder: string; nonce: string; signature: string; status: string;
  created_at: number; updated_at: number;
};

function parseInput(raw: unknown, pathId: string): { value: BidInput } | { issues: { path: string[]; message: string }[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { issues: [{ path: ['body'], message: 'Expected a JSON object' }] };
  }
  const body = raw as Record<string, unknown>;
  const issues: { path: string[]; message: string }[] = [];
  for (const key of Object.keys(body)) {
    if (!['listing_id', 'amount_jpy', 'bidder', 'nonce', 'signature'].includes(key)) {
      issues.push({ path: [key], message: 'Unknown field' });
    }
  }
  if (typeof body.listing_id !== 'string' || !body.listing_id || body.listing_id.length > 200) {
    issues.push({ path: ['listing_id'], message: 'Expected a listing ID' });
  } else if (body.listing_id !== pathId) {
    issues.push({ path: ['listing_id'], message: 'Must match the listing in the URL' });
  }
  if (typeof body.amount_jpy !== 'number' || !Number.isSafeInteger(body.amount_jpy) || body.amount_jpy <= 0) {
    issues.push({ path: ['amount_jpy'], message: 'Expected a positive whole JPY amount' });
  }
  if (typeof body.bidder !== 'string' || !isAddress(body.bidder)) {
    issues.push({ path: ['bidder'], message: 'Expected a wallet address' });
  }
  let nonce: bigint | undefined;
  if (typeof body.nonce === 'string' && /^[0-9]{1,78}$/.test(body.nonce)) {
    nonce = BigInt(body.nonce);
  }
  if (nonce === undefined || nonce > MAX_UINT256) {
    issues.push({ path: ['nonce'], message: 'Expected a decimal uint256 string' });
  }
  if (typeof body.signature !== 'string' || body.signature.length > 256) {
    issues.push({ path: ['signature'], message: 'Expected a hex signature' });
  }
  if (issues.length > 0) return { issues };
  return { value: {
    listing_id: body.listing_id as string,
    amount_jpy: body.amount_jpy as number,
    bidder: getAddress(body.bidder as string),
    nonce: nonce!.toString(),
    signature: body.signature as Hex,
  } };
}

function bidWire(row: BidRow) {
  return BidSchema.parse({
    id: row.id, listing_id: row.listing_id, bidder_user_id: row.bidder_user_id,
    amount_jpy: row.amount_jpy, bidder: row.bidder, nonce: row.nonce,
    signature: row.signature, status: row.status,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  });
}

function isNonceConflict(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed: bids\.listing_id, bids\.nonce/.test(error.message);
}

/** Signature verification always completes before the transaction can write a buyer, bid or audit. */
export async function postBid(database: Database, listingId: string, request: Request, chainId: number): Promise<Response> {
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return json({ error: 'invalid_input', issues: [{ path: ['body'], message: 'Expected JSON' }] }, 400); }
  const parsed = parseInput(raw, listingId);
  if ('issues' in parsed) return json({ error: 'invalid_input', issues: parsed.issues }, 400);
  const input = parsed.value;
  // The shared Bid row requires the 65-byte signature emitted by the wallet flow.
  if (!/^0x[0-9a-fA-F]{130}$/.test(input.signature)) return json({ error: 'signature_mismatch' }, 401);

  let valid = false;
  try {
    valid = await verifyTypedData({
      address: input.bidder,
      domain: bidDomain(chainId),
      types: BID_TYPES,
      primaryType: 'Bid',
      message: {
        listing_id: input.listing_id,
        amount_jpy: BigInt(input.amount_jpy),
        bidder: input.bidder,
        nonce: BigInt(input.nonce),
      },
      signature: input.signature,
    });
  } catch {
    valid = false;
  }
  if (!valid) return json({ error: 'signature_mismatch' }, 401);

  try {
    const result = database.transaction(() => {
      const listing = database.query('SELECT id,seller_org_id,status FROM listings WHERE id = ?')
        .get(listingId) as ListingRow | null;
      if (!listing) return { status: 404, body: { error: 'listing_not_found' } };
      if (listing.status !== 'open') return { status: 409, body: { error: 'listing_not_open' } };

      const buyer = database.query(`SELECT id,status FROM users
        WHERE lower(wallet) = lower(?) AND role = 'buyer' ORDER BY created_at,id LIMIT 1`)
        .get(input.bidder) as BuyerRow | null;
      if (buyer?.status && buyer.status !== 'active') {
        return { status: 403, body: { error: 'buyer_unavailable' } };
      }
      const at = Date.now();
      const buyerId = buyer?.id ?? crypto.randomUUID();
      if (!buyer) {
        database.query(`INSERT INTO users (id,org_id,label,wallet,role,status,created_at,updated_at)
          VALUES (?,NULL,?,?,'buyer','active',?,?)`).run(
          buyerId, `Buyer ${input.bidder.slice(0, 6)}…${input.bidder.slice(-4)}`, input.bidder, at, at,
        );
      }

      const bidId = crypto.randomUUID();
      database.query(`INSERT INTO bids
        (id,listing_id,bidder_user_id,amount_jpy,bidder,nonce,signature,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'placed',?,?)`).run(
        bidId, listing.id, buyerId, input.amount_jpy, input.bidder, input.nonce, input.signature, at, at,
      );
      const suppliedId = request.headers.get('x-request-id');
      const requestId = suppliedId && REQUEST_ID.test(suppliedId) ? suppliedId : bidId;
      database.query(`INSERT INTO audit_log
        (id,entity_type,entity_id,org_id,actor_kind,actor_id,from_status,to_status,request_id,payload_json,at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        crypto.randomUUID(), 'Bid', bidId, listing.seller_org_id, 'wallet', input.bidder,
        null, 'placed', requestId,
        JSON.stringify({ listing_id: listing.id, bidder_user_id: buyerId, amount_jpy: input.amount_jpy, nonce: input.nonce }), at,
      );
      const bid = database.query('SELECT * FROM bids WHERE id = ?').get(bidId) as BidRow;
      return { status: 201, body: { bid: bidWire(bid) } };
    })();
    return json(result.body, result.status);
  } catch (error) {
    if (isNonceConflict(error)) return json({ error: 'nonce_reused' }, 409);
    return json({ error: 'internal_error' }, 500);
  }
}
