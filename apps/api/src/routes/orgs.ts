import { options, pending } from './stub';

export const orgRoutes = {
  '/v1/orgs': {
    POST: () => pending('POST /v1/orgs'),
    OPTIONS: options,
  },
  '/v1/orgs/:slug': {
    GET: () => pending('GET /v1/orgs/:slug'),
    OPTIONS: options,
  },
};
