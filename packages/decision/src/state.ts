import { ObservationSchema, type Observation } from '@reeldeal/domain';

// Laya receives only structured text. Camera bytes are evidence for the human,
// not a model input, and never belong in this state string.
export function buildState(input: Observation): string {
  const observation = ObservationSchema.parse(input);
  const value = (number: number | null, unit: string) => number === null ? 'not recorded' : `${number} ${unit}`;
  const candidates = observation.species_candidates.length === 0
    ? 'none recorded'
    : observation.species_candidates.map(({ label, score }) => `${JSON.stringify(label)} (${score.toFixed(2)})`).join(', ');

  return [
    `Landing scan: ${observation.scan_id}`,
    `Captured at: ${observation.captured_at}`,
    `Capture source: ${observation.source}`,
    `Length: ${value(observation.length_mm, 'mm')}`,
    `Girth: ${value(observation.girth_mm, 'mm')}`,
    `Weight: ${value(observation.weight_g, 'g')}`,
    `Ice temperature: ${value(observation.ice_temp_c, 'C')}`,
    `Scale: ${observation.scale_reading.stable ? 'stable' : 'unstable'}, ${value(observation.scale_reading.grams, 'g')}`,
    `Species candidates (unconfirmed hints): ${candidates}`,
    `Operator-confirmed species: ${observation.species_label ? JSON.stringify(observation.species_label) : 'not confirmed'}`,
    `Species confirmed by: ${observation.species_confirmed_by ?? 'nobody'}`,
  ].join('\n');
}
