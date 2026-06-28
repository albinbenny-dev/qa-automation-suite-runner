import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export interface TcItem {
  id: string;
  projectId: string;
  srNo: number | null;
  module: string | null;
  feature: string | null;
  title: string;
  description: string | null;
  steps: string | null;
  expectedResult: string | null;
  linkedScriptId: string | null;
  linkedScript: { id: string; tcId: string; title: string; useCaseTag: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface TcItemStats {
  total: number;
  linked: number;
  unlinked: number;
}

const ITEMS_KEY = (pid: string) => ['tc-items', pid];
const STATS_KEY = (pid: string) => ['tc-items-stats', pid];

export function useTcItems(projectId: string | undefined) {
  return useQuery({
    queryKey: ITEMS_KEY(projectId ?? ''),
    queryFn: async () => {
      const res = await api.get<{ items: TcItem[] }>(`/projects/${projectId}/tc-items`);
      return res.data.items;
    },
    enabled: !!projectId,
  });
}

export function useTcItemStats(projectId: string | undefined) {
  return useQuery({
    queryKey: STATS_KEY(projectId ?? ''),
    queryFn: async () => {
      const res = await api.get<TcItemStats>(`/projects/${projectId}/tc-items/stats`);
      return res.data;
    },
    enabled: !!projectId,
  });
}

export function useImportTcItems(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post<{ imported: number }>(`/projects/${projectId}/tc-items/import`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY(projectId ?? '') });
      qc.invalidateQueries({ queryKey: STATS_KEY(projectId ?? '') });
    },
  });
}

export function useUpdateTcItem(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<TcItem> & { linkedScriptId?: string | null } }) => {
      const res = await api.patch<{ item: TcItem }>(`/projects/${projectId}/tc-items/${id}`, patch);
      return res.data.item;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY(projectId ?? '') });
      qc.invalidateQueries({ queryKey: STATS_KEY(projectId ?? '') });
    },
  });
}

export function useDeleteTcItem(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/projects/${projectId}/tc-items/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY(projectId ?? '') });
      qc.invalidateQueries({ queryKey: STATS_KEY(projectId ?? '') });
    },
  });
}

export function useBulkDeleteTcItems(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      await api.post(`/projects/${projectId}/tc-items/bulk-delete`, { ids });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY(projectId ?? '') });
      qc.invalidateQueries({ queryKey: STATS_KEY(projectId ?? '') });
    },
  });
}

export function useBulkLinkTcItems(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, testCaseId }: { ids: string[]; testCaseId: string | null }) => {
      await api.post(`/projects/${projectId}/tc-items/bulk-link-script`, { ids, testCaseId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY(projectId ?? '') });
      qc.invalidateQueries({ queryKey: STATS_KEY(projectId ?? '') });
    },
  });
}

export function useBulkMoveTcItems(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, feature }: { ids: string[]; feature: string }) => {
      await api.post(`/projects/${projectId}/tc-items/bulk-move-feature`, { ids, feature });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY(projectId ?? '') });
    },
  });
}
