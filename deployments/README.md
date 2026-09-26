# Deployment records

There is no deployed contract address in this repository yet. Do not add a
placeholder address or mark an anchor confirmed from a local simulation.

After importing a funded signer with `cast wallet import reeldeal-deployer
--interactive`, deploy with the locally configured RPC URL and keystore:

```text
forge script script/Deploy.s.sol:Deploy --root contracts \
  --account reeldeal-deployer --rpc-url "$REELDEAL_RPC_URL" --broadcast
```

Keep the RPC URL, signing key, and keystore password outside Git, shell
history, and transcripts. Read the actual broadcast receipts, then record the
resulting registry, book, deployer, and deployment block with:

```text
REELDEAL_RPC_URL=<private configuration> bun deployments/record.ts \
  <chain-id> <registry-address> <listing-book-address> <deployer-address> <deployment-block>
```

The recorder checks the live chain ID, contract code at both addresses, and
`ProvenanceRegistry.anchorer()` against the supplied deployer before it writes
`deployments/<chain-id>.json`. It refuses to overwrite an existing record.
The Bun API reads that record using `REELDEAL_CHAIN_ID`; a configured
`REELDEAL_REGISTRY_ADDRESS` can override the file for local testing. The API
also needs `REELDEAL_RPC_URL`, `REELDEAL_ANCHOR_ACCOUNT`,
`REELDEAL_ANCHOR_PASSWORD_FILE` (a path outside Git), and
`REELDEAL_ANCHOR_REQUEST_TOKEN` to send anchors. The token is only for the
operator's server-side request; never put it in the static web build.

Mainnet is chain ID `1`; Sepolia is `11155111`. Record whichever chain was
actually used and describe any fallback as Sepolia, never mainnet. The
contracts record evidence only and do not move funds.
