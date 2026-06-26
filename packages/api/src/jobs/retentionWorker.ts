import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../lib/prisma.js';

const ARTIFACTS_ROOT = process.env.ARTIFACTS_PATH ?? '/artifacts';

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

function getConfig() {
  return {
    runResultDays:    parseInt(process.env.RETENTION_RUNRESULT_DAYS   ?? '90',  10),
    healDays:         parseInt(process.env.RETENTION_HEAL_DAYS        ?? '30',  10),
    llmCallDays:      parseInt(process.env.RETENTION_LLMCALL_DAYS     ?? '90',  10),
    artifactsDays:    parseInt(process.env.RETENTION_ARTIFACTS_DAYS   ?? '30',  10),
    videoDays:        parseInt(process.env.RETENTION_VIDEO_DAYS       ?? '7',   10),
    traceDays:        parseInt(process.env.RETENTION_TRACE_DAYS       ?? '14',  10),
    screenshotDays:   parseInt(process.env.RETENTION_SCREENSHOT_DAYS  ?? '30',  10),
    maxRunsPerProject: parseInt(process.env.MAX_RUNS_PER_PROJECT      ?? '500', 10),
  };
}

// ── Layer 1: DB Retention ──────────────────────────────────────────────────

async function runDbRetention(): Promise<void> {
  const cfg = getConfig();
  const healCutoff      = daysAgo(cfg.healDays);
  const runResultCutoff = daysAgo(cfg.runResultDays);
  const llmCallCutoff   = daysAgo(cfg.llmCallDays);

  // Step 1 — Delete old Heals first (they hold the FK to AgentTrace; removing them
  //          before AgentTrace avoids FK violation on the subsequent AgentTrace delete).
  const { count: healCount } = await prisma.heal.deleteMany({
    where: { createdAt: { lt: healCutoff } },
  });

  // Step 2 — Delete old AgentTraces.
  //          Any remaining Heal rows that still point to traces being deleted must be
  //          null-ed first (edge case: trace older than heal threshold but heal is recent).
  const oldTraces = await prisma.agentTrace.findMany({
    where: { createdAt: { lt: healCutoff } },
    select: { id: true },
  });
  let traceCount = 0;
  if (oldTraces.length > 0) {
    const ids = oldTraces.map((t) => t.id);
    await prisma.heal.updateMany({
      where: { agentTraceId: { in: ids } },
      data: { agentTraceId: null },
    });
    const { count } = await prisma.agentTrace.deleteMany({ where: { id: { in: ids } } });
    traceCount = count;
  }

  // Step 3 — Delete old RunResults (cascades to any remaining Heals via onDelete: Cascade).
  const { count: rrCount } = await prisma.runResult.deleteMany({
    where: { createdAt: { lt: runResultCutoff } },
  });

  // Step 4 — Delete old LlmCall rows.
  const { count: llmCount } = await prisma.llmCall.deleteMany({
    where: { createdAt: { lt: llmCallCutoff } },
  });

  // Step 5 — Apply MAX_RUNS_PER_PROJECT hard cap.
  //          Only terminal runs are eligible; in-flight runs are never deleted.
  let runCapCount = 0;
  const projects = await prisma.project.findMany({ select: { id: true } });
  for (const { id: projectId } of projects) {
    const total = await prisma.run.count({ where: { projectId } });
    if (total > cfg.maxRunsPerProject) {
      const excess = total - cfg.maxRunsPerProject;
      const oldest = await prisma.run.findMany({
        where: { projectId, status: { notIn: ['RUNNING', 'PENDING'] } },
        orderBy: { createdAt: 'asc' },
        take: excess,
        select: { id: true },
      });
      if (oldest.length > 0) {
        const { count } = await prisma.run.deleteMany({
          where: { id: { in: oldest.map((r) => r.id) } },
        });
        runCapCount += count;
      }
    }
  }

  console.log(
    `[retention] DB sweep — heals: ${healCount}, traces: ${traceCount}, runResults: ${rrCount}, llmCalls: ${llmCount}, runs(cap): ${runCapCount}`,
  );
}

// ── Layer 2: Filesystem Artifact Retention ─────────────────────────────────

async function deleteIfOlderThan(filePath: string, thresholdMs: number): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs < thresholdMs) {
      await fs.unlink(filePath);
      return true;
    }
  } catch { /* file may have already been deleted */ }
  return false;
}

async function sweepFilesInDir(
  dir: string,
  extThresholds: Record<string, number>,
): Promise<number> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return 0;
  let deleted = 0;
  for (const entry of entries) {
    const entryPath = path.join(dir, String(entry.name));
    if (entry.isDirectory()) {
      deleted += await sweepFilesInDir(entryPath, extThresholds);
    } else if (entry.isFile()) {
      const ext = path.extname(String(entry.name)).toLowerCase();
      const threshold = extThresholds[ext];
      if (threshold !== undefined && await deleteIfOlderThan(entryPath, threshold)) {
        deleted++;
      }
    }
  }
  return deleted;
}

async function runArtifactRetention(): Promise<void> {
  const cfg = getConfig();
  const now = Date.now();

  const artifactThresholdMs = now - cfg.artifactsDays * 86_400_000;

  // Per-extension thresholds for fine-grained file sweeps within recent run dirs.
  const extThresholds: Record<string, number> = {
    '.webm': now - cfg.videoDays      * 86_400_000,
    '.zip':  now - cfg.traceDays      * 86_400_000,
    '.png':  now - cfg.screenshotDays * 86_400_000,
    '.jpg':  now - cfg.screenshotDays * 86_400_000,
    '.jpeg': now - cfg.screenshotDays * 86_400_000,
  };

  let deletedDirs = 0;
  let deletedFiles = 0;

  const projectDirs = await fs.readdir(ARTIFACTS_ROOT, { withFileTypes: true }).catch(() => null);
  if (!projectDirs) return; // artifacts root does not exist yet — nothing to sweep

  for (const pEntry of projectDirs) {
    if (!pEntry.isDirectory()) continue;
    const projectDir = path.join(ARTIFACTS_ROOT, String(pEntry.name));

    const runDirs = await fs.readdir(projectDir, { withFileTypes: true }).catch(() => null);
    if (!runDirs) continue;

    for (const rEntry of runDirs) {
      if (!rEntry.isDirectory()) continue;
      const runDir = path.join(projectDir, String(rEntry.name));

      const dirStat = await fs.stat(runDir).catch(() => null);
      if (!dirStat) continue;

      if (dirStat.mtimeMs < artifactThresholdMs) {
        // Entire run dir is past the retention window — remove it all at once.
        try {
          await fs.rm(runDir, { recursive: true, force: true });
          deletedDirs++;
        } catch { /* ignore */ }
      } else {
        // Run dir is still within retention — sweep only large/short-lived file types.
        deletedFiles += await sweepFilesInDir(runDir, extThresholds);
      }
    }

    // Remove project dir if it is now empty.
    try {
      const remaining = await fs.readdir(projectDir);
      if (remaining.length === 0) await fs.rmdir(projectDir);
    } catch { /* ignore */ }
  }

  console.log(
    `[retention] Artifact sweep — run dirs deleted: ${deletedDirs}, individual files deleted: ${deletedFiles}`,
  );
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function runRetention(): Promise<void> {
  console.log('[retention] Starting retention sweep');
  try {
    await runDbRetention();
  } catch (err) {
    console.error('[retention] DB retention error:', err);
  }
  try {
    await runArtifactRetention();
  } catch (err) {
    console.error('[retention] Artifact retention error:', err);
  }
  console.log('[retention] Retention sweep complete');
}

export function startRetentionSchedule(): void {
  // Runs every day at 02:00 server time — low-traffic window.
  cron.schedule('0 2 * * *', () => { void runRetention(); });
  console.log('[retention] Nightly retention sweep scheduled (02:00 daily)');
}
