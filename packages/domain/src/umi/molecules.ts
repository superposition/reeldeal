import { z } from 'zod';
import {
  AddressSchema, FractionSchema, IdSchema, LatitudeSchema, LongitudeSchema,
  MetricSchema, SecondsSchema, Sha256Schema, SourceKindSchema, TimestampSchema,
} from './atoms';

export const PointSchema = z.strictObject({
  latitude: LatitudeSchema,
  longitude: LongitudeSchema,
});

// Half-open interval: start is included, end is excluded.
export const TimeWindowSchema = z.strictObject({
  start: TimestampSchema,
  end: TimestampSchema,
}).refine(value => Date.parse(value.end) > Date.parse(value.start), {
  path: ['end'], message: 'end must be after start',
});

export const VersionedRefSchema = z.strictObject({
  id: IdSchema,
  version: z.string().min(1),
});

// Each metric fixes its unit at both the TypeScript and JSON boundaries.
export const MeasurementSchema = z.discriminatedUnion('metric', [
  z.strictObject({ metric: z.literal('water_temperature'), unit: z.literal('degC'), value: z.number().finite() }),
  z.strictObject({ metric: z.literal('significant_wave_height'), unit: z.literal('m'), value: z.number().finite().nonnegative() }),
  z.strictObject({ metric: z.literal('wind_speed'), unit: z.literal('m/s'), value: z.number().finite().nonnegative() }),
  z.strictObject({ metric: z.literal('chlorophyll_a'), unit: z.literal('mg/m3'), value: z.number().finite().nonnegative() }),
]);

export const ReadingSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('present'), measurement: MeasurementSchema }),
  z.strictObject({ state: z.literal('missing'), metric: MetricSchema, reason: z.string().min(1) }),
]);

export const EvidenceRefSchema = z.strictObject({
  uri: z.url(),
  sha256: Sha256Schema,
  // E.g. PDF page/table, raster band/pixel, or sensor record key.
  locator: z.string().min(1).nullable(),
});

export const DataSourceSchema = z.strictObject({
  id: IdSchema,
  kind: SourceKindSchema,
  publisher: z.string().min(1),
  product: z.string().min(1),
  version: z.string().min(1).nullable(),
});

export const QualitySchema = z.strictObject({
  status: z.enum(['unreviewed', 'accepted', 'suspect', 'rejected']),
  reason: z.string().min(1),
  // Links the calibration/validation record; does not assert measured accuracy.
  calibration_ref: EvidenceRefSchema.nullable(),
});

export const ThresholdSchema = z.strictObject({
  limit: MeasurementSchema,
  operator: z.enum(['gt', 'gte', 'lt', 'lte']),
  aggregation: z.enum(['mean', 'minimum', 'maximum']),
  window_seconds: SecondsSchema.positive(),
  minimum_coverage_fraction: FractionSchema.refine(value => value > 0, 'coverage must be positive'),
  maximum_gap_seconds: SecondsSchema,
}).refine(value => value.maximum_gap_seconds <= value.window_seconds, {
  path: ['maximum_gap_seconds'], message: 'maximum gap cannot exceed the window',
});

// The containing instruction supplies the chain; native assets have no token address.
export const ChainAssetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('native') }),
  z.strictObject({ kind: z.literal('erc20'), token_address: AddressSchema }),
]);

export type Point = z.infer<typeof PointSchema>;
export type TimeWindow = z.infer<typeof TimeWindowSchema>;
export type VersionedRef = z.infer<typeof VersionedRefSchema>;
export type Measurement = z.infer<typeof MeasurementSchema>;
export type Reading = z.infer<typeof ReadingSchema>;
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type DataSource = z.infer<typeof DataSourceSchema>;
export type Quality = z.infer<typeof QualitySchema>;
export type Threshold = z.infer<typeof ThresholdSchema>;
export type ChainAsset = z.infer<typeof ChainAssetSchema>;
