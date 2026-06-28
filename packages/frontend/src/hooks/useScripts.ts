import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Script } from '../types';

interface ScriptsResponse {
  scripts: Script[];
}

interface GenerateResponse {
  created: Array<{ id: string; filename: string; testCaseId: string; tcId: string; title: string }>;
  errors: Array<{ testCaseId: string; error: string }>;
}

export function useScripts(projectId: string | undefined) {
  return useQuery({
    queryKey: ['scripts', projectId],
    queryFn: async () => {
      const res = await api.get<ScriptsResponse>(`/projects/${projectId}/scripts`);
      return res.data.scripts;
    },
    enabled: !!projectId,
  });
}

export function useGenerateScripts(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ testCaseIds, scriptMode = 'ROBOT' }: { testCaseIds: string[]; scriptMode?: 'PLAYWRIGHT' | 'ROBOT' }) => {
      const res = await api.post<GenerateResponse>(
        `/projects/${projectId}/scripts/generate`,
        { testCaseIds, scriptMode },
        { timeout: 180_000 },
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scripts', projectId] });
    },
  });
}

export function useSaveScriptContent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ scriptId, content }: { scriptId: string; content: string }) => {
      await api.put(`/projects/${projectId}/scripts/${scriptId}/content`, { content });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scripts', projectId] });
    },
  });
}

export function useDeleteScript(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (scriptId: string) => {
      await api.delete(`/projects/${projectId}/scripts/${scriptId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scripts', projectId] });
    },
  });
}

export function useUploadScript(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, testCaseId, tcItemId, autoCreateTCs }: { file: File; testCaseId?: string; tcItemId?: string; autoCreateTCs?: boolean }) => {
      const formData = new FormData();
      formData.append('file', file);
      if (testCaseId) formData.append('testCaseId', testCaseId);
      if (tcItemId) formData.append('tcItemId', tcItemId);
      if (autoCreateTCs) formData.append('autoCreateTCs', 'true');
      const res = await api.post<Script & { converted?: boolean; tcCreated?: number }>(
        `/projects/${projectId}/scripts/upload`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scripts', projectId] });
      qc.invalidateQueries({ queryKey: ['tc-items', projectId] });
      qc.invalidateQueries({ queryKey: ['tc-items-stats', projectId] });
    },
  });
}

export interface UploadWithExtractResult {
  testCase: {
    id: string;
    tcId: string;
    title: string;
    status: string;
    type: string;
    useCaseTag: string | null;
  };
  script: {
    id: string;
    filename: string;
    testCaseId: string;
  };
}

export function useUploadScriptWithExtract(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post<UploadWithExtractResult & { converted?: boolean }>(
        `/projects/${projectId}/scripts/upload-with-extract`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60_000 },
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scripts', projectId] });
      qc.invalidateQueries({ queryKey: ['test-cases', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function scriptExportUrl(projectId: string, ids?: string[]): string {
  const base = `/api/projects/${projectId}/scripts/export/zip`;
  if (ids?.length) return `${base}?ids=${ids.join(',')}`;
  return base;
}

export interface ImportRobotResult {
  id: string;
  filename: string;
  scriptType: 'ROBOT';
  converted: boolean;
  originalLibrary: 'SeleniumLibrary' | 'Browser';
  testCaseId: string | null;
  createdAt: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileTreeNode[];
  ext?: string;
}

export function useProjectFileTree(projectId: string | undefined) {
  return useQuery({
    queryKey: ['file-tree', projectId],
    queryFn: async () => {
      const res = await api.get<{ tree: FileTreeNode[]; root: string }>(
        `/projects/${projectId}/scripts/file-tree`,
      );
      return res.data;
    },
    enabled: !!projectId,
    staleTime: 10_000,
  });
}

export function useDeleteProjectFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (relPath: string) => {
      await api.delete(`/projects/${projectId}/scripts/project-file`, { params: { path: relPath } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['file-tree', projectId] });
      qc.invalidateQueries({ queryKey: ['scripts', projectId] });
      qc.invalidateQueries({ queryKey: ['test-cases', projectId] });
      qc.invalidateQueries({ queryKey: ['tc-items', projectId] });
      qc.invalidateQueries({ queryKey: ['tc-items-stats', projectId] });
    },
  });
}

export function useMoveProjectFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ from, to }: { from: string; to: string }) => {
      await api.post(`/projects/${projectId}/scripts/project-file/move`, { from, to });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['file-tree', projectId] });
      qc.invalidateQueries({ queryKey: ['scripts', projectId] });
    },
  });
}

export function useUploadProjectFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, folder }: { file: File; folder?: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      if (folder) formData.append('folder', folder);
      const res = await api.post<{ path: string; filename: string; size: number }>(
        `/projects/${projectId}/scripts/project-file/upload`,
        formData,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['file-tree', projectId] });
    },
  });
}

export function downloadProjectFile(projectId: string, relPath: string): void {
  const url = `/api/projects/${projectId}/scripts/project-file/download?path=${encodeURIComponent(relPath)}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = relPath.split('/').pop() ?? relPath;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function useCreateProjectFolder(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (folder: string) => {
      await api.post(`/projects/${projectId}/scripts/project-file/mkdir`, { folder });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['file-tree', projectId] }),
  });
}

export function useImportRobotScript(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, testCaseId }: { file: File; testCaseId?: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      if (testCaseId) formData.append('testCaseId', testCaseId);
      const res = await api.post<ImportRobotResult>(
        `/projects/${projectId}/scripts/import-robot`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60_000 },
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scripts', projectId] });
    },
  });
}
