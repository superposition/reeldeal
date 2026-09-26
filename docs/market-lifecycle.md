# Marketplace lifecycle: one lot, one sale

The [domain/API contract](contracts.md) defines the v1 wire surface; [machines.ts](../packages/domain/src/machines.ts) defines legal state changes. This is a demo market: JPY amounts are display denominations and `Payment.captured` means a recorded demo settlement, not a charge or transfer.

## Actor and state path

| Action and actor | State changes | Required boundary |
| --- | --- | --- |
| Publish, seller | Approved Lot `approved → listed`; new Listing `open` | [Lot route](../apps/api/src/routes/lots.ts) must reject `pending_review` with `409` and its gate reason. The listing copies the Lot seller organization and price. A scan cannot directly create a listing. |
| Discover, buyer | No state change | The [marketplace](../apps/web/src/pages/shop/index.astro) lists published inventory; Lot detail must show effective facts, status, typed decision, corrections, and audit trail. A static Pages shell is not a live stock snapshot; query the API for current records. |
| Bid, buyer wallet | New Bid `placed`; Listing stays `open` | Buyer signs the shared [EIP-712 Bid shape](../packages/domain/src/bid.ts): `listing_id`, `amount_jpy`, `bidder`, `nonce`, under `ReelDeal` v1 and configured `chainId`. API verifies the signature before insert. Bad signature is `401 signature_mismatch`; reused `(listing_id,nonce)` is `409 nonce_reused` by the [unique index](../apps/api/src/db/schema.sql). Bidding on a non-open listing is `409`. A signature authorizes a bid, **not** a sale or general login. |
| Accept, seller | Winning Bid `placed → winning → accepted`; Listing `open → accepted`; Lot `listed → reserved`; new Sale `agreed`; losing placed Bids `outbid` | The seller chooses a valid bid. All changes and audits are one SQLite transaction. The API must verify seller authority and current Listing/Lot/Bid status before the transition. The buyer cannot reserve stock by bidding alone. |
| Confirm demo settlement, seller | Sale `agreed → paid`; Payment `quoted → captured`; Lot `reserved → sold`; Listing `accepted → settled` | `POST /v1/sales/:id/pay` records the optional transaction reference and transitions together. The seller is authoritative for the demo sale confirmation; no wallet signature or API call is evidence of real payment. |
| Cancel while open, seller | Listing `open → cancelled`; Lot `listed → withdrawn`; each still-placed Bid `placed → rejected` | Cancellation must be atomic, include a reason and audit entries, and prevent future bids/accepts. Buyer-initiated withdrawal may move **only that buyer's** `placed → withdrawn` bid while the listing remains open. An accepted/reserved listing cannot be cancelled through v1; it needs a separately designed compensating workflow. |

There is **no automatic expiry** in the v1 schema or API: no `expires_at`, scheduler, or timed transition. An open listing and its placed bids remain open until seller cancellation, buyer bid withdrawal, or seller acceptance. The UI must not show a countdown or imply timed release. `bid_received`, `payment_pending`, refund, and dispute are not v1 states.

## Single-winner inventory rule

`POST /v1/listings/:id/accept` must serialize competing requests around one open Listing and listed Lot. Recheck both states inside the transaction, transition through the machines, insert one Sale, and audit the winner. The [schema](../apps/api/src/db/schema.sql) also has `UNIQUE sales.listing_id` and `UNIQUE listings.lot_id` as final guards. If two buyers' bids are accepted concurrently, exactly one request returns `201 {sale}`. The second returns `409` naming the persisted `winning_bid_id`; it does not create a second Sale or move a reserved Lot backward. Record that failed attempt in `audit_log` with its actor/request ID and outcome, so the history holds **both** accept attempts. A retry after acceptance is a conflict, not a second success.

The append-only [audit log contract](contracts.md#shared-conventions) applies to seller publish/cancel/accept/pay and buyer bid/withdraw actions. It records actor, original and next status, request ID, timestamp, and outcome; mutations and their audit rows commit together. Preserve signed bid bytes, nonce, and accepted Sale links. Do not rewrite earlier bids, sale, or payment history to make a cancellation or correction look as though it never happened.

## Delivery boundary and verification

At this revision, the [bid](../apps/api/src/routes/bids.ts), [sale/payment](../apps/api/src/routes/sales.ts), and Lot/Listing routes are `501` placeholders. The machines and uniqueness constraints exist, but route-level seller checks, cancellation, and single-winner behavior are **not yet proven**. [RD-18](https://github.com/superposition/reeldeal/issues/22) owns publish/detail, [RD-19](https://github.com/superposition/reeldeal/issues/23) owns signed bids, [RD-20](https://github.com/superposition/reeldeal/issues/24) owns accept/pay, and [RD-28](https://github.com/superposition/reeldeal/issues/34) owns final smoke evidence. Cancellation/withdrawal have no v1 route ticket yet; they remain a documented policy, not a shipped feature.

The acceptance oracle is two concurrent accepts in [smoke.sh](../scripts/smoke.sh): one `201`, one `409` with `winning_bid_id`, one Sale, one reserved Lot, and audit events for both attempts. The script currently checks health only, so this epic cannot close from the present smoke output. Test cancellation/withdrawal separately before advertising those controls in the UI.
