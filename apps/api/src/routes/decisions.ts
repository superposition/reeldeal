import { options, pending } from './stub';

export const decisionRoutes = {
  '/v1/decisions': {
    POST: () => pending('POST /v1/decisions'),
    OPTIONS: options,
  },
};
