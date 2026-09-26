import type { Database } from 'bun:sqlite';
import { db } from '../db';
import { postAccept, postPay } from './sale-service';
import { options } from './stub';

type ParamRequest = Request & { params: { id: string } };

export function makeSaleRoutes(database: Database, sellerToken = process.env.REELDEAL_SELLER_TOKEN ?? null) {
  // A second API process must wait for the first immediate writer, then re-read its winner.
  database.exec('PRAGMA busy_timeout = 5000');
  return {
    '/v1/listings/:id/accept': {
      POST: (request: ParamRequest) => postAccept(database, request.params.id, request, sellerToken),
      OPTIONS: options,
    },
    '/v1/sales/:id/pay': {
      POST: (request: ParamRequest) => postPay(database, request.params.id, request, sellerToken),
      OPTIONS: options,
    },
  };
}

export const saleRoutes = makeSaleRoutes(db);
