import { options, pending } from './stub';

export const listingRoutes = {
  '/v1/listings': {
    GET: () => pending('GET /v1/listings'),
    OPTIONS: options,
  },
};
