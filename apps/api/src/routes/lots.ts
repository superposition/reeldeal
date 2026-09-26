import { options, pending } from './stub';

export const lotRoutes = {
  '/v1/lots': {
    POST: () => pending('POST /v1/lots'),
    OPTIONS: options,
  },
  '/v1/lots/:id': {
    GET: () => pending('GET /v1/lots/:id'),
    OPTIONS: options,
  },
  '/v1/lots/:id/review': {
    POST: () => pending('POST /v1/lots/:id/review'),
    OPTIONS: options,
  },
  '/v1/lots/:id/publish': {
    POST: () => pending('POST /v1/lots/:id/publish'),
    OPTIONS: options,
  },
};
