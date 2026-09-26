# reeldeal

**The fish market, from dockside camera to settlement.**

reeldeal is a production marketplace for fisheries. A dockside camera and scale turn landed catch into structured, reviewable market lots; buyers discover and purchase those lots through a live digital market.

Built as a new codebase for ETHGlobal Tokyo 2026. The Reel Deel concept existed before the event; this repository contains the from-scratch implementation.

## The problem

Many fisheries still move landed inventory through manual workflows: chalkboards, calls, messages, spreadsheets, and disconnected buyer relationships.

That creates three problems:

1. landed inventory is slow to reach buyers;
2. fish data is repeatedly entered and difficult to verify;
3. the physical catch, market listing, sale, and settlement are not connected by one auditable system.

## What reeldeal does

```text
Fish lands
  -> Camera + scale
  -> Jetson edge capture
  -> Structured FishScan
  -> Jev typed decision layer
  -> Human review when required
  -> Lot + live marketplace listing
  -> Buyer bid / purchase
  -> Settlement + provenance
```

The goal is simple: **scan the catch once and let that verified record drive the market.**

## Why this is technically different

reeldeal separates physical-world perception, AI decisions, marketplace state, and blockchain settlement into explicit production boundaries.

- **Jetson edge service** captures camera/scale observations close to the dock.
- **Jev decision layer** converts structured observations into typed market classifications and explicit review requirements.
- **Marketplace backend** owns canonical lots, listings, bids, sales, users, organizations, and audit state.
- **Chain adapter** handles settlement/provenance without making the core marketplace depend on a specific chain or protocol.

Low-confidence or conflicting model output never silently creates market state. Human review is a first-class path.

## Architecture

```text
Dock / Fishery
Camera + Scale -> Jetson -> structured observations
                         |
                         v
                 Decision Service
                 Jev / future Laya
                         |
                         v
                 Reel Deel Marketplace
                 lots / listings / sales
                    |             |
                    |             +--> Buyer experience
                    |
                    +--> Chain adapter
                         settlement / provenance
```

Architecture decisions:
- [ADR-0001: Edge/cloud boundary](docs/adr/0001-edge-cloud-boundary.md)
- [ADR-0002: Typed Jev decision boundary](docs/adr/0002-typed-decision-boundary.md)
- [ADR-0003: Chain integration boundary](docs/adr/0003-chain-integration-boundary.md)

## What belongs onchain

reeldeal does **not** put the full fishery database onchain.

The blockchain boundary is limited to things that benefit from shared verification or programmable settlement:

- settlement / escrow state;
- provenance commitments;
- proofs or hashes linking a physical lot to a sale;
- future DeFi primitives where they solve a real fisheries workflow.

Sensitive fishing locations, buyer relationships, internal pricing, images, and operational records remain offchain unless a specific disclosure is required.

## ETHGlobal demo target

The end-to-end demo is:

1. place landed fish under the camera;
2. capture weight and visual observations on the Jetson;
3. create a structured FishScan;
4. classify the lot through Jev;
5. review or correct the result;
6. publish the lot to the live market;
7. complete a buyer action;
8. show the resulting settlement/provenance record.

The demo must use live state. No hard-coded transaction outcomes or pre-scripted classifications.

## Technical evidence

Current groundwork:
- [Product goals](docs/GOALS.md)
- [Roadmap](docs/ROADMAP.md)
- [Production architecture issue #2](https://github.com/superposition/reeldeal/issues/2)
- [Domain model/API issue #3](https://github.com/superposition/reeldeal/issues/3)
- [Jetson + Jev pipeline issue #4](https://github.com/superposition/reeldeal/issues/4)
- [Dockside intake issue #5](https://github.com/superposition/reeldeal/issues/5)
- [Marketplace lifecycle issue #6](https://github.com/superposition/reeldeal/issues/6)
- [Production controls issue #7](https://github.com/superposition/reeldeal/issues/7)

As implementation lands, this section will link directly to the relevant source files, contracts, tests, deployed addresses, transaction evidence, and live demo.

## ETHGlobal evidence standard

Before submission, every blockchain or partner integration must be independently inspectable from this README.

For each integration we will provide:

- why the integration exists;
- direct links to implementation code;
- direct links to tests;
- deployed contract/network addresses where applicable;
- live transaction or explorer evidence where applicable;
- exact setup/test commands;
- a clear statement of what was built during ETHGlobal.

We will not claim an integration until it works end to end.

## Goals

See [docs/GOALS.md](docs/GOALS.md).

The first production milestone is complete when a fishery can:

```text
capture -> review -> publish -> sell -> settle
```

with a traceable record of every material action and decision.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md).

Current focus: **production foundation and dockside intake contracts.**

## Build status

Planning and architecture foundation are in progress. Application code, contracts, deployment instructions, tests, live URLs, and onchain evidence will be added as implementation begins.
