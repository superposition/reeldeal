const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Idempotency-Key',
};

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

export function options(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function pending(endpoint: string): Response {
  return json({ error: 'not_implemented', endpoint }, 501);
}
