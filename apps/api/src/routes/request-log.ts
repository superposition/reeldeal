import { json } from './stub';

type Handler = (request: Request) => Response | Promise<Response>;
type Routes = Record<string, Record<string, Handler>>;
type LogLine = (line: string) => void;

const REQUEST_ID = /^[A-Za-z0-9._-]{1,80}$/;

export function logHandler(handler: Handler, route: string, emit: LogLine = console.log): Handler {
  return async (request) => {
    const supplied = request.headers.get('x-request-id');
    const requestId = supplied && REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID();
    const started = performance.now();
    let response: Response;
    let outcome: 'ok' | 'error' = 'ok';
    try {
      response = await handler(request);
    } catch {
      outcome = 'error';
      response = json({ error: 'internal_error' }, 500);
    }
    if (response.status >= 500) outcome = 'error';
    const result = new Response(response.body, response);
    result.headers.set('x-request-id', requestId);
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
