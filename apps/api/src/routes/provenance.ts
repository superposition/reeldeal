import { options, pending } from './stub';

export const provenanceRoutes = {
  '/v1/provenance/:lot_id/anchor': {
    POST: () => pending('POST /v1/provenance/:lot_id/anchor'),
    OPTIONS: options,
  },
  '/v1/provenance/:lot_id': {
    GET: () => pending('GET /v1/provenance/:lot_id'),
    OPTIONS: options,
  },
};
