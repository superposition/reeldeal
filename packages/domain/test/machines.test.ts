import { expect, test } from 'bun:test';
import {
  bidMachine,
  fishScanMachine,
  listingMachine,
  lotMachine,
  paymentMachine,
  provenanceMachine,
  saleMachine,
} from '../src/machines';

test('lot accepts legal gates and rejects skipped states', () => {
  expect(lotMachine.can('draft', 'approved')).toBe(true);
  expect(lotMachine.transition('draft', 'pending_review')).toBe('pending_review');
  expect(lotMachine.transition('approved', 'listed')).toBe('listed');
  expect(lotMachine.transition('listed', 'reserved')).toBe('reserved');
  expect(lotMachine.transition('reserved', 'sold')).toBe('sold');
  expect(() => lotMachine.transition('draft', 'sold')).toThrow('illegal transition draft → sold');
  expect(() => lotMachine.transition('sold', 'listed')).toThrow('illegal transition sold → listed');
});

test('listing stays open for multiple bids and has no bid_received state', () => {
  expect(listingMachine.can('open', 'accepted')).toBe(true);
  expect(listingMachine.can('open', 'cancelled')).toBe(true);
  expect(listingMachine.transition('accepted', 'settled')).toBe('settled');
  expect(listingMachine.can('open', 'bid_received' as never)).toBe(false);
  expect(() => listingMachine.transition('settled', 'open')).toThrow('illegal transition settled → open');
});

test('scan, bid, sale, payment, and provenance transitions', () => {
  expect(fishScanMachine.transition('captured', 'observed')).toBe('observed');
  expect(fishScanMachine.transition('observed', 'decided')).toBe('decided');
  expect(fishScanMachine.transition('decided', 'reviewed')).toBe('reviewed');
  expect(fishScanMachine.transition('reviewed', 'promoted')).toBe('promoted');
  expect(bidMachine.transition('placed', 'winning')).toBe('winning');
  expect(bidMachine.transition('winning', 'accepted')).toBe('accepted');
  expect(saleMachine.transition('agreed', 'paid')).toBe('paid');
  expect(paymentMachine.transition('quoted', 'captured')).toBe('captured');
  expect(provenanceMachine.transition('pending', 'submitted')).toBe('submitted');
  expect(provenanceMachine.transition('submitted', 'confirmed')).toBe('confirmed');
  expect(() => provenanceMachine.transition('failed', 'confirmed')).toThrow('illegal transition failed → confirmed');
});

test('every documented v1 transition is legal', () => {
  const cases = [
    [fishScanMachine, [['captured', 'observed'], ['observed', 'decided'], ['decided', 'reviewed'], ['decided', 'promoted'], ['decided', 'discarded'], ['reviewed', 'promoted'], ['reviewed', 'discarded']]],
    [lotMachine, [['draft', 'approved'], ['draft', 'pending_review'], ['pending_review', 'approved'], ['pending_review', 'withdrawn'], ['approved', 'listed'], ['approved', 'withdrawn'], ['listed', 'reserved'], ['listed', 'withdrawn'], ['reserved', 'sold']]],
    [listingMachine, [['open', 'accepted'], ['open', 'cancelled'], ['accepted', 'settled']]],
    [bidMachine, [['placed', 'winning'], ['placed', 'outbid'], ['placed', 'rejected'], ['placed', 'withdrawn'], ['winning', 'accepted']]],
    [saleMachine, [['agreed', 'paid']]],
    [paymentMachine, [['quoted', 'captured']]],
    [provenanceMachine, [['pending', 'submitted'], ['pending', 'failed'], ['submitted', 'confirmed'], ['submitted', 'failed']]],
  ] as const;
  for (const [machine, transitions] of cases) {
    for (const [from, to] of transitions) {
      expect(machine.transition(from as never, to as never)).toBe(to);
    }
  }
});
