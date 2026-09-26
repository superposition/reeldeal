import { Database } from 'bun:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const configuredPath = process.env.DB_PATH;
const path = configuredPath
  ? configuredPath === ':memory:' ? ':memory:' : resolve(configuredPath)
  : resolve(import.meta.dir, '../../data/reeldeal.sqlite');

if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

export const db = new Database(path, { create: true, strict: true });
db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

export const now = () => Date.now();
export const id = () => crypto.randomUUID();

export type AuditEvent = {
  entity_type: string;
  entity_id: string;
  org_id: string | null;
  actor_kind: 'user' | 'device' | 'wallet' | 'system';
  actor_id: string;
  from_status: string | null;
  to_status: string | null;
  request_id: string;
  payload?: unknown;
};

// Call this inside the same db.transaction() as the state change it describes.
export function audit(event: AuditEvent): void {
  db.query(`
    INSERT INTO audit_log
      (id, entity_type, entity_id, org_id, actor_kind, actor_id,
       from_status, to_status, request_id, payload_json, at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id(), event.entity_type, event.entity_id, event.org_id,
    event.actor_kind, event.actor_id, event.from_status, event.to_status,
    event.request_id, event.payload === undefined ? null : JSON.stringify(event.payload), now(),
  );
}
