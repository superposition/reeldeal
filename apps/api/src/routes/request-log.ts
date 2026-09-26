import { json } from './stub';

// Bun route handlers may require typed path params. Keep their public signatures
// while wrapping them for logging, rather than widening every route to Request.
type Handler = (...args: any[]) => Response | Promise<Response>;
type Routes = Record<string, Record<string, Handler>>;
type LogLine = (line: string) => void;

const REQUEST_ID = /^[A-Za-z0-9._-]{1,80}$/;
const LOCAL_WEB_ORIGINS = new Set(['http://localhost:4321', 'http://127.0.0.1:4321']);

export function originAllowed(origin: string, configured = process.env.PUBLIC_WEB_ORIGIN ?? 'https://superposition.github.io'): boolean {
  return origin === configured || (process.env.NODE_ENV !== 'production' && LOCAL_WEB_ORIGINS.has(origin));
}

export function logHandler(handler: Handler, route: string, emit: LogLine = console.log): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const supplied = request.headers.get('x-request-id');
    const requestId = supplied && REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID();
    const started = performance.now();
    const origin = request.headers.get('origin');
    let response: Response;
    let outcome: 'ok' | 'error' = 'ok';
    try {
      response = origin && !originAllowed(origin)
        ? json({ error: 'origin_not_allowed' }, 403)
        : await handler(request);
    } catch {
      outcome = 'error';
      response = json({ error: 'internal_error' }, 500);
    }
    if (response.status >= 500) outcome = 'error';
    const result = new Response(response.body, response);
    result.headers.set('x-request-id', requestId);
    if (origin && originAllowed(origin)) {
      result.headers.set('access-control-allow-origin', origin);
      result.headers.set('vary', 'Origin');
      result.headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
      result.headers.set('access-control-allow-headers', 'Content-Type, Idempotency-Key, Authorization, X-Request-Id');
    }
    emit(JSON.stringify({
      event: 'http_request',
      at: new Date().toISOString(),
      request_id: requestId,
      method: request.method,
      route,
      status: result.status,
      duration_ms: Math.round((performance.now() - started) * 100) / 100,
      outcome,
    }));
    return result;
  };
}

export function logRoutes<T extends Routes>(routes: T, emit: LogLine = console.log): T {
  return Object.fromEntries(Object.entries(routes).map(([path, methods]) => [
    path,
    Object.fromEntries(Object.entries(methods).map(([method, handler]) => [method, logHandler(handler, path, emit)])),
  ])) as T;
}
