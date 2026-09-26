# ReelDeal

ReelDeal is a demo fish-market workflow for ETHGlobal Tokyo 2026. A dockside
operator captures a landing, an open-weights model running in the browser
returns a typed decision, uncertain results go to a human, and a completed
sale can be anchored on Ethereum for tamper-evident provenance.

No hosted model or paid AI API is required. The real decision backend is Laya
ONNX in the browser, with a deterministic local stub as the offline fallback.

## Planned demo flow

```mermaid
flowchart LR
    A[Fish lands at dock] --> B[Camera + manual measurements]
    B --> C[Structured observation]

    subgraph Browser
        C --> D{Decision backend}
        D -->|Model ready| E[Laya ONNX<br/>hash-pinned weights]
        D -->|Offline or unavailable| F[Deterministic stub]
        E --> G[Typed decision<br/>choice / score / noul]
        F --> G
    end

    G --> H{Confidence gate}
    H -->|Uncertain or missing facts| I[Human review<br/>model and correction both kept]
    H -->|Confident| J[Approved lot]
    I --> J

    J --> K[Marketplace listing]
    K --> L[Buyer signs EIP-712 bid]
    L --> M[Seller accepts one winner]
    M --> N[Demo sale]

    C -. audit trail .-> O[(Bun API + SQLite)]
    G -. model metadata .-> O
    I -. correction .-> O
    N --> P[Hash provenance bundle]
    P --> Q[Ethereum anchor]
    Q --> R[Optional ENS lot name]
```

The chain is used for the narrow question it answers well: who committed to a
lot record, when, and whether that record changed. Images, catalog data, bids,
and demo-denominated sales remain off-chain.

> **Scope:** this is a hackathon demonstration. No real fish, real payment, or
> production-grade species identification is claimed. Species labels remain
> operator-confirmed.
