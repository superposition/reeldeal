# Decision question set and stub

`questions.json` uses Laya's `{type, instructions, criteria}` shape. `grade` is an advisory bracket of **recorded weight**, `quality` is a five-level score of **recorded handling evidence**, and `price_ok` asks only whether an operator has enough facts to enter a **demo** price. None identifies fish species, measures intrinsic quality, or values a real catch.

`createStubBackend()` implements the browser-side `DecisionBackend` contract and returns the shared `TypedDecisionInput` wire shape. It first checks positive length and weight, stable scale with a reading within 50 g or 5% of recorded weight, and attributed operator species confirmation. Incomplete or contradictory records return binary `completeness=false` with `policy_required_input`, not a fabricated choice or an abstention/null value.

For a complete record the stub gives a fixed `0.86` routing score labelled `stub_heuristic`. `MODEL_FORCE_LOW=1` (or `createStubBackend({forceLow:true})`) yields `0.70` for a repeatable review demo. These are versioned demo rules, **not calibrated probabilities**. The stub records zero model latency because no model inference runs. The API must validate and recompute the review gate; a browser decision never approves a lot by itself.
