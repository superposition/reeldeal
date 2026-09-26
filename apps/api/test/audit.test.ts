import { afterAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';

process.env.DB_PATH = ':memory:';
const { makeAuditRoutes } = await import('../src/routes/audit');
const { logHandler, logRoutes } = await import('../src/routes/request-log');
afterAll(() => { delete process.env.DB_PATH; });

function fixture() {
  const database = new Database(':memory:');
  database.exec(readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  return { database, routes: makeAuditRoutes(database) };
}

function insertRecordedWork(database: Database) {
  database.query(`INSERT INTO orgs (id, slug, name, created_at, updated_at)
    VALUES ('org-1', 'demo', 'Demo', 1, 1)`).run();
  database.query(`INSERT INTO fish_scans
    (id, org_id, captured_at, source, created_at, updated_at)
    VALUES ('scan-1', 'org-1', 1, 'webcam', 1, 1)`).run();
  database.query(`INSERT INTO observations
    (id, scan_id, org_id, payload_json, created_at, updated_at)
    VALUES ('obs-1', 'scan-1', 'org-1', '{}', 1, 1)`).run();
  for (const [id, backend] of [['dec-1', 'laya'], ['dec-2', 'stub']]) {
    const source = backend === 'laya' ? 'laya_entropy' : 'stub_heuristic';
    const runtime = backend === 'laya' ? 'wasm' : 'bun';
    database.query(`INSERT INTO decisions
      (id, scan_id, observation_id, org_id, question_id, kind, payload_json,
       confidence, confidence_source, model_id, model_version, runtime, latency_ms,
       created_at, updated_at)
      VALUES (?, 'scan-1', 'obs-1', 'org-1', 'grade', 'choice', '{}',
        0.8, ?, ?, 'v1', ?, 0, 1, 1)`).run(id, source, backend, runtime);
  }
  for (const [id, status] of [['lot-1', 'pending_review'], ['lot-2', 'approved']]) {
    database.query(`INSERT INTO lots
      (id, org_id, scan_id, decision_id, price_jpy, status, created_at, updated_at)
      VALUES (?, 'org-1', 'scan-1', 'dec-1', 1000, ?, 1, 1)`).run(id, status);
  }
  for (const [id, status] of [['anchor-1', 'pending'], ['anchor-2', 'confirmed']]) {
    database.query(`INSERT INTO provenance_records
      (id, lot_id, org_id, payload_hash, chain_id, anchor_status, created_at, updated_at)
      VALUES (?, 'lot-1', 'org-1', '0xabc', 11155111, ?, 1, 1)`).run(id, status);
  }
  for (const [id, actorKind, at] of [['event-1', 'device', 1], ['event-2', 'user', 2]] as const) {
    database.query(`INSERT INTO audit_log
      (id, entity_type, entity_id, org_id, actor_kind, actor_id,
       from_status, to_status, request_id, payload_json, at)
      VALUES (?, 'Lot', 'lot-1', 'org-1', ?, ?, 'draft', 'pending_review',
       'request-1', '{"reason":"review"}', ?)`).run(id, actorKind, `${actorKind}-1`, at);
  }
}

test('audit API preserves caller-recorded user/device attribution and filters the trail', async () => {
  const { database, routes } = fixture();
  insertRecordedWork(database);
  const get = routes['/v1/audit'].GET;
  const response = await get(new Request('http://localhost/v1/audit?entity=Lot&id=lot-1'));
  expect(response.status).toBe(200);
  const body = await response.json() as { events: Array<Record<string, unknown>> };
  expect(body.events).toHaveLength(2);
  expect(body.events.map((event) => event.actor_kind)).toEqual(['user', 'device']);
  expect(body.events[0]?.actor_id).toBe('user-1');
  expect(body.events[0]?.payload).toEqual({ reason: 'review' });
  expect(body.events[0]?.at).toBe(2);
  expect(body.events[0]?.request_id).toBe('request-1');
  expect((await get(new Request('http://localhost/v1/audit?entity=Lot&id=lot-2')).json()).events).toEqual([]);
  expect((await get(new Request('http://localhost/v1/audit?entity=&id=')).json()).events).toHaveLength(2);
  expect((await get(new Request('http://localhost/v1/audit?entity=Lot'))).status).toBe(400);
  database.close();
});

test('metrics move with persisted work and label uninstrumented browser counters', async () => {
  const { database, routes } = fixture();
  const get = routes['/v1/metrics'].GET;
  const empty = await get();
  const emptyBody = await empty.json();
  expect(emptyBody.scans).toBe(0);
  expect(emptyBody.review_rate.ratio).toBeNull();

  insertRecordedWork(database);
  const response = await get();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.scans).toBe(1);
  expect(body.decisions_per_backend).toEqual({ laya: 1, stub: 1 });
  expect(body.review_rate).toEqual({ reviewed_lots: 1, total_lots: 2, ratio: 0.5 });
  expect(body.anchors).toEqual({ pending: 1, confirmed: 1 });
  expect(body.model_inferences).toBeNull();
  expect(body.weight_cache_hits).toBeNull();
  expect(body.unavailable.weight_cache_hits).toBe('browser_cache_events_not_persisted');
  database.close();
});

test('request logging emits one structured line and never logs query, body, or token', async () => {
  const lines: string[] = [];
  const routes = logRoutes({ '/v1/audit': { GET: (_request: Request) => Response.json({ ok: true }) } }, (line) => lines.push(line));
  const response = await routes['/v1/audit'].GET(new Request('http://localhost/v1/audit?secret=query', {
    headers: { 'x-request-id': 'rid-123', authorization: 'Bearer hidden-token' },
  }));
  expect(response.headers.get('x-request-id')).toBe('rid-123');
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toMatchObject({ event: 'http_request', request_id: 'rid-123', route: '/v1/audit', method: 'GET', status: 200 });
  expect(lines[0]).not.toContain('secret=query');
  expect(lines[0]).not.toContain('hidden-token');

  const failed = logHandler(() => { throw new Error('private diagnostic'); }, '/v1/fail', (line) => lines.push(line));
  const error = await failed(new Request('http://localhost/v1/fail'));
  expect(error.status).toBe(500);
  expect(error.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  expect(lines[1]).not.toContain('private diagnostic');
});
