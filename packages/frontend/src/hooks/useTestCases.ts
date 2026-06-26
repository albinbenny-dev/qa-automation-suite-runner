import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { TestCase } from '../types';

interface TestCasesResponse {
  testCases: TestCase[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

interface GenerateInput {
  type: string;
  content: string;
  label: string;
}

interface SeedTCPayload {
  title: string;
  steps: string[];
  expectedResult: string;
  useCaseTag?: string;
  description?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  type?: 'UI' | 'API' | 'SIT';
  preConditions?: string;
  testData?: string;
  notes?: string;
}

interface GenerateRequest {
  inputs: GenerateInput[];
  testTypes: ('UI' | 'API' | 'SIT')[];
  additionalContext?: string;
  seedTestCases?: SeedTCPayload[];
}

interface GenerateResponse {
  testCases: Omit<TestCase, 'id' | 'projectId' | 'tcId' | 'status'>[];
  duplicatesRemoved: number;
}

export function useTestCases(
  projectId: string | undefined,
  params?: {
    type?: string;
    status?: string;
    useCaseTag?: string;
    search?: string;
    page?: number;
    limit?: number;
  },
) {
  return useQuery({
    queryKey: ['test-cases', projectId, params],
    queryFn: async () => {
      const res = await api.get<TestCasesResponse>(`/projects/${projectId}/test-cases`, {
        params,
      });
      return res.data;
    },
    enabled: !!projectId,
  });
}

export function useUseCases(projectId: string | undefined) {
  return useQuery({
    queryKey: ['use-cases', projectId],
    queryFn: async () => {
      const res = await api.get<{ useCases: string[] }>(`/projects/${projectId}/test-cases/use-cases`);
      return res.data.useCases;
    },
    enabled: !!projectId,
  });
}

export function useGenerateTestCases(projectId: string) {
  return useMutation({
    mutationFn: async (req: GenerateRequest) => {
      const res = await api.post<GenerateResponse>(
        `/projects/${projectId}/test-cases/generate`,
        req,
        { timeout: 120_000 },
      );
      return res.data;
    },
  });
}

export function useParseSeedFile(projectId: string) {
  return useMutation({
    mutationFn: async (filePath: string) => {
      const res = await api.post<{ seedTCs: SeedTCPayload[] }>(
        `/projects/${projectId}/test-cases/parse-seed`,
        { filePath },
      );
      return res.data.seedTCs;
    },
  });
}

export function useSaveTestCases(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (testCases: Omit<TestCase, 'id' | 'projectId' | 'tcId'>[]) => {
      const res = await api.post<{ testCases: TestCase[]; count: number }>(
        `/projects/${projectId}/test-cases`,
        { testCases },
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['test-cases', projectId] });
      qc.invalidateQueries({ queryKey: ['use-cases', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      // Invalidate scripts so auto-saved scriptContent appears in Scripts page immediately
      qc.invalidateQueries({ queryKey: ['scripts', projectId] });
    },
  });
}

export function useUpdateTestCase(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tcId, data }: { tcId: string; data: Partial<TestCase> }) => {
      const res = await api.put<{ testCase: TestCase }>(
        `/projects/${projectId}/test-cases/${tcId}`,
        data,
      );
      return res.data.testCase;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['test-cases', projectId] });
    },
  });
}

export function useDeleteTestCase(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tcId: string) => {
      await api.delete(`/projects/${projectId}/test-cases/${tcId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['test-cases', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useBulkApprove(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await api.post<{ updated: number }>(
        `/projects/${projectId}/test-cases/bulk-approve`,
        { ids },
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['test-cases', projectId] });
    },
  });
}

export interface TCLibraryStats {
  totalTCs: number;
  useCaseCount: number;
  passedLast: number;
  failedLast: number;
  neverRun: number;
}

export function useTCLibraryStats(projectId: string | undefined) {
  return useQuery({
    queryKey: ['tc-library-stats', projectId],
    queryFn: async () => {
      const res = await api.get<TCLibraryStats>(`/projects/${projectId}/test-cases/stats`);
      return res.data;
    },
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
}

export function useBulkUpdateUseCase(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      testCaseIds,
      targetUseCaseTag,
    }: {
      testCaseIds: string[];
      targetUseCaseTag: string;
    }) => {
      const res = await api.post<{ updated: number }>(
        `/projects/${projectId}/test-cases/bulk-update-usecase`,
        { testCaseIds, targetUseCaseTag },
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['test-cases', projectId] });
      qc.invalidateQueries({ queryKey: ['use-cases', projectId] });
      qc.invalidateQueries({ queryKey: ['tc-library-stats', projectId] });
    },
  });
}

export function useBulkDelete(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await api.post<{ deleted: number }>(
        `/projects/${projectId}/test-cases/bulk-delete`,
        { ids },
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['test-cases', projectId] });
      qc.invalidateQueries({ queryKey: ['use-cases', projectId] });
      qc.invalidateQueries({ queryKey: ['tc-library-stats', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useBulkAddTag(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ testCaseIds, tag }: { testCaseIds: string[]; tag: string }) => {
      const res = await api.post<{ updated: number }>(
        `/projects/${projectId}/test-cases/bulk-add-tag`,
        { testCaseIds, tag },
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['test-cases', projectId] });
    },
  });
}

// ── Agentic Browser Trace ──────────────────────────────────────────────────

export interface AgentTraceRequest {
  targetUrl: string;
  menuContext: string;
  username?: string;
  password?: string;
  additionalContext?: string;
  seedSteps?: string[];
  testTypes?: ('UI' | 'API' | 'SIT')[];
  envConfigId?: string;
}

export function useStartAgentTrace(projectId: string) {
  return useMutation({
    mutationFn: async (req: AgentTraceRequest) => {
      const res = await api.post<{ agentTraceId: string }>(
        `/projects/${projectId}/test-cases/agent-trace`,
        req,
        { timeout: 15_000 },
      );
      return res.data;
    },
  });
}

export function useDuplicateTestCase(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tc: TestCase) => {
      const { title, steps, expectedResult, type, tags, useCaseTag, description, priority, generationHints, prerequisiteTcId } = tc;
      const res = await api.post<{ testCases: TestCase[]; count: number }>(
        `/projects/${projectId}/test-cases`,
        {
          testCases: [{
            title: `${title} (Copy)`,
            steps,
            expectedResult,
            type,
            tags,
            useCaseTag,
            description,
            priority,
            generationHints,
            prerequisiteTcId,
            status: 'DRAFT',
          }],
        },
      );
      return res.data.testCases[0];
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['test-cases', projectId] });
      qc.invalidateQueries({ queryKey: ['use-cases', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useUploadFile() {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post<{ filePath: string; filename: string; mimeType: string; size: number }>(
        '/upload',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return res.data;
    },
  });
}
