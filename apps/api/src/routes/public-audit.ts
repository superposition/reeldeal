import { createHash } from 'node:crypto';

export type AuditRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  org_id: string | null;
  actor_kind: 'user' | 'device' | 'wallet' | 'system';
  actor_id: string;
  from_status: string | null;
  to_status: string | null;
  request_id: string;
  payload_json: string | null;
  at: number;
};

const PRIVATE_PAYLOAD_KEYS = new Set(['buyer_user_id', 'bidder_user_id']);

function publicPayload(value: unknown, wallet: string | null, alias: string | null): unknown {
  if (Array.isArray(value)) return value.map((item) => publicPayload(item, wallet, alias));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_PAYLOAD_KEYS.has(key))
      .map(([key, item]) => [key, publicPayload(item, wallet, alias)]));
  }
  if (wallet !== null && typeof value === 'string' && value.toLowerCase() === wallet) return alias;
  return value;
}

export function serializePublicAudit(row: AuditRow) {
  const { payload_json, ...event } = row;
  const wallet = row.actor_kind === 'wallet' ? row.actor_id.toLowerCase() : null;
  const alias = wallet === null ? null
    : `wallet:${createHash('sha256').update(wallet).digest('hex').slice(0, 12)}`;
  return {
    ...event,
    // A stable public alias is pseudonymous; the full signer remains in durable audit storage.
    actor_id: alias ?? row.actor_id,
    payload: payload_json === null ? null : publicPayload(JSON.parse(payload_json) as unknown, wallet, alias),
  };
}
