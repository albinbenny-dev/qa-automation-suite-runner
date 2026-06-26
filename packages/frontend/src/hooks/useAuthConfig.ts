import { useQuery } from '@tanstack/react-query';

export function useAuthConfig() {
  return useQuery({
    queryKey: ['auth-config'],
    queryFn: async () => ({ googleEnabled: false }),
    staleTime: Infinity,
  });
}
