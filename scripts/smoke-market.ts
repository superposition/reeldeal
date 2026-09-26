import { createStubBackend } from '../packages/decision/src/stub';
import type { ObservationInput } from '../packages/domain/src';
import { BID_TYPES, bidDomain } from '../packages/domain/src';
import { privateKeyToAccount } from 'viem/accounts';

const api = (process.env.API ?? 'http://127.0.0.1:8787/v1').replace(/\/$/, '');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(api).hostname)) {
  throw new Error('This write smoke is local-only. Do not run it against the shared demo API.');
}
const stub = createStubBackend();

async function send(path: string, body: unknown, expected: number, headers: Record<string, string> = {}): Promise<any> {
  const response = await fetch(`${api}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json();
  if (response.status !== expected) {
    throw new Error(`${path}: expected ${expected}, got ${response.status}: ${JSON.stringify(result)}`);
  }
  return result;
}

function facts(weight: number | null): ObservationInput {
  const scanId = crypto.randomUUID();
  return {
    scan_id: scanId, captured_at: new Date().toISOString(),
    image_ref: `demo:synthetic-no-photo:smoke:${scanId}`, source: 'manual',
    length_mm: 400, girth_mm: null, weight_g: weight, ice_temp_c: null,
    species_candidates: [{ label: 'saba', score: 0.92 }],
    species_label: 'saba', species_confirmed_by: 'smoke-operator',
    scale_reading: { stable: weight !== null, grams: weight },
  };
}

async function workflow(weight: number | null) {
  const input = facts(weight);
  const observed = await send('/observations', input, 201);
  const observation = observed.observation;
  if (observation.scan_id !== input.scan_id) throw new Error('observation scan ID changed');
  const decision = await stub.decide(observation, 'grade');
  const decided = await send('/decisions', decision, 201);
  if (decided.typed_decision.observation_id !== observation.id) throw new Error('decision did not pin observation');
  const created = await send('/lots', {
    scan_id: input.scan_id, decision_id: decided.typed_decision.id, price_jpy: 1800,
  }, 201);
  return { input, observation, decision: decided.typed_decision, lot: created.lot };
}

const happy = await workflow(1000);
if (happy.lot.status !== 'approved') throw new Error(`happy Lot not approved: ${JSON.stringify(happy.lot)}`);
const published = await send(`/lots/${encodeURIComponent(happy.lot.id)}/publish`, {}, 201);
if (published.listing.lot_id !== happy.lot.id || published.listing.status !== 'open') {
  throw new Error('listing did not publish the approved Lot');
}
const listingResponse = await fetch(`${api}/listings?org=kessenuma&status=open`, { signal: AbortSignal.timeout(10_000) });
if (!listingResponse.ok) throw new Error(`listing query returned ${listingResponse.status}`);
const listings = await listingResponse.json() as { listings: Array<{ id: string }> };
if (!listings.listings.some((listing) => listing.id === published.listing.id)) throw new Error('published listing not returned by market API');
const detailResponse = await fetch(`${api}/lots/${encodeURIComponent(happy.lot.id)}`, { signal: AbortSignal.timeout(10_000) });
if (!detailResponse.ok) throw new Error(`lot detail returned ${detailResponse.status}`);
const detail = await detailResponse.json() as { lot: { status: string }; audit: Array<{ to_status: string }> };
if (detail.lot.status !== 'listed' || !detail.audit.some((event) => event.to_status === 'listed')) {
  throw new Error('lot detail or publish audit missing');
}

const review = await workflow(null);
if (review.lot.status !== 'pending_review') throw new Error('missing weight did not route to review');
const rejected = await send(`/lots/${encodeURIComponent(review.lot.id)}/publish`, {}, 409);
if (rejected.reason !== 'noul') throw new Error(`publish rejection did not name review reason: ${JSON.stringify(rejected)}`);
console.log(`published listing: ${JSON.stringify(published.listing)}`);
console.log(`missing weight: ${review.lot.status} → publish 409 (${rejected.reason})`);

// Public fixed test keys only; these accounts must never hold real funds.
const buyers = [privateKeyToAccount(`0x${'1'.repeat(64)}`), privateKeyToAccount(`0x${'2'.repeat(64)}`)];
const listingId = published.listing.id as string;
const chainId = Number(process.env.REELDEAL_CHAIN_ID ?? '1');
const signed = await Promise.all(buyers.map(async (buyer, index) => {
  const message = { listing_id: listingId, amount_jpy: BigInt(1900 + index * 100), bidder: buyer.address, nonce: BigInt(index + 1) };
  const signature = await buyer.signTypedData({ domain: bidDomain(chainId), types: BID_TYPES, primaryType: 'Bid', message });
  return { ...message, amount_jpy: Number(message.amount_jpy), nonce: message.nonce.toString(), signature };
}));
const placed = await Promise.all(signed.map((bid) => send(`/listings/${listingId}/bids`, bid, 201)));
const tampered = await send(`/listings/${listingId}/bids`, { ...signed[0], amount_jpy: 9999 }, 401);
if (tampered.error !== 'signature_mismatch') throw new Error('Tampered amount did not fail signature verification');
const replay = await send(`/listings/${listingId}/bids`, signed[0], 409);
if (replay.error !== 'nonce_reused') throw new Error('Reused signature did not hit nonce guard');
console.log('signed offers: two 201; tamper 401 signature_mismatch; replay 409 nonce_reused');

const sellerToken = process.env.REELDEAL_SELLER_TOKEN;
if (!sellerToken) {
  console.log('accept/pay: SKIPPED (no server-only seller token); use bun run smoke:local for the full disposable flow');
} else {
  const headers = { authorization: `Bearer ${sellerToken}` };
  const attempts = await Promise.all(placed.map(async ({ bid }) => {
    const response = await fetch(`${api}/listings/${listingId}/accept`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ bid_id: bid.id }), signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, body: await response.json() as any };
  }));
  if (attempts.map(({ status }) => status).sort().join(',') !== '201,409') throw new Error(`Accept race did not choose one winner: ${JSON.stringify(attempts)}`);
  const winner = attempts.find(({ status }) => status === 201)!.body;
  const conflict = attempts.find(({ status }) => status === 409)!.body;
  if (conflict.winning_bid_id !== winner.sale.bid_id) throw new Error('Conflict did not name the persisted winning bid');
  const auditResponse = await fetch(`${api}/audit?entity=Listing&id=${encodeURIComponent(listingId)}`);
  if (!auditResponse.ok) throw new Error('Acceptance audit unavailable');
  const { events } = await auditResponse.json() as { events: Array<{ payload: { action?: string; outcome?: string } }> };
  const accepts = events.filter(({ payload }) => payload?.action === 'accept');
  if (accepts.length !== 2 || accepts.map(({ payload }) => payload.outcome).sort().join(',') !== 'accepted,conflict') {
    throw new Error('Expected one successful and one conflicting acceptance audit');
  }
  console.log('concurrent acceptance: one 201 + one 409; same winning bid; two acceptance-attempt audits');
  const paid = await send(`/sales/${winner.sale.id}/pay`, { tx_hash: `0x${'a'.repeat(64)}` }, 201, headers);
  if (!paid.demo || paid.verification !== 'unverified' || paid.payment.status !== 'captured') throw new Error('Demo payment boundary or captured state missing');
  await send(`/sales/${winner.sale.id}/pay`, { tx_hash: `0x${'b'.repeat(64)}` }, 409, headers);
  const settled = await (await fetch(`${api}/lots/${happy.lot.id}`)).json() as { lot: { status: string }; listing: { status: string } };
  if (settled.lot.status !== 'sold' || settled.listing.status !== 'settled') throw new Error('Demo settlement did not close the lot and listing');
  console.log('demo settlement: captured / sold / settled; second pay 409; synthetic transaction reference UNVERIFIED, no real payment');
}
