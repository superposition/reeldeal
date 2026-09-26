# ADR-0003: Keep blockchain integration behind the marketplace boundary

Status: Accepted

## Context
Reel Deel may use blockchain for settlement, provenance, escrow, or DeFi. Core fish-market operations must remain reliable even if a chain or provider is degraded.

## Decision
The marketplace domain remains chain-agnostic. Blockchain functionality is implemented through a dedicated adapter using stable internal transaction/provenance contracts.

Canonical operational data remains in the application data layer. Only the minimum required commitments, settlement state, or proofs are written onchain.

## Consequences
- The product is not locked to one chain or protocol.
- Sensitive commercial data can remain private.
- Failed or delayed chain transactions can be retried without corrupting marketplace state.
- DeFi and provenance features can evolve independently of core lot/listing flows.

Related: #2, #3
