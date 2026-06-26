import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ProjectResource } from '../types';

// ── Create folder ──────────────────────────────────────────────────────────

export function useCreateFolder(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (folderPath: string) => {
      await api.post(`/projects/${projectId}/resources/mkdir`, { path: folderPath });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources', projectId] });
    },
  });
}

// ── List resources ─────────────────────────────────────────────────────────

export function useResources(projectId: string | undefined) {
  return useQuery({
    queryKey: ['resources', projectId],
    queryFn: async () => {
      const res = await api.get<ProjectResource[]>(`/projects/${projectId}/resources`);
      return res.data;
    },
    enabled: !!projectId,
  });
}

// ── Upload resource file ───────────────────────────────────────────────────

export function useUploadResource(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, folder }: { file: File; folder?: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      if (folder) formData.append('folder', folder);
      const res = await api.post<ProjectResource>(
        `/projects/${projectId}/resources`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources', projectId] });
    },
  });
}

// ── Read resource file content ─────────────────────────────────────────────

export function useResourceContent(projectId: string | undefined, filename: string | null) {
  return useQuery({
    queryKey: ['resources', projectId, filename, 'content'],
    queryFn: async () => {
      const res = await api.get<{ content: string }>(
        `/projects/${projectId}/resources/${filename}/content`,
      );
      return res.data.content;
    },
    enabled: !!projectId && !!filename,
  });
}

// ── Save resource file content ─────────────────────────────────────────────

export function useSaveResource(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ filename, content }: { filename: string; content: string }) => {
      await api.put(
        `/projects/${projectId}/resources/${filename}/content`,
        { content },
      );
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['resources', projectId, vars.filename, 'content'] });
      qc.invalidateQueries({ queryKey: ['resources', projectId] });
    },
  });
}

// ── Delete resource file ───────────────────────────────────────────────────

export function useDeleteResource(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (filename: string) => {
      await api.delete(`/projects/${projectId}/resources/${filename}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources', projectId] });
    },
  });
}

// ── Delete folder ─────────────────────────────────────────────────────────

export function useDeleteFolder(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (folderPath: string) => {
      await api.post(`/projects/${projectId}/resources/rmdir`, { path: folderPath });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources', projectId] });
    },
  });
}

// ── Move resource file ─────────────────────────────────────────────────────

export function useMoveResource(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ filename, destination }: { filename: string; destination: string }) => {
      const res = await api.post<{ filename: string; containerPath: string }>(
        `/projects/${projectId}/resources/move`,
        { filename, destination },
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources', projectId] });
    },
  });
}

// ── Download binary resource file ──────────────────────────────────────────

export function downloadResource(projectId: string, filename: string): void {
  api
    .get(`/projects/${projectId}/resources/${filename}/download`, { responseType: 'blob' })
    .then((res) => {
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.split('/').pop() ?? filename;
      a.click();
      URL.revokeObjectURL(url);
    })
    .catch(() => {
      // silent — caller shows toast
    });
}
