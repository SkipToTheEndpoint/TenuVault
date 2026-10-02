import { QueryClient } from "@tanstack/react-query"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Stale time of 30 seconds
      staleTime: 30 * 1000,
      // Cache time of 5 minutes
      gcTime: 5 * 60 * 1000,
      // Retry failed requests up to 3 times
      retry: 3,
      // Retry delay increases exponentially
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      // Refetch on window focus
      refetchOnWindowFocus: false,
    },
  },
})