# Reel Deel Product Goals

## Mission
Replace manual dockside fish-market workflows with a production system that turns verified landed catch into sellable inventory quickly and accurately.

## Primary users
- Fisheries and dock operators creating lots
- Buyers discovering and purchasing landed inventory
- Operators reviewing uncertain scans and correcting records

## Initial product goals
1. Capture landed fish through a camera/scale workflow.
2. Produce a structured, reviewable fish scan.
3. Convert approved scans into market lots and listings.
4. Support a clear buyer flow from discovery through sale.
5. Preserve a complete audit trail from physical intake to transaction.
6. Keep edge AI, decision services, marketplace logic, and chain integrations replaceable behind stable contracts.

## Production requirements
- Human review for uncertain or conflicting classifications
- Versioned schemas and model metadata
- Idempotent APIs and explicit lifecycle states
- Auditability for every material correction and decision
- Observability across edge, backend, decision, and transaction paths
- Secure organization and role boundaries

## Non-goals for the foundation phase
- Fully autonomous pricing
- Tokenizing individual fish
- Speculative DeFi features
- Removing human review from low-confidence cases
- Coupling the core marketplace to a single blockchain, model vendor, or camera stack

## Success criteria
The first production milestone is complete when a fishery can capture a landed lot, review the system output, publish the lot, receive a buyer commitment, and close the sale with a traceable record of every step.
