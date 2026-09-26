# Typed decision pipeline

ReelDeal turns a landing observation into a typed recommendation, then applies a separate review policy before a lot can be approved. The browser may run Laya ONNX or the deterministic stub. The API stores the observation and decision, validates the result, applies the review gate, and owns lot state. Neither backend creates a lot or makes a final species identification.

```text
camera or manual entry → structured observation → browser DecisionBackend
                   → typed decision → POST /v1/decisions → API review gate
                   → approved lot or pending_review → attributed human correction
```

## Inputs and trust boundary

Capture records facts: `scan_id`, `captured_at`, `image_ref`, `source`, `length_mm`, `girth_mm`, `weight_g`, `ice_temp_c`, `species_candidates`, `scale_reading`, and operator-supplied `species_label` / `species_confirmed_by`. A camera image is evidence for an operator; Laya receives a short text state built from the structured fields, not pixels. Species candidates are hints. The operator confirms the species before automatic promotion; a model score is not a species identification.

For automatic approval, require a finite positive length and weight, a stable scale with a non-null reading, and an operator-confirmed species. Missing or contradictory required facts are detected **before inference**. They produce a deterministic `noul` completeness decision with `noul_value: false`, then `pending_review`; neither backend fills missing measurements or invents a species. `noul` means a binary proposition, not “null” or “I do not know.” The proposition here is “Are the required facts complete and consistent?”

The browser can submit a typed result, but it cannot authorize approval. The API validates the observation and result against the shared schemas, recomputes the review gate, and persists both immutable records. Client-supplied latency, backend identity, and weight hash are useful audit claims, not cryptographic proof that a particular browser actually ran the model. The on-chain anchor later protects the recorded claim from silent alteration; it does not attest browser execution.

## Shared result and backends

`DecisionBackend` in `packages/decision` accepts one validated observation and the versioned question set, and returns the `TypedDecision` shape defined in `docs/contracts.md` and `packages/domain`. Both implementations must pass the same shape-equivalence tests. Replacing the backend changes the adapter and model metadata, not capture, `POST /v1/decisions`, the review gate, or lot creation.

| Kind | Value | Meaning |
| --- | --- | --- |
| `choice` | One named option and per-option probabilities | Which proposed market action best fits the recorded facts; the option set comes from the versioned question set. |
| `score` | `score_level` as the displayed rubric bucket, normalized `score` in `[0, 1]`, and the level distribution | A condition/quality rubric, not a measured fish grade. Preserve Laya's continuous expected index as `score = expected_index / (K - 1)`; the first question set uses five levels. |
| `noul` | `noul_value` and `noul_probability = P(true)` | Whether a stated condition holds. A false completeness result forces review even when its confidence is high. |

Exactly the fields relevant to `kind` are populated; the others are null. Every result also carries `decision_id`, `scan_id`, `confidence` in `[0, 1]`, `confidence_source`, a short rationale, `model.id`, `model.version`, `model.runtime`, optional `model.sha256`, `latency_ms`, and `created_at`. Preserve the full probability distribution when the backend supplies one. The question set and serialized state are versioned and hashed for audit; deterministic policy results identify themselves separately from model inference.

| Producer and kind | Raw evidence | Shared `confidence` | `confidence_source` |
| --- | --- | --- | --- |
| Laya `choice` / `score` | Temperature-adjusted option probabilities `p` | `clamp(1 - H(p) / ln(K), 0, 1)`, where `H(p) = -Σ pᵢ ln(pᵢ)` | `laya_entropy` |
| Laya `noul` | `p = P(true)` | `max(p, 1 - p)` | `laya_noul_probability` |
| Stub | Deterministic field and candidate checks | Explicit, versioned heuristic in `[0, 1]`; never described as a learned probability | `stub_heuristic` |
| Required-input policy | Validated missing/contradictory facts | `1` for the known fact that completeness is false; this is **not** confidence in fish quality | `policy_required_input` |

The stub uses the same question IDs, kinds, nullable fields, and value ranges as Laya. Its output is repeatable for the same observation and question-set version; it carries `model.id = reeldeal-stub`, a rule version, and a JS runtime, with no weight hash. The required-input preflight uses `model.id = reeldeal-policy` to keep it distinct from an inferred answer. Laya carries the actual ONNX variant, runtime version, and verified weight digest. Do not compare a stub heuristic with Laya's entropy score as though they were calibrated on the same data. For a forced review demo, the stub may return low confidence, but the audit row must still identify it as the stub.

The reference browser implementation computes entropy confidence for `choice` and `score`, but uses the probability of the reported yes/no answer for `noul`. These are concentration measures. Even if a checkpoint was calibrated on its training tasks, a `0.75` here is **not** a measured 75% fish-market accuracy claim. The threshold below is a conservative demo rule, pending validation on labelled landings.

## Model artifact and execution

The browser worker loads the Apache-2.0 `VishalMysore/layaForWebTrained` q4e8 graph and its external weight parts through ONNX Runtime Web. Keep the expected variant and SHA-256 in a reviewed, versioned lock; do not accept a new digest solely because a mutable remote manifest says so. Check each assembled byte count against the manifest, hash the reassembled weights, compare to the pinned digest, and only then create the session. Record that digest on each Laya decision. Cache by variant and digest. A hash mismatch fails closed to the stub and emits an audit event.

The public artifact is about 291 MB, so loading is asynchronous with visible progress. In a cross-origin-isolated page the WASM worker may use multiple threads; otherwise it uses one. The first-load service-worker reload needed on GitHub Pages is a deployment concern, not a reason to bypass the decision contract. WebGPU is optional only after output-equivalence checks. No model inference runs on the API server and no hosted model or key is required.

## Review gate

The API uses one policy implementation and records its version, inputs, outcome, and reason codes. Suggested constants for `packages/decision/src/thresholds.ts` are `CONFIDENCE_MIN = 0.75`, `SPECIES_MIN = 0.60`, `SPECIES_CONFLICT_DELTA = 0.10`, and `REQUIRE_SCALE_STABLE = true`. The UI may preview the result, but the API is authoritative.

| Condition | Outcome |
| --- | --- |
| Required fact missing, invalid, or contradictory; `noul_value: false` for completeness | `pending_review`, regardless of confidence. |
| No operator-confirmed species; top candidate below `0.60`; or two candidate scores differ by at most `0.10` | `pending_review`, regardless of model confidence. |
| Scale unstable or scale reading conflicts with recorded weight | `pending_review`, regardless of model confidence. |
| Confidence below `0.50` | `pending_review`; display the uncertainty and require explicit operator action. |
| Confidence from `0.50` to below `0.75` | `pending_review`, the ordinary uncertainty band. |
| Confidence at least `0.75`, complete facts, confirmed species, no conflict, valid typed result | Eligible for `approved`; this is a policy decision, not model authority. |

The gate never turns low confidence into automatic rejection. An operator can correct a field with a reason and attribution; the original observation and decision remain unchanged. The effective value is the latest correction, followed by a new gate evaluation. A lot records the originating `decision_id` and model version, plus references to corrections and the policy version. An approved lot can proceed to listing only through the normal domain transition.

## Failure and retry behavior

Save the observation before attempting inference. Give a model load/inference request a finite timeout and at most two retries with backoff. Reuse a stable decision request ID on retries so a late response cannot create duplicate decisions. If Laya is unavailable, the browser selects the stub and records the fallback reason. If the stub also fails, record `decision_unavailable`, retain the observation, and route to `pending_review` without fabricating a decision or auto-approving a lot. API submission failures retain the result locally for an idempotent retry; the API validates before writing and must not apply the gate twice for the same decision ID.

Append-only audit events capture observation creation, backend selection/fallback, validation or hash failure, decision submission, gate outcome, human correction, and resulting status transition. For each decision record the actor/session and organization, timestamps, backend ID, rule/model version, runtime, weight SHA-256 when applicable, question-set version, state/prompt hash, `confidence_source`, raw and normalized values, latency, retry count, fallback reason, gate reason codes, and the linked observation. Do not store private keys or raw camera media in the decision row.

## Scope of the claim

The upstream checkpoint was fine-tuned for **invoice processing, security incidents, customer service, and agent-trace observability**. Fish landings are out of distribution. This demo shows a typed, auditable decision mechanism and a human review gate. It does not establish fish species recognition, fish-quality accuracy, or calibrated probabilities on landings. Species remains operator-confirmed.

Sources: [Laya typed-decisions model card](https://huggingface.co/convaiinnovations/laya-typed-decisions), [browser conversion model card](https://huggingface.co/VishalMysore/layaForWebTrained), [browser reference implementation](https://github.com/vishalmysore/layaForWeb/blob/main/web/laya-core.js).
