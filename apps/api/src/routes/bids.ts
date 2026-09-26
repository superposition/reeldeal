import type { Database } from 'bun:sqlite';
import { bidDomain } from '@reeldeal/domain';
import { db } from '../db';
import { postBid } from './bid-service';
import { options } from './stub';

type ParamRequest = Request & { params: { id: string } };

export function makeBidRoutes(database: Database, chainId = Number(process.env.REELDEAL_CHAIN_ID ?? '1')) {
  bidDomain(chainId);
  return {
    '/v1/listings/:id/bids': {
      POST: (request: ParamRequest) => postBid(database, request.params.id, request, chainId),
      OPTIONS: options,
    },
  };
}

export const bidRoutes = makeBidRoutes(db);
