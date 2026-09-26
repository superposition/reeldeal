# ReelDeal architecture

This is the target architecture for the ETHGlobal Tokyo demo. It describes
contracts for work that is being built in parallel; it is not a claim that each
component is deployed. No real fish or payments change hands. Laya is a typed
decision model, not a validated fish-species classifier; species remains
operator-confirmed.

## Component ownership and data flow

```text
  ┌───────────────────────────────────────────────────────────────────────┐
  │ Browser: Astro pages + small interactive islands                    │
  │ camera/manual capture ──facts──▶ Laya ONNX worker or local stub      │
  │                              └────typed decision + provenance────┐  │
  │ buyer wallet ──EIP-712 signed bid────────────────────────────────┐ │  │
  └───────────────────────┬───────────────────────────────────────────┼─┼──┘
                          │ HTTPS /v1 JSON                            │ │
                          ▼                                           ▼ ▼
  ┌───────────────────────────────────────────────────────────────────────┐
  │ Bun API: schema validation, decision persistence, review gate,      │
  │ status machines, bid signature/nonce checks, audit, chain adapter  │
  └───────────────────────┬──────────────────────────┬────────────────────┘
                          │                          │ anchor/listing tx
                          ▼                          ▼
                 ┌─────────────────┐        ┌─────────────────────────┐
                 │ SQLite (WAL)    │        │ Ethereum registry/book  │
                 │ business rows   │        │ hashes + settlement     │
                 │ + audit history │        │ events                  │
                 └─────────────────┘        └─────────────────────────┘
```

1. The browser captures a photo and manually entered measurements. Capture
   emits observations: facts with a stable `scan_id`, never a price or verdict.
   It sends them to `POST /v1/observations`; the API validates and persists
   them. Reposting that ID must be idempotent.
2. The browser decision worker asks typed questions of hash-pinned Laya ONNX
   weights. A deterministic stub implements the same output contract when
   selected or when weights/runtime are unavailable. Both emit `choice`,
   `score`, or `noul` plus model metadata and a labelled confidence source.
   The browser submits that typed result to the API. The API validates its
   shape, metadata, and binding to the stored scan, persists the immutable
   result, and applies the shared domain gate. The API cannot attest that an
   untrusted browser actually executed the declared model. Client-computed
   confidence alone never authorizes a listing.
3. A deterministic preflight maps missing or contradictory required facts to
   the proposition `completeness=false` and forces `pending_review`, without
   asking a model to invent fields. `noul` is a typed binary answer to a
   named proposition, not a general abstention marker; high confidence in
   `false` cannot approve a lot. The API gate also requires complete
   measurements, a stable scale reading, operator-confirmed species, and
   sufficient confidence without conflicting candidates. An operator
   correction is a new attributed row; it does not overwrite the observation
   or model result. Only an approved lot may become a listing.
4. The marketplace reads API state. Buyers sign EIP-712 bids in their own
   wallets; the API recovers the signer, checks the domain and single-use
   nonce, then stores the bid. Accepting a bid uses one server-side inventory
   transition so two buyers cannot win the same listing.
5. The chain adapter hashes the observation, decision, and corrections into
   a provenance commitment and records the transaction status. Ethereum
   stores commitments and settlement events. A chain transaction is never the source of catalog,
   image, price, or bid data.

The code owners are `apps/web` for pages and browser capture; `apps/decision`
and `packages/decision` for typed questions, worker, Laya loader, and stub;
`packages/domain` for validation and state/gate rules; `apps/api` for routes,
review, persistence, signature checks, and chain-adapter orchestration;
`contracts` and `packages/chain` for contracts, ABIs, and chain-specific
encoding. The API consumes the domain contract, not UI component types.

## Clear source of truth for each domain

| Domain | Authoritative record | Derived or copied record |
|---|---|---|
| Captured facts | API `fish_scans` and append-only `observations`, keyed by `scan_id` | Browser preview/local retry copy |
| Decision and model identity | API `decisions`, retaining submitted typed value, backend, runtime, version, weights hash, confidence source, and latency | Browser decision card |
| Human judgment | API `corrections` and audited lot status transition | UI's effective display value |
| Lots, listings, bids, sales, and demo payments | API SQLite rows and domain status machines | Browser marketplace pages |
| Provenance work queue | API `provenance_records.anchor_status` and transaction hash | Browser provenance panel |
| Confirmed on-chain commitment and settlement | Ethereum contract state/events | API indexed confirmation and explorer link |

`schema.sql` is the SQLite schema authority. `packages/domain` defines the
accepted JSON shapes and legal state transitions; `docs/contracts.md` records
their public meaning. SQLite is the demo persistence engine; a future store
can replace it behind API routes without changing browser or chain contracts.
Append-only observation, decision, correction, and audit rows preserve what
was known and what changed. Mutable status fields summarize the current
state. Browser local storage is a retry aid, never the approved business
record.

## Browser, API, and chain responsibilities are explicit

The **browser edge** owns camera permission, preview, manual entry, the Laya
worker, model download/cache, wallet signatures, and presentation. Astro
renders useful static listing HTML before hydration; only camera, wallet, and
live panels need interactive islands. Model weights are public artifacts
fetched directly by the browser. The fallback stub is local and
deterministic. No hosted model or paid AI service is involved.

The **API runtime** owns input validation, persistence, organizational and
actor checks, the confidence/review gate, legal status transitions, EIP-712
verification and replay protection, audit writes, and chain submission or
retry. An untrusted browser-supplied decision is recorded as a model claim;
it does not bypass server-side measurement checks or operator review. API
routes are versioned under `/v1` and use shared domain schemas. The API and
SQLite need a persistent, separately hosted runtime; static GitHub Pages
cannot run them.

The **chain** owns narrowly scoped commitments and settlement evidence. It
does not store image bytes, measurements, catalog entries, prices, signatures,
or payment information. The operator-controlled deployer/anchor signer is
configured outside the repository; buyer signing keys stay in buyer wallets.
Only a confirmed transaction justifies displaying a confirmed anchor.

Deployment boundary: `apps/web` builds as static Astro pages at
`https://superposition.github.io/reeldeal/` with `base: '/reeldeal'`.
GitHub Actions publishes `apps/web/dist`. A base-scoped service worker may
add COOP/COEP headers after one reload so browser WASM can use multiple
threads; without isolation, one thread is the defined fallback. The Laya
graph/weight files stay on the public artifact host and are hash-verified
before inference, then cached in the browser. The Bun API lives at a
separately configured HTTPS origin with persistent SQLite storage. Its exact
host is a deployment decision; the frontend uses one configured API base
URL, never a hard-coded localhost URL in production. Ethereum RPC is used
by the chain adapter; an RPC credential, if required, stays outside Git.

## No direct coupling between UI, decision backend, and chain provider

The UI calls versioned API endpoints and renders shared DTOs. It does not
import contract ABIs to determine whether a lot is listed or sold. The
decision worker returns a `TypedDecision` through one `DecisionBackend`
interface; neither Laya nor the stub creates lots, changes prices, or calls
the chain. The API accepts the typed decision shape and applies the domain
gate independently of the backend. `packages/chain` hides RPC/ABI specifics
behind an anchor/listing adapter; routes persist business state and an
explicit transaction status. Buyer wallet interaction is limited to signing
the bid payload; the API verifies it before acceptance.

This permits replacing the UI, model runtime, database, or chain provider
one at a time. A new decision backend must pass the same shape-equivalence
tests and provide its own model/version/confidence-source metadata. A new
RPC provider must preserve the same transaction state transitions and hash
comparison. Neither swap rewrites historical decision or audit rows.

## Camera, model-weight, database, and RPC failure/retry paths are defined

| Failure | User-visible state | Retry and invariant |
|---|---|---|
| Camera permission denied or no camera | Explain why the snap button is disabled; manual measurement fields remain usable | Retry permission or use seeded demo input. Do not claim a photo was captured. Do not submit an empty `image_ref` as a webcam capture. |
| Laya manifest, weights, hash check, or WASM runtime fails | Show the active backend and load error; switch to the deterministic stub | Retry the model load when network/runtime recovers. A partial or hash-mismatched model is never used. The stub has `confidence_source: stub_heuristic`, not a Laya hash. If no backend returns a valid result, retain the observation for review. |
| Browser isolation unavailable | Show one-thread WASM mode | Continue Laya inference on one thread; multi-threading is an optimization, not a correctness prerequisite. |
| API or SQLite unavailable/read-only | Show save failure; no approved lot/listing is displayed from an unsaved client state | Retain the same `scan_id` locally and retry the idempotent observation request. Fail the write; never treat a browser-only result as committed. Database health is exposed through `/v1/health`. |
| RPC timeout, dropped transaction, or unavailable provider | Sale may remain `settled_offchain`; provenance panel says `pending` or `submitted`, never `confirmed` | Keep the payload hash and intent in `provenance_records`. Retry with idempotency/reconciliation: inspect the existing transaction and matching on-chain hash before sending a new one. Record `confirmed` only after chain proof matches. |

External network operations need bounded timeouts and visible error states.
Decision retries must not duplicate decisions; observation retries reuse
`scan_id`; bid retries reuse a single-use nonce and cannot win twice; chain
retries use the stored payload hash. A database failure must not leave a
successful response for a write whose transaction did not commit.

## Architecture supports auditability, model/version traceability, and incremental replacement of components

Every business transition appends an audit entry with entity, ID, actor kind
and ID, prior and new states, timestamp, and a request/correlation ID. A
decision row retains `scan_id`, typed output, model ID, version/variant,
runtime, verified weights SHA-256 when Laya was used, confidence value and
source, latency, and question/prompt hash where available. Stub rows name
the stub and its heuristic confidence explicitly. A correction stores both
the model value and human value with the operator and reason; prior rows
remain readable. The lot links back to the decision and effective
correction, so the demo audit view can explain the route to approval.

The provenance payload is built from the immutable observation, decision,
and correction history using a canonical encoding before hashing. Its hash,
transaction hash, chain ID, contract address, and confirmation state are
stored separately. The API verifies a displayed confirmation against chain
evidence. These records permit later model or adapter replacements without
retroactively attributing an old outcome to a new component. The weights hash
identifies the artifact the browser reports loading; without remote
attestation it is not proof that the browser executed that artifact.

## Scope and acceptance proof

This document defines the target boundaries for [#2](https://github.com/superposition/reeldeal/issues/2).
The implementation tickets supply the proof: RD-07 deploys the static
frontend; RD-08 adds the API/SQLite skeleton; RD-10 and RD-11 implement the
gate and stub; RD-13 adds browser Laya if completed; RD-16 adds capture;
RD-19 checks signed bids; RD-22 anchors and verifies provenance; RD-24
exposes audit evidence. The source of truth for endpoint and entity fields
is the implemented `packages/domain` code and `docs/contracts.md`, rather
than this overview. Each component should be described as shipped only
after its ticket records runtime or test evidence.
