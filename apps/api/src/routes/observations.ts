import { options, pending } from './stub';

export const observationRoutes = {
  '/v1/observations': {
    POST: () => pending('POST /v1/observations'),
    OPTIONS: options,
  },
  '/v1/scans/:id/corrections': {
    POST: () => pending('POST /v1/scans/:id/corrections'),
    OPTIONS: options,
  },
};
