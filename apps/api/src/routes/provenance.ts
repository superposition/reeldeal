import { timingSafeEqual } from 'node:crypto';
import { db } from '../db';
import { CastChainGateway, loadChainConfig } from '../chain/provenance';
import { LotNotFound, ProvenanceService } from '../chain/provenance-service';
import { json, options } from './stub';

function lotIdFrom(request: Request): string | null {
  const parts = new URL(request.url).pathname.split('/');
  const lotId = parts[3];
  if (!lotId || lotId.length > 300) return null;
  try {
    const decoded = decodeURIComponent(lotId);
    return decoded && decoded.length <= 100 ? decoded : null;
  } catch {
    return null;
  }
}

function operatorAuthorized(request: Request, token: string): boolean {
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const expectedBytes = Buffer.from(token);
  const actualBytes = Buffer.from(provided);
  return expectedBytes.length === actualBytes.length
    && timingSafeEqual(expectedBytes, actualBytes);
}

export function makeProvenanceRoutes(service: ProvenanceService, operatorToken: string | null) {
  return {
    '/v1/provenance/:lot_id/anchor': {
      POST: async (request: Request) => {
        if (!operatorToken) return json({ error: 'anchor_disabled' }, 503);
        if (!operatorAuthorized(request, operatorToken)) return json({ error: 'operator_required' }, 401);
        const lotId = lotIdFrom(request);
        if (!lotId) return json({ error: 'invalid_lot_id' }, 400);
        try {
          return json(await service.anchor(lotId), 202);
        } catch (error) {
          if (error instanceof LotNotFound) return json({ error: 'lot_not_found' }, 404);
          return json({ error: 'anchor_request_failed' }, 500);
        }
      },
      OPTIONS: options,
    },
    '/v1/provenance/:lot_id': {
      GET: async (request: Request) => {
        const lotId = lotIdFrom(request);
        if (!lotId) return json({ error: 'invalid_lot_id' }, 400);
        try {
          return json(await service.get(lotId));
        } catch (error) {
          if (error instanceof LotNotFound) return json({ error: 'lot_not_found' }, 404);
          return json({ error: 'provenance_lookup_failed' }, 500);
        }
      },
      OPTIONS: options,
    },
  };
}

export const provenanceRoutes = makeProvenanceRoutes(
  new ProvenanceService(db, new CastChainGateway(loadChainConfig())),
  process.env.REELDEAL_ANCHOR_REQUEST_TOKEN ?? null,
);
