# ADR-001: Run typed decisions in the browser

Status: accepted for the hackathon demo, 26 September 2026.

## Context

The static Pages site cannot run a server model. The public Laya ONNX weights
are large, and a typed answer is only advice about a recorded observation.
The model has not been validated for fish identification.

## Decision

Load hash-pinned Laya weights on demand in a browser worker. Verify assembled
bytes before inference, cache verified assets by digest, and use up to four
WASM threads only after the page becomes cross-origin isolated. Keep a
one-thread path and a separately identified deterministic stub. Submit typed
results to the Bun API, which validates their binding to the observation and
recomputes the review gate. Required missing or contradictory facts force
human review; neither backend invents measurements or species.

## Consequences

No hosted inference service, AI key, or model weights are needed on Railway.
First download is large and may fail; users see progress and can use the
labelled stub. GitHub Pages needs a user-triggered service-worker reload for
cross-origin isolation. Browser-reported model identity and latency are
auditable claims, not remote attestation. Species stays operator-confirmed,
and no fish-specific accuracy claim follows from a typed sample.

See the [decision contract](../decision-pipeline.md) and
[browser runtime evidence](https://github.com/superposition/reeldeal/issues/32).
