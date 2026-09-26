import { options, pending } from './stub';

export const bidRoutes = {
  '/v1/listings/:id/bids': {
    POST: () => pending('POST /v1/listings/:id/bids'),
    OPTIONS: options,
  },
};
