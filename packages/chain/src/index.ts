// Contract ABI fragments for viem consumers. Keep these aligned with the
// signatures in contracts/src; Foundry's build artifacts are not committed.
// This is the public read/write/event subset, not the complete error ABI.
export const provenanceRegistryAbi = [
  {
    type: 'function', name: 'anchor', stateMutability: 'nonpayable',
    inputs: [
      { name: 'lotId', type: 'bytes32' },
      { name: 'payloadHash', type: 'bytes32' },
      { name: 'uri', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'anchorCount', stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'anchorer', stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event', name: 'Anchored', anonymous: false,
    inputs: [
      { name: 'lotId', type: 'bytes32', indexed: true },
      { name: 'payloadHash', type: 'bytes32', indexed: false },
      { name: 'author', type: 'address', indexed: true },
      { name: 'uri', type: 'string', indexed: false },
    ],
  },
] as const;

export const listingBookAbi = [
  {
    type: 'function', name: 'createListing', stateMutability: 'nonpayable',
    inputs: [
      { name: 'lotId', type: 'bytes32' },
      { name: 'referenceAmount', type: 'uint256' },
      { name: 'uri', type: 'string' },
    ],
    outputs: [{ name: 'listingId', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'recordSale', stateMutability: 'nonpayable',
    inputs: [
      { name: 'listingId', type: 'bytes32' },
      { name: 'buyer', type: 'address' },
      { name: 'referenceAmount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'listings', stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [
      { name: 'seller', type: 'address' },
      { name: 'open', type: 'bool' },
    ],
  },
  {
    type: 'event', name: 'ListingCreated', anonymous: false,
    inputs: [
      { name: 'listingId', type: 'bytes32', indexed: true },
      { name: 'lotId', type: 'bytes32', indexed: true },
      { name: 'seller', type: 'address', indexed: true },
      { name: 'referenceAmount', type: 'uint256', indexed: false },
      { name: 'uri', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event', name: 'SaleSettled', anonymous: false,
    inputs: [
      { name: 'listingId', type: 'bytes32', indexed: true },
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'referenceAmount', type: 'uint256', indexed: false },
    ],
  },
] as const;
