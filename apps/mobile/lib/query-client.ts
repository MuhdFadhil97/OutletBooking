import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
import { setupNetwork } from './network';

setupNetwork();

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    // D9: offline is read-only. Changes fail straight away with "can't reach the server"
    // instead of being queued and sent later without the user seeing them.
    mutations: { networkMode: 'always' },
  },
});
