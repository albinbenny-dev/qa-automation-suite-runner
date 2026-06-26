import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useScans(projectId: string) {
  return useQuery({ queryKey: ['scans', projectId], queryFn: async () => [] as unknown[], enabled: false });
}

export function useScan(scanId: string) {
  return useQuery({ queryKey: ['scan', scanId], queryFn: async () => null, enabled: false });
}

export function useProjectContext(projectId: string) {
  return useQuery({ queryKey: ['project-context', projectId], queryFn: async () => null as unknown, enabled: !!projectId });
}

export function useStartScan(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: unknown) => {
      const res = await api.post<{ scanId: string }>(`/projects/${projectId}/scans`, body);
      void qc.invalidateQueries({ queryKey: ['scans', projectId] });
      return res.data;
    },
  });
}

export function useUpdateContext(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: unknown) => {
      const res = await api.patch(`/projects/${projectId}/context`, body);
      void qc.invalidateQueries({ queryKey: ['project-context', projectId] });
      return res.data;
    },
  });
}

export function useUpdateLoginInstructions(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: unknown) => {
      const res = await api.patch(`/projects/${projectId}/context/login`, body);
      void qc.invalidateQueries({ queryKey: ['project-context', projectId] });
      return res.data;
    },
  });
}

export function useDeleteScan(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (scanId: string) => {
      await api.delete(`/projects/${projectId}/scans/${scanId}`);
      void qc.invalidateQueries({ queryKey: ['scans', projectId] });
    },
  });
}

export function useQuickLoginTest(projectId: string) {
  return useMutation({
    mutationFn: async (envConfigId: string) => {
      const res = await api.post<{ success: boolean; errorMessage?: string; screenshotBase64?: string }>(
        `/projects/${projectId}/scans/test-login`,
        { envConfigId },
      );
      return res.data;
    },
  });
}
