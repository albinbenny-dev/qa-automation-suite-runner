import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  DashboardData,
  RunTrendPoint,
  ProjectStats,
  EmailConfig,
  ReportRun,
} from '../types';

// ── Dashboard ──────────────────────────────────────────────────────────────

export function useDashboard(projectId: string | undefined) {
  return useQuery({
    queryKey: ['dashboard', projectId],
    queryFn: async () => {
      const res = await api.get<DashboardData>(`/projects/${projectId}/reports/dashboard`);
      return res.data;
    },
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
}

// ── Run trend ──────────────────────────────────────────────────────────────

export function useRunTrend(projectId: string | undefined, days: number) {
  return useQuery({
    queryKey: ['run-trend', projectId, days],
    queryFn: async () => {
      const res = await api.get<{ trend: RunTrendPoint[] }>(
        `/projects/${projectId}/reports/trend?days=${days}`,
      );
      return res.data.trend;
    },
    enabled: !!projectId,
    refetchInterval: 60_000,
  });
}

// ── Project stats ──────────────────────────────────────────────────────────

export function useProjectStats(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-stats', projectId],
    queryFn: async () => {
      const res = await api.get<{ stats: ProjectStats }>(`/projects/${projectId}/reports/stats`);
      return res.data.stats;
    },
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
}

// ── Run list (reports) ─────────────────────────────────────────────────────

export function useReportRuns(projectId: string | undefined, page = 1) {
  return useQuery({
    queryKey: ['report-runs', projectId, page],
    queryFn: async () => {
      const res = await api.get<{
        runs: ReportRun[];
        total: number;
        pages: number;
      }>(`/projects/${projectId}/reports/runs?page=${page}&limit=20`);
      return res.data;
    },
    enabled: !!projectId,
    refetchInterval: 15_000,
  });
}

// ── Single run with report ─────────────────────────────────────────────────

export function useReportRun(projectId: string | undefined, runId: string | null) {
  return useQuery({
    queryKey: ['report-run', projectId, runId],
    queryFn: async () => {
      const res = await api.get<{ run: ReportRun }>(`/projects/${projectId}/reports/runs/${runId}`);
      return res.data.run;
    },
    enabled: !!projectId && !!runId,
  });
}

// ── Generate report ────────────────────────────────────────────────────────

export function useGenerateReport(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      api
        .post<{ report: unknown }>(`/projects/${projectId}/reports/runs/${runId}/generate`)
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['report-runs', projectId] });
    },
  });
}

// ── Email config ───────────────────────────────────────────────────────────

export function useEmailConfig(projectId: string | undefined) {
  return useQuery({
    queryKey: ['email-config', projectId],
    queryFn: async () => {
      const res = await api.get<{ config: EmailConfig }>(
        `/projects/${projectId}/reports/email-config`,
      );
      return res.data.config;
    },
    enabled: !!projectId,
  });
}

export function useSaveEmailConfig(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: EmailConfig) =>
      api
        .put<{ config: EmailConfig }>(`/projects/${projectId}/reports/email-config`, config)
        .then((r) => r.data.config),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['email-config', projectId] });
    },
  });
}
