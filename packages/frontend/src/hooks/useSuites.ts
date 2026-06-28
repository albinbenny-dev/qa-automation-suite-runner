import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Suite, SuiteStage } from '../types';

// ── Hooks ──────────────────────────────────────────────────────────────────

export function useSuites(projectId: string | undefined) {
  return useQuery({
    queryKey: ['suites', projectId],
    queryFn: async () => {
      const res = await api.get<{ suites: Suite[] }>(`/projects/${projectId}/suites`);
      return res.data.suites ?? [];
    },
    enabled: !!projectId,
  });
}

export function useCreateSuite(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; stages: SuiteStage[] }) => {
      const res = await api.post<{ suite: Suite }>(`/projects/${projectId}/suites`, data);
      return res.data.suite;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suites', projectId] }),
  });
}

export function useUpdateSuite(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { id: string; name?: string; stages?: SuiteStage[] }) => {
      const { id, ...body } = data;
      const res = await api.put<{ suite: Suite }>(`/projects/${projectId}/suites/${id}`, body);
      return res.data.suite;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suites', projectId] }),
  });
}

export function useDeleteSuite(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (suiteId: string) => {
      await api.delete(`/projects/${projectId}/suites/${suiteId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suites', projectId] }),
  });
}

export function useRunSuite(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { suiteId: string; environment: string; name?: string; parallelWorkers?: number; record?: boolean }) => {
      const { suiteId, ...body } = data;
      const workers = body.parallelWorkers ?? parseInt(localStorage.getItem('qa:parallelWorkers') ?? '2', 10);
      const res = await api.post<{ run: { id: string; runSeq: number } }>(
        `/projects/${projectId}/suites/${suiteId}/run`,
        { ...body, parallelWorkers: workers, headless: false, browser: 'chrome' },
      );
      return res.data.run;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['runs', projectId] });
    },
  });
}
