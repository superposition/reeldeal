import { options, pending } from './stub';

export const auditRoutes = {
  '/v1/audit': {
    GET: () => pending('GET /v1/audit'),
    OPTIONS: options,
  },
  '/v1/metrics': {
    GET: () => pending('GET /v1/metrics'),
    OPTIONS: options,
  },
};
