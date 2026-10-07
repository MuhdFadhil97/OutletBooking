import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
import { trackLastSync } from './network';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    // Offline, a change fails at once with "can't reach the server" instead of waiting silently
    // in a queue (D9: changes are turned off while offline).
    mutations: { networkMode: 'always' },
  },
});

trackLastSync(queryClient);
