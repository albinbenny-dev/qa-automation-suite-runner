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
    mutationFn: async ({ file, testCaseId }: { file: File; testCaseId?: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      if (testCaseId) formData.append('testCaseId', testCaseId);
      const res = await api.post<Script & { converted?: boolean }>(
        `/projects/${projectId}/scripts/upload`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scripts', projectId] });
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
