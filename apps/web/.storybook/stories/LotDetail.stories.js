import LotDetail from '../../src/pages/shop/lot/index.astro';

// Mirrors the API shape of RD-25's seeded sanma lot. It is synthetic demo data:
// the illustration is not a landing photo and there is no sale or chain receipt.
const demoDetail = {
  lot: {
    id: 'demo-lot-sanma', species_label: 'sanma', weight_g: 1480,
    price_jpy: 2400, status: 'listed', gate_reason: null,
  },
  effective_facts: {
    species_label: 'sanma', species_confirmed_by: 'demo-operator',
    length_mm: 412, weight_g: 1480, human_corrected: false,
  },
  observation: {
    length_mm: 412, captured_at: '2026-09-26T00:00:00.000Z',
    image_ref: 'demo:synthetic-no-photo:sanma',
  },
  typed_decision: {
    kind: 'choice', choice: 'medium', score: null, noul_value: null,
    confidence: 0.876, confidence_source: 'stub_heuristic',
    model: { id: 'reeldeal-stub', version: 'rules-v1/questions-v1', sha256: null },
  },
  corrections: [],
  audit: [{
    entity_type: 'Lot', actor_kind: 'system', actor_id: 'rd-25-seed',
    from_status: null, to_status: 'listed', at: '2026-09-26T00:00:00.000Z',
  }],
  gate: { route: 'auto_approve', reason: 'ok' },
};

export default {
  title: 'ReelDeal/03 Organisms/Lot Detail',
  component: LotDetail,
  parameters: { layout: 'fullscreen' },
};

export const Listed = {
  args: {
    initialDetail: demoDetail,
    initialMessage: 'Synthetic demo lot · no landing photo or real sale.',
  },
};

export const ProofOpen = {
  args: {
    initialDetail: demoDetail,
    initialMessage: 'Synthetic demo lot · no landing photo or real sale.',
    initialProofOpen: true,
    initialAuditOpen: true,
  },
};

export const Loading = { args: { initialState: 'loading' } };

export const Unavailable = {
  args: {
    initialState: 'unavailable',
    initialMessage: 'Lot unavailable. Return to the market and choose another lot.',
  },
};
