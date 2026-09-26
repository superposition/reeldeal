import type { Database } from 'bun:sqlite';
import { db } from '../db';
import { getLot, postLot, postPublish } from './lot-service';
import { getLotReview, postLotReview } from './review';
import { options } from './stub';

type ParamRequest = Request & { params: { id: string } };

export function makeLotRoutes(database: Database) {
  return {
    '/v1/lots': { POST: (request: Request) => postLot(database, request), OPTIONS: options },
    '/v1/lots/:id': { GET: (request: ParamRequest) => getLot(database, request.params.id), OPTIONS: options },
    '/v1/lots/:id/review': {
      GET: (request: ParamRequest) => getLotReview(database, request.params.id),
      POST: (request: ParamRequest) => postLotReview(database, request.params.id, request),
      OPTIONS: options,
    },
    '/v1/lots/:id/publish': { POST: (request: ParamRequest) => postPublish(database, request.params.id), OPTIONS: options },
  };
}

export const lotRoutes = makeLotRoutes(db);
