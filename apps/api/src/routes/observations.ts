import { ObservationInputSchema, ObservationSchema } from '@reeldeal/domain';
import { audit, db, id, now } from '../db';
import { json, options, pending } from './stub';

const ORG_SLUG = 'kessenuma';

type StoredObservation = {
  id: string;
  scan_id: string;
  org_id: string;
  payload_json: string;
  status: string;
  created_at: number;
  updated_at: number;
};

function wire(row: StoredObservation) {
  return ObservationSchema.parse({
    id: row.id,
    org_id: row.org_id,
    ...JSON.parse(row.payload_json),
    status: row.status,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  });
}

function latest(scanId: string): StoredObservation | null {
  return db.query(`
    SELECT id, scan_id, org_id, payload_json, status, created_at, updated_at
    FROM observations WHERE scan_id = ?
    ORDER BY created_at DESC, rowid DESC LIMIT 1
  `).get(scanId) as StoredObservation | null;
}

function orgId(): string {
  const existing = db.query('SELECT id FROM orgs WHERE slug = ?').get(ORG_SLUG) as { id: string } | null;
  if (existing) return existing.id;
  const org = id();
  const at = now();
  db.query('INSERT OR IGNORE INTO orgs (id, slug, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(org, ORG_SLUG, 'Kesennuma demo market', 'active', at, at);
  return (db.query('SELECT id FROM orgs WHERE slug = ?').get(ORG_SLUG) as { id: string }).id;
}

export async function postObservation(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_input', issues: [{ path: [], message: 'Expected a JSON object' }] }, 400);
  }
  const parsed = ObservationInputSchema.safeParse(body);
  if (!parsed.success) {
    return json({
      error: 'invalid_input',
      issues: parsed.error.issues.map(({ path, message, code }) => ({ path, message, code })),
    }, 400);
  }

  const observation = parsed.data;
  const payload = JSON.stringify(observation);
  const result = db.transaction(() => {
    const owner = orgId();
    const previous = latest(observation.scan_id);
    if (previous?.payload_json === payload) {
      return { observation: wire(previous), replayed: true, replaced: false, status: 200 };
    }

    const existingScan = db.query('SELECT id FROM fish_scans WHERE id = ?').get(observation.scan_id);
    const at = now();
    if (!existingScan) {
      db.query(`
        INSERT INTO fish_scans
          (id, org_id, device_id, user_id, captured_at, image_ref, source, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        observation.scan_id, owner, 'browser-scanner', null,
        Date.parse(observation.captured_at), observation.image_ref,
        observation.source, 'observed', at, at,
      );
      audit({
        entity_type: 'FishScan', entity_id: observation.scan_id, org_id: owner,
        actor_kind: 'device', actor_id: 'browser-scanner',
        from_status: 'captured', to_status: 'observed', request_id: observation.scan_id,
        payload: { source: observation.source },
      });
    } else {
      db.query('UPDATE fish_scans SET updated_at = ? WHERE id = ?').run(at, observation.scan_id);
    }

    const observationId = id();
    db.query(`
      INSERT INTO observations (id, scan_id, org_id, payload_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(observationId, observation.scan_id, owner, payload, 'recorded', at, at);
    audit({
      entity_type: 'Observation', entity_id: observationId, org_id: owner,
      actor_kind: 'device', actor_id: 'browser-scanner',
      from_status: null, to_status: 'recorded', request_id: observation.scan_id,
      payload: { scan_id: observation.scan_id, replaced: Boolean(previous) },
    });

    return {
      observation: wire(latest(observation.scan_id)!),
      replayed: false,
      replaced: Boolean(previous),
      status: 201,
    };
  })();

  return json({ observation: result.observation, replayed: result.replayed, replaced: result.replaced }, result.status);
}

export function getObservation(scanId: string): Response {
  const observation = latest(scanId);
  return observation
    ? json({ observation: wire(observation) })
    : json({ error: 'not_found' }, 404);
}

export const observationRoutes = {
  '/v1/observations': {
    POST: postObservation,
    OPTIONS: options,
  },
  '/v1/observations/:scan_id': {
    GET: (request: Request & { params: { scan_id: string } }) => getObservation(request.params.scan_id),
    OPTIONS: options,
  },
  '/v1/scans/:id/corrections': {
    POST: () => pending('POST /v1/scans/:id/corrections'),
    OPTIONS: options,
  },
};
