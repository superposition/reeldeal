import { z } from 'zod';
import {
  BID_STATUSES,
  FISH_SCAN_STATUSES,
  LISTING_STATUSES,
  LOT_STATUSES,
  PAYMENT_STATUSES,
  PROVENANCE_STATUSES,
  SALE_STATUSES,
} from './machines';

export const IdSchema = z.string().min(1);
export const TimestampSchema = z.string().datetime({ offset: true });
export const JpySchema = z.number().int().nonnegative().safe();
const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const HashSchema = z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/);
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const CoreMetadata = {
  id: IdSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
};
const Metadata = { ...CoreMetadata, org_id: IdSchema };
const ImmutableStatus = z.literal('recorded');

export const FishScanSchema = z.strictObject({
  ...Metadata,
  captured_at: TimestampSchema,
  image_ref: z.string().min(1),
  source: z.enum(['webcam', 'upload', 'manual']),
  device_id: IdSchema.optional(),
  user_id: IdSchema.nullable().optional(),
  status: z.enum(FISH_SCAN_STATUSES),
});

const ObservationFields = {
  scan_id: IdSchema,
  captured_at: TimestampSchema,
  image_ref: z.string().min(1),
  source: z.enum(['webcam', 'upload', 'manual']),
  length_mm: z.number().finite().min(0).max(2_000).nullable(),
  girth_mm: z.number().finite().min(0).max(2_000).nullable(),
  weight_g: z.number().finite().min(0).max(200_000).nullable(),
  ice_temp_c: z.number().finite().min(-30).max(30).nullable(),
  species_candidates: z.array(z.strictObject({
    label: z.string().min(1),
    score: z.number().finite().min(0).max(1),
  })).max(10),
  species_label: z.string().min(1).nullable().optional(),
  species_confirmed_by: IdSchema.nullable().optional(),
  scale_reading: z.strictObject({
    stable: z.boolean(),
    grams: z.number().finite().min(0).max(200_000).nullable(),
  }),
};

function checkSpeciesPair(value: { species_label?: string | null; species_confirmed_by?: string | null }, ctx: z.RefinementCtx) {
  if (Boolean(value.species_label) !== Boolean(value.species_confirmed_by)) {
    ctx.addIssue({ code: 'custom', path: ['species_confirmed_by'], message: 'species label and confirmer must be supplied together' });
  }
}

export const ObservationInputSchema = z.strictObject(ObservationFields).superRefine(checkSpeciesPair);
export const ObservationSchema = z.strictObject({
  ...Metadata,
  ...ObservationFields,
  status: ImmutableStatus,
}).superRefine(checkSpeciesPair);

const ModelSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
  runtime: z.string().min(1),
  sha256: Sha256Schema.nullable().optional(),
});

export const ConfidenceSourceSchema = z.enum([
  'laya_entropy', 'laya_noul_probability', 'stub_heuristic', 'policy_required_input',
]);

const DecisionFields = {
  scan_id: IdSchema,
  observation_id: IdSchema,
  decision_id: IdSchema.optional(), // Stable client request ID for idempotent retries.
  question_id: z.string().min(1),
  kind: z.enum(['choice', 'score', 'noul']),
  choice: z.string().min(1).nullable(),
  score: z.number().finite().min(0).max(1).nullable(),
  score_raw: z.number().finite().min(0).max(4).nullable(),
  score_level: z.number().int().min(0).max(4).nullable(),
  noul_value: z.boolean().nullable(),
  noul_probability: z.number().finite().min(0).max(1).nullable(),
  probabilities: z.array(z.number().finite().min(0).max(1)).min(2).optional(),
  confidence: z.number().finite().min(0).max(1),
  confidence_source: ConfidenceSourceSchema,
  model: ModelSchema,
  latency_ms: z.number().int().nonnegative(),
  rationale: z.string().max(2_000),
};

const DecisionBaseSchema = z.strictObject(DecisionFields);
type DecisionFieldsType = z.infer<typeof DecisionBaseSchema>;

function checkDecision(value: DecisionFieldsType, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (value.kind === 'choice') {
    if (value.choice === null) issue('choice', 'choice answer required');
    if (value.score !== null || value.score_raw !== null || value.score_level !== null || value.noul_value !== null || value.noul_probability !== null) issue('kind', 'choice must not contain score or noul values');
  } else if (value.kind === 'score') {
    if (value.score === null || value.score_raw === null || value.score_level === null) issue('score', 'raw, normalized and display score required');
    else {
      if (Math.abs(value.score - value.score_raw / 4) > 1e-9) issue('score', 'normalized score must equal raw score / 4');
      if (value.score_level !== Math.round(value.score_raw)) issue('score_level', 'display level must round raw score');
    }
    if (value.choice !== null || value.noul_value !== null || value.noul_probability !== null) issue('kind', 'score must not contain choice or noul values');
  } else {
    if (value.noul_value === null || value.noul_probability === null) issue('noul_value', 'binary noul value and probability required');
    else if (value.noul_value !== (value.noul_probability >= 0.5)) issue('noul_value', 'noul value must match P(true)');
    if (value.choice !== null || value.score !== null || value.score_raw !== null || value.score_level !== null) issue('kind', 'noul must not contain choice or score values');
  }

  if (value.confidence_source.startsWith('laya_') && !value.model.sha256) issue('model', 'Laya weight sha256 required');
  if (value.confidence_source === 'laya_noul_probability') {
    if (value.kind !== 'noul' || value.noul_probability === null) issue('confidence_source', 'Laya noul confidence requires a noul answer');
    else if (Math.abs(value.confidence - Math.max(value.noul_probability, 1 - value.noul_probability)) > 1e-9) issue('confidence', 'Laya noul confidence must match answer probability');
  }
  if (value.confidence_source === 'laya_entropy' && value.kind === 'noul') issue('confidence_source', 'noul uses binary probability confidence');
  if (value.confidence_source === 'policy_required_input' && (value.kind !== 'noul' || value.question_id !== 'completeness' || value.noul_value !== false)) issue('confidence_source', 'required-input policy must be a false completeness result');
  if (value.probabilities && Math.abs(value.probabilities.reduce((sum, p) => sum + p, 0) - 1) > 1e-6) issue('probabilities', 'probabilities must sum to one');
}

export const TypedDecisionInputSchema = DecisionBaseSchema.superRefine(checkDecision);
export const TypedDecisionSchema = z.strictObject({
  ...Metadata,
  ...DecisionFields,
  status: ImmutableStatus,
}).superRefine(checkDecision);

const CorrectionValueSchema = z.union([z.string().min(1), z.number().finite(), z.boolean(), z.null()]);
export const CorrectionSchema = z.strictObject({
  ...Metadata,
  scan_id: IdSchema,
  lot_id: IdSchema.nullable().optional(),
  field: z.string().min(1),
  model_value: CorrectionValueSchema,
  human_value: CorrectionValueSchema,
  reason: z.string().min(1),
  actor_id: IdSchema,
  status: z.literal('applied'),
});

export const LotSchema = z.strictObject({
  ...Metadata,
  scan_id: IdSchema,
  decision_id: IdSchema,
  species_label: z.string().min(1).nullable(),
  weight_g: z.number().finite().min(0).max(200_000).nullable(),
  price_jpy: JpySchema,
  status: z.enum(LOT_STATUSES),
});

export const ListingSchema = z.strictObject({
  ...CoreMetadata,
  seller_org_id: IdSchema,
  lot_id: IdSchema,
  price_jpy: JpySchema,
  status: z.enum(LISTING_STATUSES),
});

export const BidSchema = z.strictObject({
  ...CoreMetadata,
  listing_id: IdSchema,
  bidder_user_id: IdSchema,
  amount_jpy: JpySchema.positive(),
  bidder: AddressSchema,
  nonce: z.union([z.string().regex(/^[0-9]+$/), z.number().int().nonnegative().safe()]),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  status: z.enum(BID_STATUSES),
});

export const SaleSchema = z.strictObject({
  ...Metadata,
  listing_id: IdSchema,
  bid_id: IdSchema,
  buyer_user_id: IdSchema,
  amount_jpy: JpySchema,
  status: z.enum(SALE_STATUSES),
});

export const PaymentSchema = z.strictObject({
  ...Metadata,
  sale_id: IdSchema,
  amount_jpy: JpySchema,
  tx_hash: HashSchema.nullable().optional(),
  status: z.enum(PAYMENT_STATUSES),
});

export const ProvenanceRecordSchema = z.strictObject({
  ...Metadata,
  lot_id: IdSchema,
  payload_hash: HashSchema,
  chain_id: z.number().int().positive(),
  tx_hash: HashSchema.nullable().optional(),
  anchor_status: z.enum(PROVENANCE_STATUSES),
});

export const UserSchema = z.strictObject({
  ...Metadata,
  org_id: IdSchema.nullable(),
  label: z.string().min(1),
  role: z.enum(['seller', 'operator', 'buyer']),
  wallet: AddressSchema.nullable().optional(),
  status: z.enum(['active', 'disabled']),
});

export const OrganizationSchema = z.strictObject({
  ...CoreMetadata,
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
  status: z.enum(['active', 'disabled']),
});
export const OrgSchema = OrganizationSchema;

export type FishScan = z.infer<typeof FishScanSchema>;
export type ObservationInput = z.infer<typeof ObservationInputSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type TypedDecisionInput = z.infer<typeof TypedDecisionInputSchema>;
export type TypedDecision = z.infer<typeof TypedDecisionSchema>;
export type Correction = z.infer<typeof CorrectionSchema>;
export type Lot = z.infer<typeof LotSchema>;
export type Listing = z.infer<typeof ListingSchema>;
export type Bid = z.infer<typeof BidSchema>;
export type Sale = z.infer<typeof SaleSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type ProvenanceRecord = z.infer<typeof ProvenanceRecordSchema>;
export type User = z.infer<typeof UserSchema>;
export type Organization = z.infer<typeof OrganizationSchema>;
export type Org = Organization;
