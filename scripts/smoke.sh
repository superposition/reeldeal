#!/usr/bin/env bash
set -euo pipefail

API=${API:-http://127.0.0.1:8787/v1}
health=$(curl --fail-with-body --silent --show-error --max-time 5 "$API/health")

if ! SMOKE_HEALTH="$health" bun -e '
  const h = JSON.parse(process.env.SMOKE_HEALTH ?? "null");
  if (h?.ok !== true || h?.db !== "up" || h?.backends?.decision !== "stub") {
    throw new Error("health contract mismatch");
  }
'; then
  printf 'SMOKE FAIL: invalid health response\n' >&2
  exit 1
fi

printf 'health: %s\nSMOKE OK\n' "$health"
