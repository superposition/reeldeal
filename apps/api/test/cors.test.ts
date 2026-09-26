import { expect, test } from 'bun:test';
import { logHandler, originAllowed } from '../src/routes/request-log';

test('only the configured Pages origin is allowed in production', () => {
  expect(originAllowed('https://superposition.github.io', 'https://superposition.github.io')).toBe(true);
  expect(originAllowed('https://other.example', 'https://superposition.github.io')).toBe(false);
});

test('CORS preflight echoes Pages origin and blocks unrelated origins before route execution', async () => {
  let calls = 0;
  const handler = logHandler(() => { calls++; return new Response(null, { status: 204 }); }, '/v1/test', () => {});
  const allowed = await handler(new Request('https://api.example/v1/test', {
    method: 'OPTIONS', headers: { origin: 'https://superposition.github.io' },
  }));
  expect(allowed.status).toBe(204);
  expect(allowed.headers.get('access-control-allow-origin')).toBe('https://superposition.github.io');
  expect(allowed.headers.get('access-control-allow-headers')).toContain('Authorization');
  const rejected = await handler(new Request('https://api.example/v1/test', {
    method: 'OPTIONS', headers: { origin: 'https://other.example' },
  }));
  expect(rejected.status).toBe(403);
  expect(rejected.headers.get('access-control-allow-origin')).toBeNull();
  expect(calls).toBe(1);
});
