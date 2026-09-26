# ReelDeal domain and API contract

Contract version: **v1**. HTTP endpoints live under `/v1`; breaking wire changes require `/v2`. This document defines the domain shared by the Astro client, browser decision worker, Bun API, SQLite store, and chain adapter. The runtime schemas in `packages/domain/src/entities.ts` and the legal transitions in `packages/domain/src/machines.ts` are the executable source of truth when those files land in RD-09. A difference between code and this document is a defect to reconcile, not a reason to silently reinterpret a stored row.

This is a demo market. `amount_jpy` and `price_jpy` are display denominations; `Payment` records a simulated settlement and does not charge a buyer.

## Shared conventions

- IDs are opaque UUID strings. The capture client creates `scan_id` before upload and reuses it for retries; the API creates all other IDs. Never use a species name, wallet address, or database row number as an entity ID.
- JSON timestamps are UTC RFC 3339 strings. SQLite may store UTC epoch milliseconds, but the API converts at its boundary. `created_at` never changes; `updated_at` changes only on mutable state. For an immutable row, `updated_at = created_at` in the wire view. `captured_at` is the device's event time and is distinct from server `created_at`.
- `org_id` is the owning seller organization ID, except for a buyer `User`, whose `org_id` may be null. `seller_org_id` on a listing or sale is copied from its lot. The API derives ownership from the linked scan/lot, never from an untrusted nested request field.
- Every state-changing request records one append-only `audit_log` entry per state transition. It carries `entity_type`, `entity_id`, `org_id`, `actor_kind` (`user`, `device`, `wallet`, or `system`), `actor_id`, `from_status`, `to_status`, `request_id`, `payload_json`, and `at`. For a new immutable fact, `from_status` is null. Failed attempts that matter to the demo (such as a second accept) also get an audit event with an outcome in `payload_json`; they do not change entity status. `audit_log` is the thirteenth SQLite table, outside the twelve domain entities below.
- Status is a domain value, not a UI colour. All money amounts are nonnegative integer JPY display units. Measurements are nullable when unavailable; never turn missing weight into a measured zero. `species_candidates` are model hints; an operator supplies `species_label` and `species_confirmed_by` before a lot can be auto-approved. Both may be null during capture. Client-supplied values are validated with the shared Zod schemas before persistence. The API returns validation issues without writing partial rows.
- Immutable facts are appended, never overwritten. A status-bearing aggregate can change only via its machine and an audit row in the same SQLite transaction. A correction creates a new row with both old and human values; a decision's original output remains intact.

## Twelve entities

The table maps the twelve entities in [issue #3](https://github.com/superposition/reeldeal/issues/3) to their wire identity, owner, status, audit subject, and mutability. Every row exposes `id`, `created_at`, `updated_at`, and the ownership key shown here; implementation may store shared metadata in columns or the validated JSON payload, but must return it consistently.

| Entity / SQLite table | Identity and relationships | Owner | Status and audit subject | Immutable facts / mutable fields |
| --- | --- | --- | --- | --- |
| `FishScan` / `fish_scans` | `id = scan_id`; captured image and source | `org_id`; `device_id` and optional `user_id` attribute capture | `captured → observed → decided → promoted` or `discarded`; `reviewed` is recorded when a human intervenes. Audit subject `FishScan:id`. | `id`, `captured_at`, original `image_ref`, `source` are immutable; only status and `updated_at` change. |
| `Observation` / `observations` | `id`, `scan_id`, measurement payload, nullable `species_label` and `species_confirmed_by`; many versions per scan | Inherits scan `org_id` and capture actor | Fixed `recorded`; audit subject `Observation:id`. | Entire row immutable. A changed retry appends an observation; the latest version is effective until a decision pins one. Species candidates never become a confirmed species by themselves. |
| `TypedDecision` / `decisions` | `id`, `scan_id`, `observation_id`, `question_id`, typed answer, model evidence | Inherits scan `org_id`; `actor_kind=system` with backend ID | Fixed `recorded`; audit subject `TypedDecision:id`. | Entire row immutable, including confidence, model hash, and latency. |
| `Correction` / `corrections` | `id`, `scan_id`, optional `lot_id`, `field`, `model_value`, `human_value`, `reason` | Inherits scan `org_id`; `actor_kind=user`, `actor_id` required | Fixed `applied`; audit subject `Correction:id`. | Entire row immutable. A further correction appends a later row. |
| `Lot` / `lots` | `id`, `scan_id`, `decision_id`, operator-confirmed species/effective weight, asking `price_jpy` | Seller `org_id` and optional operator `user_id` | `draft → pending_review/approved → listed → reserved → sold`; may become `withdrawn` before sale. Audit subject `Lot:id`. | Origin links and creation snapshot are immutable; status and its `updated_at` change. Effective values derive from immutable observation plus corrections, with their provenance retained. |
| `Listing` / `listings` | `id`, `lot_id`, asking `price_jpy` | `seller_org_id` copied from lot | `open → accepted → settled`, or `open → cancelled`. Audit subject `Listing:id`. | Lot link and published price are immutable; status and `updated_at` change. Bids do **not** close an open listing. |
| `Bid` / `bids` | `id`, `listing_id`, `bidder_user_id`, `amount_jpy`, `bidder` address, `nonce`, `signature` | `buyer_user_id` (also `bidder_user_id`); seller owns the listing, not the bid | `placed → winning → accepted`, or `placed → outbid/rejected/withdrawn`. Audit subject `Bid:id`. | Signed statement and signer are immutable; only status and `updated_at` change. Unique `(listing_id, nonce)` blocks replay. |
| `Sale` / `sales` | `id`, `listing_id`, winning `bid_id`, `buyer_user_id`, `amount_jpy` | Seller `org_id`; buyer identified separately | `agreed → paid` in v1; later states are reserved. Audit subject `Sale:id`. | Winning bid and amount immutable; status and `updated_at` change. Only one sale may win a listing. |
| `Payment` / `payments` | `id`, `sale_id`, `amount_jpy`, optional `tx_hash`/reference | Inherits sale `org_id`; buyer is linked through sale | `quoted → captured` in v1. Audit subject `Payment:id`. | Sale link and amount immutable; status, reference, and `updated_at` change. `captured` means demo-recorded, not a real transfer. |
| `ProvenanceRecord` / `provenance_records` | `id`, `lot_id`, `payload_hash`, `chain_id`, `tx_hash` | Inherits lot `org_id`; submitter actor is recorded | `pending → submitted → confirmed` or `failed`; audit subject `ProvenanceRecord:id`. | The hashed payload and prior attempts are immutable. Retry appends a new attempt or an audited status event; no confirmed hash is overwritten. |
| `User` / `users` | `id`, label, optional wallet address, role | Nullable `org_id` for buyer; seller/operator users have one | `active → disabled`; audit subject `User:id`. | Identity and creation time immutable; role, wallet binding, status, and `updated_at` change only with audit. A wallet signature proves a bid, not a general login session. |
| `Organization` / `orgs` | `id`, unique `slug`, display name | Self-owned `org_id = id` | `active → disabled`; audit subject `Organization:id`. | ID and slug immutable; display name, status, and `updated_at` can change with audit. |

The original build sketch lists `Listing.bid_received`; it conflicts with the live RD-19 rule that bids are accepted only while a listing is `open`. For v1, a listing remains `open` through any number of bids. `bid_received` is obsolete draft wording and must not be emitted by the API or implemented as a v1 transition. The seller's successful acceptance changes the listing to `accepted` and the lot to `reserved` atomically.

### Named status transitions

These are the v1 transitions to implement and test in `packages/domain/src/machines.ts`; the actor after each colon is the transition initiator. Fixed-status immutable rows (`Observation`, `TypedDecision`, `Correction`) have no update transition. User and Organization administration is outside the demo endpoints, but any future `active → disabled` operation still requires an audit entry.

```text
FishScan  captured → observed: capture API
          observed → decided: decision API
          decided → promoted: auto-approval gate
          decided → reviewed: human review
          reviewed → promoted | discarded: human reviewer
          decided → discarded: human reviewer
Lot       draft → approved | pending_review: gate
          pending_review → approved | withdrawn: reviewer
          approved → listed | withdrawn: seller
          listed → reserved | withdrawn: seller acceptance or cancellation
          reserved → sold: demo payment recording
Listing   open → accepted | cancelled: seller
          accepted → settled: demo payment recording
Bid       placed → winning | outbid | rejected | withdrawn: seller or bidder
          winning → accepted: sale creation
Sale      agreed → paid: demo payment recording
Payment   quoted → captured: demo payment recording
Provenance pending → submitted → confirmed | failed: chain adapter
```

`reserved → listed` and `accepted → cancelled` require a compensating cancellation workflow; they are not exposed by v1 demo endpoints. Likewise `Sale.payment_pending/delivered/refunded/disputed` and `Payment.authorized/settled/failed` are reserved vocabulary from the larger market sketch, not claims that the demo implements those routes. A second `accept` is always rejected after the first winner; it cannot take a reserved lot back to an open listing.

## Decision and correction shape

The browser worker or deterministic stub produces a `TypedDecision`; `POST /v1/decisions` validates and persists that payload. The API does not run Laya. A decision is linked to the exact `observation_id` it used so a later changed observation cannot silently inherit an old answer.

An Observation payload carries nullable `length_mm` and `girth_mm` in `0..2000`, nullable `weight_g` in `0..200000`, nullable `ice_temp_c` in `-30..30`, `species_candidates` with scores on `[0,1]`, and `scale_reading:{stable:boolean,grams:number|null}`. The source is `webcam`, `upload`, or `manual`; the camera flow uses `webcam`. `species_label` plus `species_confirmed_by` are operator facts, never inferred from the highest candidate. The server rejects out-of-range values, but missing values can be stored and must route to review. The demo operator label records an attribution claim, not production authentication; the buyer bid is separately verified by wallet signature.

```json
{
  "scan_id": "<uuid>",
  "observation_id": "<uuid>",
  "question_id": "grade",
  "kind": "choice",
  "choice": "accept",
  "score": null,
  "score_raw": null,
  "score_level": null,
  "noul_value": null,
  "noul_probability": null,
  "confidence": 0.88,
  "confidence_source": "laya_entropy",
  "model": { "id": "laya", "version": "q4e8", "runtime": "wasm", "sha256": "<64 lowercase hex>" },
  "latency_ms": 128,
  "rationale": "operator-visible short explanation"
}
```

`kind` is one of `choice`, `score`, `noul`. A `choice` sets only `choice`. For a five-level `score`, `score_raw` is Laya's continuous expected ordinal index on `[0,4]`, `score = score_raw / 4` is the normalized value on `[0,1]`, and `score_level` is the nearest integer `0..4` for display; the continuous value must not be rounded before normalization. A `noul` sets `noul_value: boolean` and `noul_probability: number` on `[0,1]` (the model's probability of true, with the boolean at the declared decision threshold). `noul` is a binary typed answer, **not** a null/abstention marker. Missing required facts produce a deterministic `question_id:"completeness"`, `noul_value:false` result and force `pending_review` with reason `noul`. Null in a nonmatching answer field means “not this answer type.” `question_id` identifies the declared question (`grade`, `quality`, or `price_ok`) or the deterministic completeness preflight. The gate selects the relevant grade or completeness result and stores its `decision_id` on the lot.

`confidence` is `[0,1]` but its source is mandatory. `laya_entropy` means `1 − H(p)/log(k)` for choice/score; `laya_noul_probability` means `max(P(true),1−P(true))` for noul; `stub_heuristic` is a documented deterministic rule; `policy_required_input` labels the deterministic missing-fact preflight. The latter two must never be presented as model calibration. `model.id`, `version`, and `runtime` are required. `model.sha256` is required for Laya and must match the verified manifest variant; stub/policy rows use null/absent SHA. `latency_ms` is a nonnegative integer. The response adds server-generated `id`, `org_id`, `created_at`, and `updated_at`. The worker never receives a signing key.

The gate in `packages/domain/src/gate.ts` is a pure function of the pinned observation and decision. It returns `{route:"auto_approve"}` or `{route:"pending_review",reason}` with reason `noul`, `missing_measurements`, `unconfirmed_species`, `low_decision_confidence`, `low_species_confidence`, or `conflicting_species`. RD-10 owns the thresholds and uncertainty band `[0.60,0.80)`; the API stores the gate result alongside the lot and audits it. A positive/stable measured weight and length plus operator-confirmed species are required before auto approval. No missing measurement or species label is invented to pass the gate. A correction uses `{field, model_value, human_value, reason, actor_id}`; the server derives `model_value` from the pinned original and records both values. The effective lot value is the latest correction for that field, visibly marked as human supplied.

## `/v1` HTTP surface

All bodies and responses are JSON. Shared schemas validate at the API boundary. Success responses use the named entity envelope shown below; list responses use plural names. `400 {error:"invalid_input",issues:[...]}` has field paths; `401` means a bad bid signature; `404` means no visible entity; `409 {error,reason?}` means a state or uniqueness conflict. Mutations are transactional and write their audit rows before returning success. The optional `Idempotency-Key` header can protect client retries; scan identity and bid nonce remain the authoritative deduplication keys.

| Method and path | Request → success | Required behavior |
| --- | --- | --- |
| `GET /v1/health` | `200 {ok:true,db:"up",backends:{decision:"stub"}}` | Health reports actual configured backend. |
| `POST /v1/observations` | Observation payload with `scan_id`, `captured_at`, `image_ref`, nullable measurements, candidate scores, scale reading, `source` → `201 {observation,replayed:false}` | Creates one scan and an immutable observation. Exact replay returns `200` with `replayed:true`; changed payload with the same scan appends a version, returns `201` with `replaced:true`, and still has one scan. Scan creation is audited once. |
| `POST /v1/decisions` | Complete browser/stub typed decision payload above → `201 {typed_decision}` | Validate kind-specific fields and backend evidence; link to the pinned observation. A later observation requires a new decision. |
| `POST /v1/scans/:id/corrections` | `{field,human_value,reason,actor_id}` → `201 {correction}` | Server stores original `model_value` separately; decision row is never updated. A pending lot may then be approved through review. |
| `POST /v1/lots` | `{scan_id,decision_id,price_jpy}` → `201 {lot}` | Apply gate server side. Missing observation/decision yields `409 not_decided_yet`; gate result sets `approved` or `pending_review`. |
| `POST /v1/lots/:id/review` | `{field,human_value,reason,actor_id}` → `200 {lot,correction}` | Only `pending_review` can become `approved`; correction and transition share one transaction. This route can implement the correction path above without duplicate rows. |
| `POST /v1/lots/:id/publish` | `{}` → `201 {listing}` | Only approved lot publishes. `pending_review` returns `409` with gate reason. |
| `GET /v1/listings?org=:slug` | `200 {listings:[...]}` | Published listings, including status and effective lot fields; filters are URL addressable. |
| `GET /v1/lots/:id` | `200 {lot,observation,typed_decision,corrections,audit}` | Traceable lot detail; expose original and human values separately. |
| `POST /v1/listings/:id/bids` | `{listing_id,amount_jpy,bidder,nonce,signature}` → `201 {bid}` | Listing must be `open`. Verify EIP-712 signature *before* insert; mismatch `401 signature_mismatch`. Unique `(listing_id,nonce)` violation `409 nonce_reused`. |
| `POST /v1/listings/:id/accept` | `{bid_id}` → `201 {sale}` | Seller selects one valid placed bid in one SQLite transaction. Set listing `accepted`, lot `reserved`, sale `agreed`; concurrent second accept returns `409` naming `winning_bid_id`. |
| `POST /v1/sales/:id/pay` | `{tx_hash?}` → `201 {payment}` | Record demo settlement reference and atomically set sale `paid`, lot `sold`, payment `captured`; no real payment is initiated. |
| `POST /v1/provenance/:lot_id/anchor` | `{}` → `202 {provenance_record}` | Hash canonical observation, decision, and correction bundle. Pending/failed attempts remain visible; network/RPC failure never erases the intended anchor. |
| `GET /v1/provenance/:lot_id` | `200 {records:[{payload_hash,tx_hash,anchor_status,explorer_url,...}]}` | Explorer URL derives from configured chain, not a hard coded provider. |
| `GET /v1/audit?entity=&id=` | `200 {events:[...]}` | Append-only actor, state change, outcome, and timestamp trail. |
| `POST /v1/orgs`, `GET /v1/orgs/:slug` | Minimal organization payload → `201 {organization}` / `200 {organization}` | Organization ID/slug validation; no production account claims. |

The signed bid uses one shared EIP-712 definition: `Bid { listing_id:string, amount_jpy:uint256, bidder:address, nonce:uint256 }`, domain `{name:"ReelDeal",version:"1",chainId}`. The buyer wallet signs in the browser; the API verifies with `verifyTypedData`. The contract concerns the bid statement and its verification, not which wallet UI or chain RPC provider supplies it. The `bids_listing_nonce` unique index is the final replay guard.

## Transition ownership and storage portability

`packages/domain/src/machines.ts` must reject illegal Lot and Listing moves with `can()`/`transition()`. It should also name or validate the FishScan, Bid, Sale, Payment, and Provenance transitions listed above. API routes enforce actor and cross-entity guards (approved scan before publish; open listing before bid; one winning sale) in transactions. The route itself may not bypass a machine with an unchecked status update. RD-09 and later behavior tests must cover each transition they expose, including the invalid `draft → sold`, second acceptance, and pending-review publish cases. At this Wave 1 stage those code tests cannot run; this document states their target contract rather than claiming test coverage already exists.

The wire types and state rules contain no Astro component names, CSS, browser storage paths, chain contract address, RPC host, or SQL dialect. Astro may render them and the browser worker may supply either Laya or stub answers; the API receives the same validated `TypedDecision` shape. The chain adapter anchors a canonical payload hash and returns chain metadata without changing Lot or Decision schemas. SQLite is the current persistence layer (`bun:sqlite`, one `schema.sql`, thirteen tables including audit, no ORM). A PostgreSQL migration would reproduce table constraints, uniqueness, transactions, and append-only audit semantics, convert epoch milliseconds to `timestamptz` at the edge, and replace the storage adapter while keeping `/v1` payloads, IDs, and domain machines unchanged. Preserve order and canonical serialization for provenance hashes during that migration.
