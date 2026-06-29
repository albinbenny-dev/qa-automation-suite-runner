import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Run, RunResult, Schedule } from '../types';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RunListItem extends Omit<Run, 'results'> {
  results?: Pick<RunResult, 'status'>[];
  _count: { results: number };
}

export interface RunDetails extends Run {
  results: (RunResult & {
    testCase: {
      id: string;
      tcId: string;
      title: string;
      type: string;
      useCaseTag?: string | null;
    };
  })[];
}

export interface CreateRunPayload {
  testCaseIds: string[];
  environment: string;
  parallelWorkers?: number;
  headless?: boolean;
  browser?: 'chromium' | 'firefox' | 'webkit' | 'chrome';
  name?: string;
  record?: boolean;
}

export interface CreateGroupRunPayload {
  useCaseTag: string;
  environment: string;
  parallelWorkers?: number;
  headless?: boolean;
  browser?: 'chromium' | 'firefox' | 'webkit' | 'chrome';
  record?: boolean;
}

// ── Hooks ──────────────────────────────────────────────────────────────────

export function useRuns(projectId: string | undefined, page = 1) {
  return useQuery({
    queryKey: ['runs', projectId, page],
    queryFn: async () => {
      const res = await api.get<{
        runs: RunListItem[];
        total: number;
        pages: number;
      }>(`/projects/${projectId}/runs?page=${page}&limit=20`);
      return res.data;
    },
    enabled: !!projectId,
    refetchInterval: (query) => {
      const runs = query.state.data?.runs ?? [];
      const hasActive = runs.some(r => r.status === 'PENDING' || r.status === 'RUNNING');
      return hasActive ? 1500 : 2000;
    },
  });
}

export function useRun(projectId: string | undefined, runId: string | null) {
  return useQuery({
    queryKey: ['run', projectId, runId],
    queryFn: async () => {
      const res = await api.get<{ run: RunDetails }>(`/projects/${projectId}/runs/${runId}`);
      return res.data.run;
    },
    enabled: !!projectId && !!runId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'RUNNING' || status === 'PENDING' ? 2000 : false;
    },
  });
}

export function useCreateRun(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateRunPayload) => {
      const res = await api.post<{ run: Run }>(`/projects/${projectId}/runs`, payload);
      return res.data.run;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['runs', projectId] });
    },
  });
}

export function useCreateIndividualRun(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      testCaseId,
      environment,
      browser,
      headless,
      hostBrowser,
    }: {
      testCaseId: string;
      environment: string;
      browser?: string;
      headless?: boolean;
      hostBrowser?: boolean;
    }) => {
      const res = await api.post<{ run: Run }>(
        `/projects/${projectId}/runs/individual/${testCaseId}`,
        { environment, browser, headless, hostBrowser },
      );
      return res.data.run;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['runs', projectId] });
    },
  });
}

export function useCreateGroupRun(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateGroupRunPayload) => {
      const res = await api.post<{ run: Run }>(`/projects/${projectId}/runs/group`, payload);
      return res.data.run;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['runs', projectId] });
    },
  });
}

export function useCancelRun(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      await api.post(`/projects/${projectId}/runs/${runId}/cancel`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['runs', projectId] });
    },
  });
}

export function useRetryRun(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const res = await api.post<{ run: Run }>(`/projects/${projectId}/runs/${runId}/retry`);
      return res.data.run;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['runs', projectId] });
    },
  });
}

// ── Schedule hooks ─────────────────────────────────────────────────────────

export function useSchedules(projectId: string | undefined) {
  return useQuery({
    queryKey: ['schedules', projectId],
    queryFn: async () => {
      const res = await api.get<{ schedules: Schedule[] }>(`/projects/${projectId}/runs/schedules`);
      return res.data.schedules;
    },
    enabled: !!projectId,
  });
}

export function useCreateSchedule(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      name: string;
      cronExpression: string;
      testCaseIds: string[];
      environment: string;
      isActive?: boolean;
      record?: boolean;
      emailRecipients?: string[];
    }) => {
      const res = await api.post<{ schedule: Schedule }>(`/projects/${projectId}/runs/schedules`, data);
      return res.data.schedule;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['schedules', projectId] });
    },
  });
}

export interface UpdateSchedulePayload {
  id: string;
  name?: string;
  cronExpression?: string;
  testCaseIds?: string[];
  environment?: string;
  isActive?: boolean;
  record?: boolean;
  emailRecipients?: string[];
}

export function useUpdateSchedule(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateSchedulePayload) => {
      const res = await api.put<{ schedule: Schedule }>(`/projects/${projectId}/runs/schedules/${id}`, data);
      return res.data.schedule;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['schedules', projectId] });
    },
  });
}

export function useRunNow(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (scheduleId: string) => {
      const res = await api.post<{ run: Run }>(`/projects/${projectId}/runs/schedules/${scheduleId}/run-now`);
      return res.data.run;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['runs', projectId] });
    },
  });
}

export function useDeleteSchedule(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/projects/${projectId}/runs/schedules/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['schedules', projectId] });
    },
  });
}
