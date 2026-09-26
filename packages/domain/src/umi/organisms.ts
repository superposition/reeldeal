import { z } from 'zod';
import {
  AddressSchema, Bytes32Schema, ChainIdSchema, DataModeSchema, IdSchema, JpySchema,
  PositiveUint256Schema, SecondsSchema, SourceKindSchema, SpeciesGroupSchema,
  TimestampSchema, Uint256Schema,
} from './atoms';
import {
  ChainAssetSchema, DataSourceSchema, EvidenceRefSchema, MeasurementSchema,
  PointSchema, QualitySchema, ReadingSchema, ThresholdSchema, TimeWindowSchema,
  VersionedRefSchema,
} from './molecules';

export const ObservationSchema = z.strictObject({
  id: IdSchema,
  source: DataSourceSchema,
  mode: DataModeSchema,
  // Target/sample time differs from publication/model issuance and ingestion time.
  time: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('instant'), at: TimestampSchema }),
    z.strictObject({ kind: z.literal('interval'), window: TimeWindowSchema }),
  ]),
  issued_at: TimestampSchema,
  ingested_at: TimestampSchema,
  location: PointSchema,
  // Null means unknown; zero explicitly means surface. Point is representative.
  depth_m: z.number().finite().nonnegative().nullable(),
  footprint_ref: EvidenceRefSchema.nullable(),
  reading: ReadingSchema,
  quality: QualitySchema,
  method: VersionedRefSchema,
  evidence: EvidenceRefSchema,
});

export const ExposureSchema = z.strictObject({
  id: IdSchema,
  beneficiary_id: IdSchema,
  site: VersionedRefSchema,
  species: z.strictObject({ group: SpeciesGroupSchema, taxon_id: IdSchema }),
  equipment: VersionedRefSchema,
  active_window: TimeWindowSchema,
});

export const ReliefRuleSchema = z.strictObject({
  id: IdSchema,
  version: z.string().min(1),
  species_taxon_id: IdSchema,
  equipment: VersionedRefSchema,
  hazard: z.enum(['heat_stress', 'storm', 'harmful_algal_bloom']),
  threshold: ThresholdSchema,
  evidence_requirements: z.strictObject({
    allowed_sources: z.array(SourceKindSchema).min(1),
    maximum_age_seconds: SecondsSchema.positive(),
    require_calibration: z.boolean(),
  }),
  benefit_schedule: VersionedRefSchema,
});

const EvaluationFields = {
  id: IdSchema,
  exposure_id: IdSchema,
  rule: VersionedRefSchema,
  mode: DataModeSchema,
  window: TimeWindowSchema,
  evaluated_at: TimestampSchema,
};

// These are evaluator outputs. Parsing one does not prove the reported result.
export const TriggerEvaluationSchema = z.discriminatedUnion('result', [
  z.strictObject({
    ...EvaluationFields,
    result: z.literal('crossed'),
    observation_ids: z.array(IdSchema).min(1),
    statistic: MeasurementSchema,
  }),
  z.strictObject({
    ...EvaluationFields,
    result: z.literal('not_crossed'),
    observation_ids: z.array(IdSchema).min(1),
    statistic: MeasurementSchema,
  }),
  z.strictObject({
    ...EvaluationFields,
    result: z.literal('indeterminate'),
    observation_ids: z.array(IdSchema),
    reasons: z.array(z.string().min(1)).min(1),
  }),
]);

// ReelDeal can propose a contribution from a sale without claiming money arrived.
export const ContributionIntentSchema = z.strictObject({
  id: IdSchema,
  fund_id: IdSchema,
  amount_jpy: JpySchema.positive(),
  created_at: TimestampSchema,
  origin: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('donation') }),
    z.strictObject({ kind: z.literal('operator_fee'), operator_id: IdSchema }),
    z.strictObject({ kind: z.literal('product_sale'), sale_id: IdSchema }),
  ]),
});

// Proposed API -> signer -> relief contract boundary. This is not an existing ABI.
export const PayoutInstructionSchema = z.strictObject({
  schema_version: z.literal(1),
  chain_id: ChainIdSchema,
  pool_address: AddressSchema,
  event_key: Bytes32Schema,
  beneficiary_address: AddressSchema,
  asset: ChainAssetSchema,
  amount_base_units: PositiveUint256Schema,
  rule_digest: Bytes32Schema,
  evidence_digest: Bytes32Schema,
  nonce: Uint256Schema,
  expires_at_unix_seconds: SecondsSchema,
});

export const ActuationRequestSchema = z.strictObject({
  idempotency_key: IdSchema,
  evaluation_id: IdSchema,
  beneficiary_id: IdSchema,
  allocation: VersionedRefSchema,
  instruction: PayoutInstructionSchema,
});

// A transaction reference is submission evidence. Confirmation requires a receipt.
export const PayoutSubmissionSchema = z.strictObject({
  request_id: IdSchema,
  chain_id: ChainIdSchema,
  transaction_hash: Bytes32Schema,
  submitted_at: TimestampSchema,
});

export type Observation = z.infer<typeof ObservationSchema>;
export type Exposure = z.infer<typeof ExposureSchema>;
export type ReliefRule = z.infer<typeof ReliefRuleSchema>;
export type TriggerEvaluation = z.infer<typeof TriggerEvaluationSchema>;
export type ContributionIntent = z.infer<typeof ContributionIntentSchema>;
export type PayoutInstruction = z.infer<typeof PayoutInstructionSchema>;
export type ActuationRequest = z.infer<typeof ActuationRequestSchema>;
export type PayoutSubmission = z.infer<typeof PayoutSubmissionSchema>;
