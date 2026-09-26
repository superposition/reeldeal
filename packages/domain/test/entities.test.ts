import { expect, test } from 'bun:test';
import {
  BidSchema,
  CorrectionSchema,
  FishScanSchema,
  ListingSchema,
  LotSchema,
  ObservationInputSchema,
  ObservationSchema,
  OrganizationSchema,
  PaymentSchema,
  ProvenanceRecordSchema,
  SaleSchema,
  TypedDecisionInputSchema,
  TypedDecisionSchema,
  UserSchema,
} from '../src/entities';

const observation = {
  scan_id: 'scan-1',
  captured_at: '2026-09-26T00:00:00Z',
  image_ref: 'data:image/jpeg;base64,AA==',
  source: 'webcam',
  length_mm: 412,
  girth_mm: 210,
  weight_g: 1480,
  ice_temp_c: -1.5,
  species_candidates: [{ label: 'sanma', score: 0.81 }],
  species_label: 'sanma',
  species_confirmed_by: 'operator-1',
  scale_reading: { stable: true, grams: 1478 },
};

test('all twelve entities expose a schema', () => {
  for (const schema of [FishScanSchema, ObservationSchema, TypedDecisionSchema, CorrectionSchema,
    LotSchema, ListingSchema, BidSchema, SaleSchema, PaymentSchema, ProvenanceRecordSchema,
    UserSchema, OrganizationSchema]) {
    expect(typeof schema.safeParse).toBe('function');
  }
});

test('observation accepts missing measurements and rejects invented/out-of-range values', () => {
  expect(ObservationInputSchema.safeParse({ ...observation, weight_g: null, species_label: null, species_confirmed_by: null }).success).toBe(true);
  expect(ObservationInputSchema.safeParse({ ...observation, weight_g: 200_001 }).success).toBe(false);
  expect(ObservationInputSchema.safeParse({ ...observation, species_candidates: [{ label: 'sanma', score: 1.2 }] }).success).toBe(false);
});

const baseDecision = {
  scan_id: 'scan-1',
  observation_id: 'observation-1',
  question_id: 'grade',
  kind: 'choice',
  choice: 'accept',
  score: null,
  score_raw: null,
  score_level: null,
  noul_value: null,
  noul_probability: null,
  confidence: 0.88,
  confidence_source: 'laya_entropy',
  model: { id: 'laya', version: 'q4e8', runtime: 'wasm', sha256: 'a'.repeat(64) },
  latency_ms: 128,
  rationale: 'Matched the question rubric',
};

test('decision requires matching typed value and model evidence', () => {
  expect(TypedDecisionInputSchema.safeParse(baseDecision).success).toBe(true);
  expect(TypedDecisionInputSchema.safeParse({ ...baseDecision, model: { ...baseDecision.model, sha256: null } }).success).toBe(false);
  expect(TypedDecisionInputSchema.safeParse({ ...baseDecision, choice: null }).success).toBe(false);
  expect(TypedDecisionInputSchema.safeParse({ ...baseDecision, score: 0.9 }).success).toBe(false);
});

test('noul is binary probability, including deterministic missing-fact policy', () => {
  const policy = { ...baseDecision, question_id: 'completeness', kind: 'noul', choice: null,
    noul_value: false, noul_probability: 0, confidence: 1,
    confidence_source: 'policy_required_input',
    model: { id: 'reeldeal-policy', version: '1', runtime: 'js', sha256: null } };
  expect(TypedDecisionInputSchema.safeParse(policy).success).toBe(true);
  expect(TypedDecisionInputSchema.safeParse({ ...policy, noul_value: true }).success).toBe(false);
  const laya = { ...policy, question_id: 'price_ok', noul_probability: 0.8, noul_value: true,
    confidence: 0.8, confidence_source: 'laya_noul_probability', model: baseDecision.model };
  expect(TypedDecisionInputSchema.safeParse(laya).success).toBe(true);
});

test('score retains continuous raw index and normalized value', () => {
  const score = { ...baseDecision, question_id: 'quality', kind: 'score', choice: null,
    score_raw: 2.7, score: 0.675, score_level: 3 };
  expect(TypedDecisionInputSchema.safeParse(score).success).toBe(true);
  expect(TypedDecisionInputSchema.safeParse({ ...score, score: 0.75 }).success).toBe(false);
  expect(TypedDecisionInputSchema.safeParse({ ...score, score_level: 2 }).success).toBe(false);
});

test('listing status excludes obsolete bid_received', () => {
  const listing = { id: 'listing-1', seller_org_id: 'org-1', lot_id: 'lot-1',
    price_jpy: 2400, status: 'open', created_at: '2026-09-26T00:00:00Z', updated_at: '2026-09-26T00:00:00Z' };
  expect(ListingSchema.safeParse(listing).success).toBe(true);
  expect(ListingSchema.safeParse({ ...listing, status: 'bid_received' }).success).toBe(false);
});

test('provenance stores only chain evidence and rejects extra fields', () => {
  const record = { id: 'record-1', org_id: 'org-1', lot_id: 'lot-1',
    payload_hash: '0x' + 'a'.repeat(64), chain_id: 1, tx_hash: null,
    anchor_status: 'pending', created_at: '2026-09-26T00:00:00Z', updated_at: '2026-09-26T00:00:00Z' };
  expect(ProvenanceRecordSchema.safeParse(record).success).toBe(true);
  expect(ProvenanceRecordSchema.safeParse({ ...record, unexpected: 'unused' }).success).toBe(false);
});
