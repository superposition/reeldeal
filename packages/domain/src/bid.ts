export const BID_TYPES = {
  Bid: [
    { name: 'listing_id', type: 'string' },
    { name: 'amount_jpy', type: 'uint256' },
    { name: 'bidder', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

export function bidDomain(chainId: number) {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('invalid chainId');
  return { name: 'ReelDeal', version: '1', chainId } as const;
}
