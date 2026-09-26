import { createStubBackend } from '../packages/decision/src/stub';
import type { ObservationInput } from '../packages/domain/src';

const api = (process.env.API ?? 'http://127.0.0.1:8787/v1').replace(/\/$/, '');
const stub = createStubBackend();

async function send(path: string, body: unknown, expected: number): Promise<any> {
  const response = await fetch(`${api}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
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
