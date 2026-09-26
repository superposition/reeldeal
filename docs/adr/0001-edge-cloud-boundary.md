# ADR-0001: Separate edge capture from marketplace state

Status: Accepted

## Context
Reel Deel will ingest physical-world data at fisheries using camera and scale hardware. Connectivity may be unreliable, while marketplace state must remain durable and centrally consistent.

## Decision
The Jetson edge service owns device capture, preprocessing, and production of structured observations. The backend owns canonical marketplace records, workflow state, identity, audit history, and transaction orchestration.

The edge service must not directly mutate marketplace or blockchain state. It submits versioned observations through an authenticated API.

## Consequences
- Edge capture can continue independently of marketplace implementation.
- Device retries and offline buffering can be handled without duplicating sales.
- Hardware and vision models can change without changing core marketplace contracts.
- The backend remains the source of truth for business state.

Related: #2, #3, #4
