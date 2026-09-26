import type { Database } from 'bun:sqlite';
import { db } from '../db';
import { json, options } from './stub';

type AuditRow = {
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

const ENTITY = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

function count(database: Database, sql: string): number {
  return (database.query(sql).get() as { count: number }).count;
}

export function makeAuditRoutes(database: Database) {
  return {
    '/v1/audit': {
      GET: (request: Request) => {
        const search = new URL(request.url).searchParams;
        const entity = search.get('entity') || null;
        const id = search.get('id') || null;
        const requestedLimit = search.get('limit');
        const limit = requestedLimit === null ? 100 : Number(requestedLimit);
        if ((entity === null) !== (id === null)
          || (entity !== null && !ENTITY.test(entity))
          || (id !== null && (id.length === 0 || id.length > 100))
          || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
          return json({ error: 'invalid_audit_filter' }, 400);
        }

        try {
          const rows = database.query(`
            SELECT * FROM audit_log
            WHERE (? IS NULL OR entity_type = ?) AND (? IS NULL OR entity_id = ?)
            ORDER BY at DESC, rowid DESC LIMIT ?
          `).all(entity, entity, id, id, limit) as AuditRow[];
          return json({
            events: rows.map(({ payload_json, ...row }) => ({
              ...row,
              payload: payload_json === null ? null : JSON.parse(payload_json) as unknown,
              at_iso: new Date(row.at).toISOString(),
            })),
          });
        } catch {
          return json({ error: 'audit_unavailable' }, 503);
        }
      },
      OPTIONS: options,
    },
    '/v1/metrics': {
      GET: () => {
        try {
          const backends = database.query(`
            SELECT model_id AS backend, COUNT(*) AS count
            FROM decisions GROUP BY model_id ORDER BY model_id
          `).all() as Array<{ backend: string; count: number }>;
          const totalLots = count(database, 'SELECT COUNT(*) AS count FROM lots');
          const reviewedLots = count(database, `
            SELECT COUNT(*) AS count FROM lots
            WHERE status = 'pending_review' OR EXISTS (
              SELECT 1 FROM audit_log
              WHERE entity_type = 'Lot' AND entity_id = lots.id AND to_status = 'pending_review'
            )
          `);
          return json({
            scans: count(database, 'SELECT COUNT(*) AS count FROM fish_scans'),
            decisions_per_backend: Object.fromEntries(backends.map(({ backend, count: value }) => [backend, value])),
            review_rate: {
              reviewed_lots: reviewedLots,
              total_lots: totalLots,
              ratio: totalLots === 0 ? null : reviewedLots / totalLots,
            },
            anchors: {
              pending: count(database, "SELECT COUNT(*) AS count FROM provenance_records WHERE anchor_status = 'pending'"),
              confirmed: count(database, "SELECT COUNT(*) AS count FROM provenance_records WHERE anchor_status = 'confirmed'"),
            },
            // Browser inference and weight-cache events are not persisted yet.
            // A fabricated zero would falsely imply successful instrumentation.
            model_inferences: null,
            weight_cache_hits: null,
            unavailable: {
              model_inferences: 'browser_inference_events_not_persisted',
              weight_cache_hits: 'browser_cache_events_not_persisted',
            },
          });
        } catch {
          return json({ error: 'metrics_unavailable' }, 503);
        }
      },
      OPTIONS: options,
    },
  };
}

export const auditRoutes = makeAuditRoutes(db);
