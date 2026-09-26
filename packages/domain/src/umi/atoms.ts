import { z } from 'zod';

// Reuse the marketplace's wire conventions without changing its entities.
export { IdSchema, TimestampSchema, JpySchema } from '../entities';

export const LatitudeSchema = z.number().finite().min(-90).max(90);
export const LongitudeSchema = z.number().finite().min(-180).max(180);
export const FractionSchema = z.number().finite().min(0).max(1);
export const SecondsSchema = z.number().int().nonnegative().safe();
export const ChainIdSchema = z.number().int().positive().safe();
export const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const Bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

// JSON carries exact base units as decimal strings, never floating-point money.
const UINT256_MAX = (1n << 256n) - 1n;
export const Uint256Schema = z.string().max(78).regex(/^(0|[1-9][0-9]*)$/)
  .refine(value => /^(0|[1-9][0-9]*)$/.test(value)
    && value.length <= 78 && BigInt(value) <= UINT256_MAX, 'must fit uint256');
export const PositiveUint256Schema = Uint256Schema.refine(value => value !== '0', 'must be positive');

export const MetricSchema = z.enum([
  'water_temperature', 'significant_wave_height', 'wind_speed', 'chlorophyll_a',
]);
export const SourceKindSchema = z.enum(['satellite', 'in_situ_sensor', 'government_report']);
export const DataModeSchema = z.enum(['observed', 'forecast', 'hindcast']);
export const SpeciesGroupSchema = z.enum(['finfish', 'shellfish', 'seaweed']);

export type Metric = z.infer<typeof MetricSchema>;
export type SourceKind = z.infer<typeof SourceKindSchema>;
export type DataMode = z.infer<typeof DataModeSchema>;
