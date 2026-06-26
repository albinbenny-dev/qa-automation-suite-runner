import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { runReportsAgent } from '../agents/reportsAgent.js';
import { sendRunReport } from './emailService.js';

// ── Email config storage ───────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR ?? '/data';

export interface EmailConfig {
  recipients: string[];
  triggerEvents: string[]; // 'on_failure' | 'on_completion' | 'on_schedule'
}

async function configPath(projectId: string): Promise<string> {
  return path.join(DATA_DIR, `report-config-${projectId}.json`);
}

export async function getEmailConfig(projectId: string): Promise<EmailConfig> {
  try {
    const raw = await fs.readFile(await configPath(projectId), 'utf-8');
    return JSON.parse(raw) as EmailConfig;
  } catch {
    return { recipients: [], triggerEvents: ['on_failure'] };
  }
}

export async function saveEmailConfig(projectId: string, config: EmailConfig): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(await configPath(projectId), JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('[reportService] Failed to save email config:', err);
    throw err;
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface ProjectStats {
  totalTests: number;
  scriptsGenerated: number;
  totalRuns: number;
  lastRunPassCount: number;
  lastRunFailCount: number;
  avgPassRate: number;
  activeSchedules: number;
  pendingHeals: number;
  flakyTests: FlakyTest[];
}

export interface FlakyTest {
  id: string;
  tcId: string;
  title: string;
  passCount: number;
  failCount: number;
  recentResults: Array<'PASSED' | 'FAILED' | 'SKIPPED'>;
}

export interface RunTrendPoint {
  date: string;
  passed: number;
  failed: number;
  skipped: number;
}

export interface AgentStatus {
  name: string;
  label: string;
  status: 'ok' | 'busy' | 'idle';
  detail: string;
}

// ── generateReport ─────────────────────────────────────────────────────────

export async function generateReport(runId: string): Promise<void> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: {
      results: {
        include: {
          testCase: { select: { id: true, tcId: true, title: true, type: true } },
        },
      },
      project: { select: { id: true, name: true } },
    },
  });

  if (!run) throw new Error(`Run ${runId} not found`);

  // Skip if report already exists
  const existing = await prisma.report.findUnique({ where: { runId } });
  if (existing) return;

  type ResultRow = { status: string; errorMessage: string | null; testCase: { title: string } };
  const results = run.results as ResultRow[];
  const passed = results.filter((r) => r.status === 'PASSED').length;
  const failed = results.filter((r) => r.status === 'FAILED').length;
  const total = results.length;
  const duration =
    run.startedAt && run.completedAt
      ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
      : 0;

  const failedTests = results
    .filter((r) => r.status === 'FAILED')
    .map((r) => ({
      title: r.testCase.title,
      error: r.errorMessage ?? 'Unknown error',
    }));

  const analysis = await runReportsAgent({
    runSummary: { total, passed, failed, duration },
    failedTests,
  });

  const report = await prisma.report.upsert({
    where: { runId },
    create: {
      projectId: run.projectId,
      runId,
      summary: analysis.summary,
      aiAnalysis: JSON.stringify(analysis),
    },
    update: {
      summary: analysis.summary,
      aiAnalysis: JSON.stringify(analysis),
    },
  });

  // Send email if configured
  const emailConfig = await getEmailConfig(run.projectId);
  const shouldEmail =
    emailConfig.recipients.length > 0 &&
    (emailConfig.triggerEvents.includes('on_completion') ||
      (emailConfig.triggerEvents.includes('on_failure') && failed > 0));

  if (shouldEmail) {
    try {
      await sendRunReport({
        recipients: emailConfig.recipients,
        run,
        results: run.results,
        analysis,
        projectName: run.project.name,
      });
      await prisma.report.update({
        where: { id: report.id },
        data: { emailSentAt: new Date() },
      });
    } catch (err) {
      console.error('[reportService] Email send failed:', err);
    }
  }
}

// ── getProjectStats ────────────────────────────────────────────────────────

export async function getProjectStats(projectId: string): Promise<ProjectStats> {
  const [totalTests, scriptsGenerated, totalRuns, activeSchedules, pendingHeals, lastRun, allResults] =
    await Promise.all([
      prisma.testCase.count({ where: { projectId } }),
      prisma.script.count({ where: { projectId } }),
      prisma.run.count({ where: { projectId } }),
      prisma.schedule.count({ where: { projectId, isActive: true } }),
      prisma.heal.count({ where: { projectId, status: 'PENDING' } }),
      prisma.run.findFirst({
        where: { projectId, status: { in: ['PASSED', 'FAILED'] } },
        orderBy: { completedAt: 'desc' },
        include: { results: { select: { status: true } } },
      }),
      // All results in last 30 runs, grouped by testCaseId for flakiness
      prisma.runResult.findMany({
        where: {
          run: { projectId },
          status: { in: ['PASSED', 'FAILED'] },
        },
        select: { testCaseId: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
    ]);

  type StatusRow = { status: string };
  const lastRunPassCount = lastRun
    ? (lastRun.results as StatusRow[]).filter((r) => r.status === 'PASSED').length
    : 0;
  const lastRunFailCount = lastRun
    ? (lastRun.results as StatusRow[]).filter((r) => r.status === 'FAILED').length
    : 0;

  // Avg pass rate across all runs (last 30)
  const recentRuns = await prisma.run.findMany({
    where: { projectId, status: { in: ['PASSED', 'FAILED'] } },
    orderBy: { completedAt: 'desc' },
    take: 30,
    include: { results: { select: { status: true } } },
  });

  let avgPassRate = 0;
  if (recentRuns.length > 0) {
    const rates = (recentRuns as Array<{ results: StatusRow[] }>).map((r) => {
      const t = r.results.length;
      const p = r.results.filter((x) => x.status === 'PASSED').length;
      return t > 0 ? (p / t) * 100 : 0;
    });
    avgPassRate = Math.round(rates.reduce((a: number, b: number) => a + b, 0) / rates.length);
  }

  // Flaky tests: have both PASSED and FAILED in their last 10 results
  const byTc = new Map<string, { passed: number; failed: number; results: string[] }>();
  for (const r of allResults) {
    let entry = byTc.get(r.testCaseId);
    if (!entry) {
      entry = { passed: 0, failed: 0, results: [] };
      byTc.set(r.testCaseId, entry);
    }
    if (entry.results.length < 10) {
      entry.results.push(r.status);
      if (r.status === 'PASSED') entry.passed++;
      else entry.failed++;
    }
  }

  const flakyTcIds = [...byTc.entries()]
    .filter(([, v]) => v.passed > 0 && v.failed > 0)
    .map(([id]) => id);

  let flakyTests: FlakyTest[] = [];
  if (flakyTcIds.length > 0) {
    const tcs = await prisma.testCase.findMany({
      where: { id: { in: flakyTcIds.slice(0, 20) }, projectId },
      select: { id: true, tcId: true, title: true },
    });
    type TcRow = { id: string; tcId: string; title: string };
    flakyTests = (tcs as TcRow[]).map((tc) => {
      const data = byTc.get(tc.id)!;
      return {
        id: tc.id,
        tcId: tc.tcId,
        title: tc.title,
        passCount: data.passed,
        failCount: data.failed,
        recentResults: data.results.map((s: string) =>
          s === 'PASSED' ? 'PASSED' : s === 'FAILED' ? 'FAILED' : 'SKIPPED',
        ) as FlakyTest['recentResults'],
      };
    });
  }

  return {
    totalTests,
    scriptsGenerated,
    totalRuns,
    lastRunPassCount,
    lastRunFailCount,
    avgPassRate,
    activeSchedules,
    pendingHeals,
    flakyTests,
  };
}

// ── getRunTrend ────────────────────────────────────────────────────────────

export async function getRunTrend(projectId: string, days: number): Promise<RunTrendPoint[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const results = await prisma.runResult.findMany({
    where: {
      run: { projectId, createdAt: { gte: since } },
    },
    select: { status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const map = new Map<string, RunTrendPoint>();
  for (const r of results) {
    const date = r.createdAt.toISOString().split('T')[0]!;
    let entry = map.get(date);
    if (!entry) {
      entry = { date, passed: 0, failed: 0, skipped: 0 };
      map.set(date, entry);
    }
    if (r.status === 'PASSED') entry.passed++;
    else if (r.status === 'FAILED') entry.failed++;
    else entry.skipped++;
  }

  // Fill in missing dates
  const points: RunTrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().split('T')[0]!;
    points.push(map.get(date) ?? { date, passed: 0, failed: 0, skipped: 0 });
  }

  return points;
}

// ── getTopSuites ───────────────────────────────────────────────────────────

export interface TopSuiteEntry {
  name: string;
  runCount: number;
  lastRunStatuses: string[];
  successRate: number;
}

export async function getTopSuites(projectId: string): Promise<TopSuiteEntry[]> {
  const runs = await prisma.run.findMany({
    where: {
      projectId,
      triggerType: 'SUITE',
      status: { in: ['PASSED', 'FAILED', 'CANCELLED'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { name: true, status: true },
    take: 500,
  });

  const byName = new Map<string, { statuses: string[]; count: number }>();
  for (const run of runs) {
    const existing = byName.get(run.name);
    if (existing) {
      existing.count++;
      if (existing.statuses.length < 5) existing.statuses.push(run.status);
    } else {
      byName.set(run.name, { statuses: [run.status], count: 1 });
    }
  }

  return [...byName.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([name, { statuses, count }]) => {
      const terminal = statuses.filter((s) => s === 'PASSED' || s === 'FAILED');
      const successRate =
        terminal.length > 0
          ? Math.round((terminal.filter((s) => s === 'PASSED').length / terminal.length) * 100)
          : 0;
      return { name, runCount: count, lastRunStatuses: statuses, successRate };
    });
}

// ── getProjectTokenUsage ───────────────────────────────────────────────────

export async function getProjectTokenUsage(projectId: string): Promise<number> {
  const agg = await prisma.llmCall.aggregate({
    where: { projectId },
    _sum: { totalTokens: true },
  });
  return agg._sum.totalTokens ?? 0;
}

// ── getAgentStatuses ───────────────────────────────────────────────────────

export async function getAgentStatuses(projectId: string): Promise<AgentStatus[]> {
  const [activeRuns, activeHeals] = await Promise.all([
    prisma.run.count({ where: { projectId, status: { in: ['RUNNING', 'PENDING'] } } }),
    prisma.heal.count({ where: { projectId, status: 'PENDING' } }),
  ]);

  return [
    {
      name: 'writer',
      label: 'Test Writer',
      status: 'idle',
      detail: 'Ready',
    },
    {
      name: 'scripts',
      label: 'Script Agent',
      status: 'idle',
      detail: 'Ready',
    },
    {
      name: 'execution',
      label: 'Execution Engine',
      status: activeRuns > 0 ? 'busy' : 'ok',
      detail: activeRuns > 0 ? `${activeRuns} run${activeRuns > 1 ? 's' : ''} active` : 'All clear',
    },
    {
      name: 'healing',
      label: 'Healing Agent',
      status: activeHeals > 0 ? 'busy' : 'ok',
      detail: activeHeals > 0 ? `${activeHeals} pending` : 'No pending heals',
    },
    {
      name: 'reports',
      label: 'Reports Agent',
      status: 'ok',
      detail: 'Ready',
    },
  ];
}
