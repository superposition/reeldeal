export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function options(): Response {
  return new Response(null, { status: 204 });
}

export function pending(endpoint: string): Response {
  return json({ error: 'not_implemented', endpoint }, 501);
}
