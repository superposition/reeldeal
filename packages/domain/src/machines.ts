export const FISH_SCAN_STATUSES = ['captured', 'observed', 'decided', 'reviewed', 'promoted', 'discarded'] as const;
export const LOT_STATUSES = ['draft', 'pending_review', 'approved', 'listed', 'reserved', 'sold', 'withdrawn'] as const;
export const LISTING_STATUSES = ['open', 'accepted', 'settled', 'cancelled'] as const;
export const BID_STATUSES = ['placed', 'winning', 'accepted', 'outbid', 'rejected', 'withdrawn'] as const;
export const SALE_STATUSES = ['agreed', 'paid'] as const;
export const PAYMENT_STATUSES = ['quoted', 'captured'] as const;
export const PROVENANCE_STATUSES = ['pending', 'submitted', 'confirmed', 'failed'] as const;

export type FishScanStatus = typeof FISH_SCAN_STATUSES[number];
export type LotStatus = typeof LOT_STATUSES[number];
export type ListingStatus = typeof LISTING_STATUSES[number];
export type BidStatus = typeof BID_STATUSES[number];
export type SaleStatus = typeof SALE_STATUSES[number];
export type PaymentStatus = typeof PAYMENT_STATUSES[number];
export type ProvenanceStatus = typeof PROVENANCE_STATUSES[number];

function machine<Status extends string>(allowed: Record<Status, readonly Status[]>) {
  const can = (from: Status, to: Status): boolean => allowed[from]?.includes(to) ?? false;
  return {
    can,
    transition(from: Status, to: Status): Status {
      if (!can(from, to)) throw new Error(`illegal transition ${from} → ${to}`);
      return to;
    },
  };
}

export const fishScanMachine = machine<FishScanStatus>({
  captured: ['observed'],
  observed: ['decided'],
  decided: ['reviewed', 'promoted', 'discarded'],
  reviewed: ['promoted', 'discarded'],
  promoted: [],
  discarded: [],
});

export const lotMachine = machine<LotStatus>({
  draft: ['pending_review', 'approved'],
  pending_review: ['approved', 'withdrawn'],
  approved: ['listed', 'withdrawn'],
  listed: ['reserved', 'withdrawn'],
  reserved: ['sold'],
  sold: [],
  withdrawn: [],
});

// A bid is a child record. It does not move the listing out of `open`.
export const listingMachine = machine<ListingStatus>({
  open: ['accepted', 'cancelled'],
  accepted: ['settled'],
  settled: [],
  cancelled: [],
});

export const bidMachine = machine<BidStatus>({
  placed: ['winning', 'outbid', 'rejected', 'withdrawn'],
  winning: ['accepted'],
  accepted: [],
  outbid: [],
  rejected: [],
  withdrawn: [],
});

export const saleMachine = machine<SaleStatus>({ agreed: ['paid'], paid: [] });
export const paymentMachine = machine<PaymentStatus>({ quoted: ['captured'], captured: [] });
export const provenanceMachine = machine<ProvenanceStatus>({
  pending: ['submitted', 'failed'],
  submitted: ['confirmed', 'failed'],
  confirmed: [],
  failed: [], // A retry is a new immutable attempt.
});
