import { expect, test } from 'bun:test';
import { umi } from '../src';

const instant = '2026-09-26T00:00:00Z';
const window = { start: instant, end: '2026-09-26T01:00:00Z' };
const temperature = { metric: 'water_temperature', unit: 'degC', value: 30 } as const;
const evidence = { uri: 'https://example.org/synthetic.csv', sha256: 'a'.repeat(64), locator: 'row 1' };

test('measurement units stay tied to their metric, with no numeric coercion', () => {
  expect(umi.MeasurementSchema.parse(temperature)).toEqual(temperature);
  for (const measurement of [
    { ...temperature, unit: 'm' },
    { ...temperature, value: '30' },
    { ...temperature, value: Number.NaN },
    { metric: 'significant_wave_height', unit: 'm', value: -1 },
  ]) expect(umi.MeasurementSchema.safeParse(measurement).success).toBe(false);

  // The same constraint also exists before code runs.
  // @ts-expect-error A temperature cannot have the wave-height unit.
  const wrongUnit: umi.Measurement = { metric: 'water_temperature', unit: 'm', value: 30 };
  expect(umi.MeasurementSchema.safeParse(wrongUnit).success).toBe(false);
});

test('missing data is explicit and cannot carry an invented zero reading', () => {
  expect(umi.ReadingSchema.parse({ state: 'present', measurement: { ...temperature, value: 0 } }).state).toBe('present');
  const missing = { state: 'missing', metric: 'water_temperature', reason: 'cloud masked' };
  expect(umi.ReadingSchema.parse(missing).state).toBe('missing');
  expect(umi.ReadingSchema.safeParse({ ...missing, measurement: temperature }).success).toBe(false);
  expect(umi.ReadingSchema.safeParse({ ...missing, reason: '' }).success).toBe(false);
});

test('time intervals compare instants across offsets and reject empty/reversed windows', () => {
  expect(umi.TimeWindowSchema.safeParse({ start: '2026-09-26T09:00:00+09:00', end: window.end }).success).toBe(true);
  expect(umi.TimeWindowSchema.safeParse({ start: instant, end: instant }).success).toBe(false);
  expect(umi.TimeWindowSchema.safeParse({ start: window.end, end: instant }).success).toBe(false);
  expect(umi.TimeWindowSchema.safeParse({ ...window, start: '2026-09-26T00:00:00' }).success).toBe(false);
});

test('a sensor sample and a model forecast retain separate time and provenance fields', () => {
  const observation: umi.Observation = {
    id: 'synthetic-observation',
    source: { id: 'test-source', kind: 'in_situ_sensor', publisher: 'Synthetic fixture', product: 'test buoy', version: null },
    mode: 'observed', time: { kind: 'instant', at: instant },
    issued_at: instant, ingested_at: instant,
    location: { latitude: 35, longitude: 139 }, depth_m: 0, footprint_ref: null,
    reading: { state: 'present', measurement: temperature },
    quality: { status: 'unreviewed', reason: 'Synthetic fixture', calibration_ref: null },
    method: { id: 'test-ingestion', version: '1' }, evidence,
  };
  expect(umi.ObservationSchema.parse(observation).depth_m).toBe(0);
  expect(umi.ObservationSchema.parse({ ...observation, depth_m: null }).depth_m).toBeNull();
  const forecast = umi.ObservationSchema.parse({ ...observation, mode: 'forecast', time: { kind: 'interval', window } });
  expect(forecast.mode).toBe('forecast');
  expect(forecast.issued_at).toBe(instant);
  expect(umi.ObservationSchema.safeParse({ ...observation, location: { latitude: 91, longitude: 139 } }).success).toBe(false);
  expect(umi.ObservationSchema.safeParse({ ...observation, evidence: { ...evidence, sha256: 'unknown' } }).success).toBe(false);
});

test('thresholds require a time window and usable coverage rules', () => {
  // Synthetic values exercise the shape; these are not species tolerances.
  const threshold = { limit: temperature, operator: 'gte', aggregation: 'mean',
    window_seconds: 3600, minimum_coverage_fraction: 0.9, maximum_gap_seconds: 300 };
  expect(umi.ThresholdSchema.safeParse(threshold).success).toBe(true);
  expect(umi.ThresholdSchema.safeParse({ ...threshold, window_seconds: 0 }).success).toBe(false);
  expect(umi.ThresholdSchema.safeParse({ ...threshold, minimum_coverage_fraction: 0 }).success).toBe(false);
  expect(umi.ThresholdSchema.safeParse({ ...threshold, maximum_gap_seconds: 3601 }).success).toBe(false);
});

test('an evaluation with insufficient evidence cannot masquerade as a measured non-event', () => {
  const base = { id: 'evaluation-1', exposure_id: 'exposure-1', rule: { id: 'rule-1', version: '1' },
    mode: 'observed', window, evaluated_at: window.end };
  expect(umi.TriggerEvaluationSchema.safeParse({ ...base, result: 'indeterminate', observation_ids: [], reasons: ['no usable observations'] }).success).toBe(true);
  expect(umi.TriggerEvaluationSchema.safeParse({ ...base, result: 'not_crossed', observation_ids: [], statistic: temperature }).success).toBe(false);
  expect(umi.TriggerEvaluationSchema.safeParse({ ...base, result: 'crossed', observation_ids: ['observation-1'], statistic: temperature }).success).toBe(true);
  expect(umi.TriggerEvaluationSchema.safeParse({ ...base, result: 'indeterminate', observation_ids: [], reasons: [] }).success).toBe(false);
});

test('uint256 amounts survive JSON exactly and reject overflow or ambiguous encodings', () => {
  const maximum = ((1n << 256n) - 1n).toString();
  expect(umi.Uint256Schema.parse(JSON.parse(JSON.stringify(maximum)))).toBe(maximum);
  for (const amount of [0, 1.5, '01', '-1', '1.0', '1e18', ' 1', 'abc', (1n << 256n).toString()]) {
    expect(umi.Uint256Schema.safeParse(amount).success).toBe(false);
  }
  expect(umi.Uint256Schema.parse('0')).toBe('0');
  expect(umi.PositiveUint256Schema.safeParse('0').success).toBe(false);
});

test('actuation carries explicit chain, replay, evidence, and amount fields', () => {
  const instruction: umi.PayoutInstruction = {
    schema_version: 1, chain_id: 31337, pool_address: '0x' + '1'.repeat(40),
    event_key: '0x' + '2'.repeat(64), beneficiary_address: '0x' + '3'.repeat(40),
    asset: { kind: 'native' }, amount_base_units: '1000000000000000001',
    rule_digest: '0x' + '4'.repeat(64), evidence_digest: '0x' + '5'.repeat(64),
    nonce: '0', expires_at_unix_seconds: 1790380800,
  };
  const request: umi.ActuationRequest = { idempotency_key: 'request-1', evaluation_id: 'evaluation-1',
    beneficiary_id: 'beneficiary-1', allocation: { id: 'allocation-1', version: '1' }, instruction };
  expect(umi.ActuationRequestSchema.parse(JSON.parse(JSON.stringify(request))).instruction.amount_base_units).toBe('1000000000000000001');
  expect(umi.PayoutInstructionSchema.safeParse({ ...instruction, amount_base_units: 1000 }).success).toBe(false);
  expect(umi.PayoutInstructionSchema.safeParse({ ...instruction, asset: { kind: 'erc20' } }).success).toBe(false);
  expect(umi.PayoutInstructionSchema.safeParse({ ...instruction, nonce: undefined }).success).toBe(false);
  expect(umi.PayoutInstructionSchema.safeParse({ ...instruction, paid: true }).success).toBe(false);
});

test('a product-sale contribution retains its sale link without becoming a payment receipt', () => {
  const contribution = { id: 'contribution-1', fund_id: 'umi', amount_jpy: 100, created_at: instant,
    origin: { kind: 'product_sale', sale_id: 'sale-1' } };
  expect(umi.ContributionIntentSchema.safeParse(contribution).success).toBe(true);
  expect(umi.ContributionIntentSchema.safeParse({ ...contribution, origin: { kind: 'product_sale' } }).success).toBe(false);
  expect(umi.ContributionIntentSchema.safeParse({ ...contribution, received: true }).success).toBe(false);
});
