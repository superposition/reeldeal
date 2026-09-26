import { expect, test } from 'bun:test';
import { BID_TYPES, bidDomain } from '../src/bid';

test('signed bid shape and domain are defined once', () => {
  expect(BID_TYPES.Bid).toEqual([
    { name: 'listing_id', type: 'string' },
    { name: 'amount_jpy', type: 'uint256' },
    { name: 'bidder', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ]);
  expect(bidDomain(1)).toEqual({ name: 'ReelDeal', version: '1', chainId: 1 });
});
