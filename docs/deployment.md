# Demo deployment record

Verified 26 September 2026 against Pages build `675e03d` and the separate
`reeldeal-hackathon` Railway project. This records a demo deployment, not a
production security or chain-attestation claim.

## Boundary and public endpoints

| Component | Runtime and public entry | What it owns |
| --- | --- | --- |
| Astro UI | [GitHub Pages](https://superposition.github.io/reeldeal/) via [Pages workflow](https://github.com/superposition/reeldeal/actions/runs/36215974794) | Static HTML/assets, browser camera and Laya worker. Its only app-specific build setting is the public `PUBLIC_API_ORIGIN` (also mapped to `PUBLIC_API_BASE_URL`). |
| Bun API | [Railway `api`](https://api-production-04b0.up.railway.app/v1/health), project `105fe9e3-033c-4ecc-a9f4-37120fd62326`, service `ac36588a-5ebd-4c0d-8c71-7444aa570bbd`, production environment `ee8f43d3-e0eb-4c3a-b474-a52318305ac7` | `/v1` validation, typed-decision persistence, review gate, market state, audit, and SQLite. No model weights or inference run here. |
| SQLite | Railway volume mounted at `/data`; `DB_PATH=/data/reeldeal.sqlite` | Shared demo business and audit records. One `us-west2` replica uses this volume. |

The API source is `superposition/reeldeal` branch `main`; Railpack installs
the root Bun workspace and starts `bun run --cwd apps/api start`. Railway
health-checks `/v1/health`. The non-secret service variables are `DB_PATH`,
`PUBLIC_WEB_ORIGIN=https://superposition.github.io`, and
`NODE_ENV=production`. Do not place an RPC URL, signer, private key, or
operator token in Git, Pages variables, logs, or a ticket. No chain signer
or public contract address is claimed here.

## Read-only proof and remaining tests

The [RD-29 read-only evidence](https://github.com/superposition/reeldeal/issues/35#issuecomment-5842946688)
records the deployment and public responses without changing shared data.

- Railway deployment `2127ee8c-a125-4cfa-be29-9b48349a29c3` for `675e03d`
  reached terminal `SUCCESS`. Its public domain is
  `api-production-04b0.up.railway.app`. `GET /v1/health` returned
  HTTP 200 with `{ "ok": true, "db": "up", "backends": { "decision": "stub" } }`.
- `GET /v1/listings` returned four listings, all `demo:true`, with
  `open_count:2`. `GET /v1/lots/demo-lot-sanma` returned HTTP 200 and a
  `listed` demo lot. The six seeded fixtures are synthetic, not user data or
  evidence of a real sale.
- A request with `Origin: https://superposition.github.io` returned
  `access-control-allow-origin` for that exact origin. A request with
  `Origin: https://example.com` returned HTTP 403. A request without an
  `Origin` header succeeds: CORS is not a write-authentication scheme.
- The fixtures were inserted before the `54dcd33` → `3079809` → `675e03d`
  redeploys and were still returned afterward. This is read-back evidence for the demo
  volume across redeploys; it does not prove the camera-to-market path across
  two browser sessions. Do not run the local write-heavy smoke script against
  this shared API.

The Pages workflow for `675e03d` finished successfully, and the deployed
shop markup includes the Railway API origin. A full browser scan → reload →
read across two sessions, camera proof, authenticated seller write boundary,
and real chain anchor remain **pending**. The provenance panel must not show
`confirmed` without a verified receipt. Ordinary demo write routes are
publicly reachable by direct HTTP clients; the operator anchor mutation
has a server-side token gate. The app must not be presented as production
safe or as a seller-authenticated marketplace.

## Recovery

In the Railway dashboard, open this project's `api` service → Deployments.
For a bad release, choose the last known-good deployment's menu → Rollback,
then verify terminal success, `/v1/health`, and a read-only listing response.
Railway's [rollback guide](https://docs.railway.com/guides/roll-back-bad-deploy)
notes that rollback restores the prior image and variables; it does not
replace a backup of the SQLite volume. The CLI has no arbitrary-deployment
rollback command. To rebuild the latest deployment instead, use
`railway redeploy --project <project-id> --environment production --service api --yes`,
then poll `railway deployment list` until `SUCCESS` and recheck public HTTP.
Do not seed or run `make smoke` on production as a health test.
