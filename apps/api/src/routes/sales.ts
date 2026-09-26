import { options, pending } from './stub';

export const saleRoutes = {
  '/v1/listings/:id/accept': {
    POST: () => pending('POST /v1/listings/:id/accept'),
    OPTIONS: options,
  },
  '/v1/sales/:id/pay': {
    POST: () => pending('POST /v1/sales/:id/pay'),
    OPTIONS: options,
  },
};
