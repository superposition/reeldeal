# ADR-0002: Use a typed decision boundary for Jev and future models

Status: Accepted

## Context
Vision output and business decisions are different concerns. Jev may classify structured observations into market-relevant decisions, and Laya may later handle selected local decisions.

## Decision
All decision models sit behind one versioned typed decision contract.

Inputs are structured observations plus explicit decision context. Outputs are typed classifications, confidence/probability data, model/version metadata, and review requirements.

Low-confidence, conflicting, invalid, or out-of-policy results must not silently create or modify market state.

## Consequences
- Jev can be replaced or supplemented without changing upstream capture or downstream marketplace contracts.
- Human review remains a first-class production path.
- Decision quality can be evaluated, calibrated, audited, and rolled back by model version.
- Laya can be added later without redesigning the product flow.

Related: #4
