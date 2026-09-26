# Decision question set and stub

`questions.json` uses Laya's `{type, instructions, criteria}` shape. `grade` is an advisory bracket of **recorded weight**, `quality` is a five-level score of **recorded handling evidence**, and `price_ok` asks only whether an operator has enough facts to enter a **demo** price. None identifies fish species, measures intrinsic quality, or values a real catch.

`createStubBackend()` implements the browser-side `DecisionBackend` contract and returns the shared `TypedDecisionInput` wire shape. It first checks positive length and weight, stable scale with a reading within 20 g or 5% of recorded weight, and attributed operator species confirmation. Incomplete or contradictory records return binary `completeness=false` with `policy_required_input`, not a fabricated choice or an abstention/null value.

For a complete record the shared domain heuristic gives `0.55 + 0.30 × top candidate score + 0.05` for a stable scale, labelled `stub_heuristic`. `MODEL_FORCE_LOW=1` (or `createStubBackend({forceLow:true})`) yields `0.70` for a repeatable review demo. These are versioned demo rules, **not calibrated probabilities**. The stub records zero model latency because no model inference runs. The API must validate and recompute the review gate; a browser decision never approves a lot by itself.
