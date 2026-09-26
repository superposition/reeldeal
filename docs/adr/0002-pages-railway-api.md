# ADR-002: Static Pages UI with a separate shared Bun API

Status: accepted for the hackathon demo, 26 September 2026.

## Context

GitHub Pages hosts static files, not Bun routes or a persistent SQLite
database. A shop backed only by browser state cannot demonstrate a saved
observation surviving reloads or another session.

## Decision

Publish the Astro site under `/reeldeal/` on GitHub Pages. Give the browser
one public API origin. Run the versioned `/v1` Bun API on Railway with SQLite
at `/data/reeldeal.sqlite` on a persistent volume, one replica, a health
check, and exact-origin CORS for the Pages origin. Keep Laya inference in the
browser. Keep chain signing credentials, if supplied later, exclusively on
the server; no such secret belongs in Pages build variables or responses.

## Consequences

The UI and API deploy independently; Pages alone does not provide persistence.
The current shared database contains explicitly synthetic demo inventory.
CORS rejects unrelated browser origins but is not authentication: ordinary
demo write routes are reachable by direct HTTP clients, so this is not a
production seller system. A single SQLite volume and replica simplify the
demo but are not a multi-region durability plan. Rollback and health checks
are documented in the [deployment record](../deployment.md).

See the [architecture](../architecture.md) and [public deployment evidence](../deployment.md).
