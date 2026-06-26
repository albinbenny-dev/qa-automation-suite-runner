import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useTriggerHeal(projectId: string, onNoFailed?: () => void) {
  return useMutation({
    mutationFn: async ({ runId }: { runId: string }) => {
      const res = await api.post<{ count: number }>(`/projects/${projectId}/runs/${runId}/heal`);
      if (res.data.count === 0) onNoFailed?.();
      return res.data;
    },
  });
}
