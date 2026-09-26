type AuditAction = {
  entity_type: string;
  from_status: string | null;
  to_status: string | null;
  payload?: unknown;
};

/** Keep attempted actions and unverified demo payments distinct from proven transitions. */
export function auditActionLabel(event: AuditAction): string {
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown> : {};
  if (event.entity_type === 'Listing' && payload.action === 'accept' && payload.outcome === 'conflict') {
    return 'Offer acceptance declined · winner already chosen';
  }
  const transition = `${event.entity_type}: ${event.from_status ?? 'new'} → ${event.to_status ?? 'recorded'}`;
  if (payload.action === 'pay' && payload.demo === true && payload.verification === 'unverified') {
    return event.entity_type === 'Payment'
      ? 'Demo settlement recorded · payment not verified'
      : `Demo ${transition} · payment not verified`;
  }
  return transition;
}
