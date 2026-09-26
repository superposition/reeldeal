import { expect, test } from 'bun:test';
import { auditActionLabel } from './audit-label';

test('acceptance conflict is an attempt, not a second acceptance', () => {
  expect(auditActionLabel({ entity_type: 'Listing', from_status: 'accepted', to_status: 'accepted',
    payload: { action: 'accept', outcome: 'conflict' } }))
    .toBe('Offer acceptance declined · winner already chosen');
});

test('recorded payment reference does not claim verified payment', () => {
  expect(auditActionLabel({ entity_type: 'Payment', from_status: 'quoted', to_status: 'captured',
    payload: { action: 'pay', demo: true, verification: 'unverified' } }))
    .toBe('Demo settlement recorded · payment not verified');
});

test('related settlement transitions retain their demo qualifier', () => {
  for (const entity of ['Sale', 'Lot', 'Listing']) {
    expect(auditActionLabel({ entity_type: entity, from_status: 'before', to_status: 'after',
      payload: { action: 'pay', demo: true, verification: 'unverified' } }))
      .toBe(`Demo ${entity}: before → after · payment not verified`);
  }
});

test('ordinary actions retain the recorded transition without invented evidence', () => {
  expect(auditActionLabel({ entity_type: 'Lot', from_status: null, to_status: 'pending_review' }))
    .toBe('Lot: new → pending_review');
  expect(auditActionLabel({ entity_type: 'Payment', from_status: 'quoted', to_status: 'captured' }))
    .toBe('Payment: quoted → captured');
});

test('absent or malformed payloads are safe to display', () => {
  for (const payload of [undefined, null, 'invalid', 1, []]) {
    expect(auditActionLabel({ entity_type: 'Lot', from_status: null, to_status: null, payload }))
      .toBe('Lot: new → recorded');
  }
});
