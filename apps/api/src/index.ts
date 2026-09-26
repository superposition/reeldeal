import { db } from './db';
import { auditRoutes } from './routes/audit';
import { bidRoutes } from './routes/bids';
import { decisionRoutes } from './routes/decisions';
import { listingRoutes } from './routes/listings';
import { lotRoutes } from './routes/lots';
import { observationRoutes } from './routes/observations';
import { orgRoutes } from './routes/orgs';
import { provenanceRoutes } from './routes/provenance';
import { saleRoutes } from './routes/sales';
import { json, options } from './routes/stub';

const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('PORT must be an integer between 0 and 65535');
}

const server = Bun.serve({
  hostname: process.env.HOST ?? '0.0.0.0',
  port,
  routes: {
    '/v1/health': {
      GET: () => {
        try {
          db.query('SELECT 1 AS ok').get();
          return json({ ok: true, db: 'up', backends: { decision: 'stub' } });
        } catch {
          return json({ ok: false, db: 'down', backends: { decision: 'stub' } }, 503);
        }
      },
      OPTIONS: options,
    },
    ...observationRoutes,
    ...decisionRoutes,
    ...lotRoutes,
    ...listingRoutes,
    ...bidRoutes,
    ...saleRoutes,
    ...provenanceRoutes,
    ...auditRoutes,
    ...orgRoutes,
  },
  fetch: () => json({ error: 'not_found' }, 404),
});

console.log(`ReelDeal API listening on ${server.url}`);
