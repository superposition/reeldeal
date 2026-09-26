# Demo security and observability boundary

ReelDeal is a demo, not a production-ready fishery or payment system. The static browser is untrusted: it can capture facts, run Laya or the local stub, and request actions, but cannot approve a Lot, verify its own bid signature, or confirm its own chain anchor. The Bun API must validate with the [shared contract](contracts.md), apply the [gate](../packages/domain/src/gate.ts) and state machines, verify signed bids, and commit state plus audit atomically. A reported Laya hash identifies the artifact the browser claims to have loaded; it is **not** remote attestation or fish-quality validation.

## Organization, role, and actor boundary

| Principal | Allowed demo action and attribution | Boundary still missing |
| --- | --- | --- |
| Seller organization/operator | Owns scans, Lots and Listings; a named operator supplies species, reviews corrections, accepts a bid, and confirms demo settlement. `actor_kind:user`, `actor_id` and `org_id` must come from the authenticated server context when that exists. | The current scanner accepts an operator label and [observation route](../apps/api/src/routes/observations.ts) uses a fixed demo org and `device:browser-scanner`. These are attribution claims, **not** account authentication or reliable device identity. Cross-org authorization and role sessions are not implemented. |
| Capture device | Takes a real photo and submits one stable `scan_id`; audit uses `actor_kind:device` and a device ID distinct from a human reviewer. | A browser label is not a hardware credential. Do not treat it as proof of who held the camera. |
| Buyer wallet | Signs one EIP-712 bid with amount, listing, address and nonce; bid route must recover and verify the signer before insert. Audit uses `actor_kind:wallet` plus the buyer/bid link. | The signature proves that bid statement, not a login session, inventory reservation, or payment. Buyer identity access controls need production design. |
| API/system | Recomputes gate, performs legal transitions, verifies chain receipts, records retries and failures; audit uses `actor_kind:system` with a service ID. | The [anchor mutation](../apps/api/src/routes/provenance.ts) uses a server-side operator token and fails closed when absent. Do not place that token, RPC credentials, or private keys in Git or browser bundles. |

The append-only [audit table](../apps/api/src/db/schema.sql) is the durable record: `id`, `entity_type`, `entity_id`, `org_id`, `actor_kind`, `actor_id`, `from_status`, `to_status`, `request_id`, `payload_json`, and `at`. [RD-24](https://github.com/superposition/reeldeal/issues/28) exposes this as `GET /v1/audit?entity=&id=` returning `{events:[{id,entity_type,entity_id,org_id,actor_kind,actor_id,from_status,to_status,request_id,at,at_iso,payload}]}`, newest first; `payload` is the stored JSON, not a guessed actor. Every material business mutation needs an event in the same transaction, and meaningful failed attempts (for example second bid acceptance) need an outcome event. An immutable TypedDecision links to its Observation and carries model ID, version, runtime, optional verified-weight SHA-256, confidence, `confidence_source`, latency, and typed answer. Its audit payload should carry those same non-secret identifiers so the decision can be traced from `request_id` to the stored row. A human Correction adds original model value, human value, reason, and human actor without editing the original Observation or Decision.

## Telemetry contract and current status

| Signal | Concrete name / fields | What it can honestly say |
| --- | --- | --- |
| Request log | JSON line `event:http_request` with `at`, `request_id`, method, route **template**, status, `duration_ms`, outcome; echo `x-request-id`. | Correlates one HTTP request, not a distributed trace. Never log query strings, request bodies, authorization headers, raw images, or bid signatures. RD-24 owns the utility; route-wide wrapping in [index.ts](../apps/api/src/index.ts) is still an integration gap. |
| Audit query | `GET /v1/audit?entity=&id=`; fields above, actor kind taken from stored row. | Shows durable transitions and attribution claims. The route is currently a `501` placeholder on this branch until RD-24 lands. It cannot itself prove a browser ran a specific model. |
| Durable counters | `GET /v1/metrics`: `scans`, `decisions_per_backend` keyed by `model_id`, `review_rate:{reviewed_lots,total_lots,ratio|null}`, `anchors:{pending,confirmed}`. | Read from persisted server facts. `ratio:null` when there are no Lots; no fabricated denominator. These are demo counters, not production SLOs. The route is currently `501` until RD-24 lands. |
| Browser-only counters | `model_inferences:null`, `weight_cache_hits:null`, with reason codes in `unavailable`. | No server measurement exists until browser events are explicitly reported, attributable and stored. Never present zero as observed activity. |
| Correlation / tracing | `request_id` in request log and audit row; linked scan, Observation, Decision, Lot, Bid and Sale IDs. | Enables manual end-to-end reconstruction. No exporter, span hierarchy, sampling policy, or external alert service is deployed. |

The current [observation route](../apps/api/src/routes/observations.ts) audits scan creation once and each new immutable Observation; exact replay adds neither row. [Provenance](../apps/api/src/routes/provenance.ts) records chain outcomes. Decision, review, bid and sale routes are not yet material-action coverage; do not infer their audit completeness from the table schema or a green health check. Retry identity is `scan_id` for observations, pinned observation/decision IDs for decisions, `(listing_id,nonce)` for bids, and stored payload hash for chain anchoring. Failures must retain a recoverable original fact and may not return success for an uncommitted write.

## Failure classes and accountable owner

These are escalation owners for the demo, **not** configured automatic alerts or an on-call rotation. RD-24 and the deployment owner must connect real notifications before production use.

| Failure class / detection | First owner | Required response |
| --- | --- | --- |
| API/SQLite unavailable, failed write, or missing audit event; health failure or request `5xx` | API operator | Stop claiming durability, inspect transaction and restore storage; replay only with stable IDs. |
| Laya manifest/hash/runtime failure, stub fallback, inference timeout, or browser cache failure; visible worker error | Decision operator | Fail closed to identified stub or review, retain Observation, record backend/fallback reason; never present heuristic confidence as calibrated fish accuracy. |
| Pending anchor, RPC timeout, or receipt/hash mismatch; pending/failed record | Chain operator | Preserve payload hash and attempt history, verify receipt before `confirmed`, retry without broadcasting a different payload. |
| Signature mismatch, nonce-replay spike, or contested second accept; `401`/`409` and audit outcomes | Marketplace/security operator | Reject mutation, keep one winner, inspect actor/nonce and audit trail. Do not treat a wallet signature as settlement. |
| Static Pages/API origin unreachable or cross-origin browser failure; page cannot save/retrieve | Deploy operator | Show degraded state, check public API origin and CORS, restore service; never display a build-time listing as live stock. |

## Sensitive data and retention

Treat landing photos, measurements, prices, bid signatures, buyer wallet/user links, and sale records as sensitive demo data. The current scanner sends a JPEG data URL in `image_ref` and the API stores it in SQLite; there is no application-layer encryption, automatic expiry, deletion workflow, or fine-grained public access control yet. Use consenting demo data only, restrict database and backup access to operators, keep secrets out of logs and the repository, avoid publishing raw media or buyer identities in public audit/metric responses, and arrange a manual post-demo purge with the data owner. A production deployment needs explicit consent, retention/deletion periods, access control, encryption and incident response before real fisheries data is accepted.

## Acceptance still to prove

After RD-24 is merged, exercise `GET /v1/audit` against a saved scan and verify every returned event has actor kind/ID, organization, request ID, transition, timestamp and payload. For a TypedDecision, inspect its linked row and audit payload for model ID/version, SHA when Laya, latency, confidence and source. Then run the main smoke paths and show counters changing with durable facts; check missing browser counters remain explicitly unavailable. The current [smoke script](../scripts/smoke.sh) tests health only, so this document is a security/telemetry specification, not evidence of full material-action coverage or production readiness.
