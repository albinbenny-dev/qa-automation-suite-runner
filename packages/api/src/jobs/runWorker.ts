import { Worker, type Job } from 'bullmq';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { emitToRun } from '../lib/socket.js';
import type { RunJobPayload } from '../lib/queue.js';

const ARTIFACTS_ROOT = process.env.ARTIFACTS_ROOT ?? process.env.ARTIFACTS_PATH ?? '/artifacts';

// ── RF report shape (from parseRobotXmlReport in runner/index.js) ──────────
interface RFReport {
  _robotReport?: true;
  suiteStatus?: 'PASS' | 'FAIL';
  tests?: Array<{ name: string; status: 'PASS' | 'FAIL'; durationMs: number; errorMsg: string | null }>;
}

// ── Semaphore — limits total concurrent TC executions across all stages ────
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];
  constructor(permits: number) { this.permits = permits; }
  acquire(): Promise<void> {
    if (this.permits > 0) { this.permits--; return Promise.resolve(); }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }
  release(): void {
    if (this.queue.length > 0) { this.queue.shift()!(); } else { this.permits++; }
  }
}

// Module-level semaphore caps total concurrent /run calls across all BullMQ jobs
// so we never exceed total display slots across all runner instances (CONC-002).
// Total slots = RUNNER_REPLICAS * RUNNER_CONCURRENCY (defaults: 1 * 4 = 4).
const _replicas    = parseInt(process.env.RUNNER_REPLICAS    ?? '1', 10);
const _concurrency = parseInt(process.env.RUNNER_CONCURRENCY ?? '4', 10);
const MAX_RUNNER_DISPLAYS = parseInt(process.env.MAX_RUNNER_DISPLAYS ?? String(_replicas * _concurrency), 10);
const runnerDisplaySem = new Semaphore(MAX_RUNNER_DISPLAYS);

// ── Main job processor ─────────────────────────────────────────────────────
async function processRunJob(job: Job<RunJobPayload>): Promise<void> {
  const { runId, runSeq, projectId, testCaseIds, scriptPaths, skippedTcIds = [],
    stages,
    environment, envBaseUrl,
    envUsername = '', envPassword = '', parallelWorkers, headless, browser, record = false } = job.data;

  const total = scriptPaths.length;
  const runLabel = `RUN-${String(runSeq).padStart(4, '0')}`;

  const projectRecord = await prisma.project.findUnique({
    where: { id: projectId },
    select: { slug: true },
  });
  const projectSlug = projectRecord?.slug ?? projectId;

  const artifactsDir = path.join(ARTIFACTS_ROOT, projectSlug, `${runLabel}_${runId}`);

  try {
    fs.mkdirSync(artifactsDir, { recursive: true });
  } catch { /* ignore */ }

  // ── 1. Mark run as RUNNING ───────────────────────────────────────────────
  await prisma.run.update({
    where: { id: runId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  emitToRun(runId, 'run:start', { total: total + skippedTcIds.length, environment, parallelWorkers, browser, headless: false });
  emitLog(runId, 'info',
    `▶ Starting run · ${total} script${total !== 1 ? 's' : ''}${skippedTcIds.length > 0 ? ` · ${skippedTcIds.length} skipped (no script)` : ''} · ${parallelWorkers} workers · ${browser} · headed`
  );

  // ── 2. Check for cancellation / already-terminal state ──────────────────
  const currentRun = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
  if (
    currentRun?.status === 'CANCELLED' ||
    currentRun?.status === 'PASSED' ||
    currentRun?.status === 'FAILED'
  ) {
    emitLog(runId, 'warn', `■ Run already in terminal state (${currentRun.status}) — skipping`);
    emitToRun(runId, 'run:complete', { passed: 0, failed: 0, skipped: 0, duration: 0 });
    return;
  }

  // ── 2b. Build readable TC id lookup ──────────────────────────────────────
  const allTcIds = [...testCaseIds, ...skippedTcIds];
  const tcRecords = await prisma.testCase.findMany({
    where: { id: { in: allTcIds } },
    select: { id: true, tcId: true },
  });
  const tcReadableId = new Map<string, string>(tcRecords.map((t) => [t.id, t.tcId]));

  // ── 3. Initialise RunResult records ─────────────────────────────────────
  await prisma.runResult.deleteMany({ where: { runId } });

  const scriptRecords = await prisma.script.findMany({
    where: { testCaseId: { in: testCaseIds }, projectId },
    select: { id: true, testCaseId: true },
    orderBy: { updatedAt: 'desc' },
  });
  const tcIdToScriptId = new Map<string, string>();
  for (const s of scriptRecords) {
    if (s.testCaseId && !tcIdToScriptId.has(s.testCaseId)) {
      tcIdToScriptId.set(s.testCaseId, s.id);
    }
  }

  if (testCaseIds.length > 0) {
    await prisma.runResult.createMany({
      data: testCaseIds.map((tcId) => ({
        runId,
        testCaseId: tcId,
        status: 'PENDING',
        scriptId: tcIdToScriptId.get(tcId) ?? null,
      })),
    });
  }

  if (skippedTcIds.length > 0) {
    await prisma.runResult.createMany({
      data: skippedTcIds.map((tcId) => ({
        runId,
        testCaseId: tcId,
        status: 'SKIPPED',
        errorMessage: 'No automation script — test case skipped',
      })),
    });
    for (const tcId of skippedTcIds) {
      emitLog(runId, 'warn', `⊙ ${tcReadableId.get(tcId) ?? tcId} SKIPPED — no automation script`);
    }
  }

  // ── 4. Build lookup: testCaseId → RunResult id ───────────────────────────
  const runResults = await prisma.runResult.findMany({
    where: { runId },
    select: { id: true, testCaseId: true },
  });
  const tcIdToRunResultId = new Map<string, string>(
    runResults.map((r: { testCaseId: string; id: string }) => [r.testCaseId, r.id] as [string, string]),
  );

  const startTime = Date.now();
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = skippedTcIds.length;

  const runAbortController = new AbortController();
  let userCancelled = false;

  const cancelWatcher = setInterval(async () => {
    if (userCancelled) { clearInterval(cancelWatcher); return; }
    try {
      const s = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
      if (s?.status === 'CANCELLED') {
        userCancelled = true;
        runAbortController.abort();
        clearInterval(cancelWatcher);
      }
    } catch { /* DB hiccup — keep polling */ }
  }, 2000);

  // ── Helper: execute a single script and update its RunResult ────────────
  async function executeScript(
    testCaseId: string,
    scriptPath: string,
    scriptIndex: number,
  ): Promise<void> {
    const scriptName = path.basename(scriptPath);
    const runResultId = tcIdToRunResultId.get(testCaseId);

    emitLog(runId, 'run', `→ [W${(scriptIndex % parallelWorkers) + 1}] ${scriptName}`);

    if (runResultId) {
      await prisma.runResult.update({ where: { id: runResultId }, data: { status: 'RUNNING' } });
    }
    emitToRun(runId, 'run:progress', { testCaseId, status: 'RUNNING', index: scriptIndex, total });

    const tcLabel = tcReadableId.get(testCaseId) ?? `tc-${scriptIndex}`;
    const reportFile = path.join(artifactsDir, `${runLabel}_${tcLabel}_report.json`);
    const outputDir = path.join(artifactsDir, `${runLabel}_${tcLabel}`);

    const result = await spawnRunner(
      scriptPath,
      reportFile,
      outputDir,
      { parallelWorkers, headless, browser, envBaseUrl, envUsername, envPassword, environment, projectSlug, record },
      (line) => emitLog(runId, 'run', line),
      (warning) => emitLog(runId, 'warn', warning),
      runAbortController.signal,
    );

    if (runAbortController.signal.aborted) {
      if (runResultId) {
        await prisma.runResult.update({
          where: { id: runResultId },
          data: { status: 'FAILED', errorMessage: 'Run was cancelled' },
        });
      }
      return;
    }

    let passed = false;
    let duration = 0;
    let errorMessage: string | undefined;
    let screenshotPath: string | undefined;
    let videoPath: string | undefined;
    let rfLogPath: string | undefined;

    if (result.reportData?._robotReport) {
      const rfReport = result.reportData;
      const rfTests = rfReport.tests ?? [];
      duration = rfTests.reduce((sum, t) => sum + t.durationMs, 0) || result.durationMs;
      passed = result.exitCode === 0;
      if (!passed) {
        const failedTest = rfTests.find((t) => t.status === 'FAIL');
        errorMessage = failedTest?.errorMsg
          ?? result.errorSnippet
          ?? 'Robot test failed — check the run log for details.';
      }
      if (result.screenshotPath) screenshotPath = result.screenshotPath;
      if (result.videoPath) videoPath = result.videoPath;
      const rfLog_ = path.join(outputDir, 'log.html');
      if (fs.existsSync(rfLog_)) rfLogPath = rfLog_;
    } else {
      passed = result.exitCode === 0;
      duration = result.durationMs;
      if (!passed) errorMessage = result.error ?? 'Test failed — non-zero exit code';
    }

    const finalStatus = passed ? 'PASSED' : 'FAILED';

    if (runResultId) {
      await prisma.runResult.update({
        where: { id: runResultId },
        data: {
          status: finalStatus,
          duration,
          errorMessage: errorMessage ?? null,
          screenshotPath: screenshotPath ?? null,
          videoPath: videoPath ?? null,
          rfLogPath: rfLogPath ?? null,
        },
      });
    }

    if (passed) {
      totalPassed++;
      emitLog(runId, 'pass', `✓ ${scriptName} PASSED · ${(duration / 1000).toFixed(1)}s`);
    } else {
      totalFailed++;
      emitLog(runId, 'fail', `✗ ${scriptName} FAILED · ${errorMessage ?? 'Unknown error'}`);
    }

    emitToRun(runId, 'run:progress', {
      testCaseId, status: finalStatus, index: scriptIndex, total,
      passed: totalPassed, failed: totalFailed,
    });
  }

  // ── 5. Execute scripts — stage-aware or flat sequential ─────────────────
  if (stages && stages.length > 0) {
    // Execution model:
    //
    // SEQUENTIAL stages share a single pipeline slot — they run one after the
    // other in suite order.  Stage-3 (seq) only starts once Stage-1 (seq)
    // fully completes.
    //
    // PARALLEL stages each become an independent actor that competes for any
    // free worker slot.
    //
    // parallelWorkers = total concurrent slots shared by all actors.
    //
    // Example — workers=2, [Approval(seq), CustomerMgmt(par), E2E(seq), POS(par)]:
    //   Slot 1 → sequential pipeline: Approval(all TCs) → E2E(all TCs)
    //   Slot 2 → parallel actor:      CustomerMgmt(all TCs) → POS(all TCs)
    //
    // Example — workers=3:
    //   Slot 1 → sequential pipeline: Approval → E2E
    //   Slot 2 → CustomerMgmt
    //   Slot 3 → POS    (both parallel actors start immediately)

    // Pre-compute globalIndex offsets for every stage
    let globalIndex = 0;
    const stageOffsets = stages.map((stage) => {
      const offset = globalIndex;
      globalIndex += stage.testCaseIds.length;
      return offset;
    });

    // Helper: run all TCs in one stage sequentially
    async function runStageSequential(stage: typeof stages[0], offset: number) {
      for (let idx = 0; idx < stage.testCaseIds.length; idx++) {
        if (runAbortController.signal.aborted) break;
        await executeScript(stage.testCaseIds[idx], stage.scriptPaths[idx], offset + idx);
        if (runAbortController.signal.aborted) {
          emitLog(runId, 'warn', '■ Run cancelled during script execution');
          break;
        }
      }
    }

    // Build actors
    const actors: Array<() => Promise<void>> = [];

    // Actor 1: sequential pipeline — all seq stages in suite order, one slot
    const seqStages = stages.filter((s) => s.mode === 'sequential');
    if (seqStages.length > 0) {
      actors.push(async () => {
        for (const stage of seqStages) {
          if (runAbortController.signal.aborted) break;
          const offset = stageOffsets[stages.indexOf(stage)];
          emitLog(runId, 'info', `→ [SEQ] Stage [${stage.useCaseTag}] — ${stage.testCaseIds.length} TCs`);
          await runStageSequential(stage, offset);
        }
      });
    }

    // Actors 2…N: one actor per parallel stage
    for (const stage of stages.filter((s) => s.mode === 'parallel')) {
      const offset = stageOffsets[stages.indexOf(stage)];
      actors.push(async () => {
        if (runAbortController.signal.aborted) return;
        emitLog(runId, 'info', `⚡ [PAR] Stage [${stage.useCaseTag}] — ${stage.testCaseIds.length} TCs`);
        await runStageSequential(stage, offset);
      });
    }

    // Run actors with a semaphore capping total concurrent slots
    const sem = new Semaphore(parallelWorkers);
    await Promise.all(
      actors.map(async (actor) => {
        await sem.acquire();
        try { await actor(); } finally { sem.release(); }
      }),
    );
  } else {
    // Flat sequential execution (non-suite runs)
    for (let i = 0; i < scriptPaths.length; i++) {
      if (runAbortController.signal.aborted) {
        emitLog(runId, 'warn', `■ Run cancelled — skipping remaining ${scriptPaths.length - i} scripts`);
        break;
      }
      await executeScript(testCaseIds[i], scriptPaths[i], i);
      if (runAbortController.signal.aborted) {
        emitLog(runId, 'warn', '■ Run cancelled during script execution');
        break;
      }
    }
  }

  clearInterval(cancelWatcher);
  runAbortController.abort();

  const elapsed = Date.now() - startTime;

  if (userCancelled) {
    emitLog(runId, 'warn', `■ Run stopped · ${totalPassed} passed · ${totalFailed} failed`);
    return;
  }

  const runFinalStatus = totalFailed === 0 ? 'PASSED' : 'FAILED';

  await prisma.run.update({
    where: { id: runId },
    data: { status: runFinalStatus, completedAt: new Date() },
  });

  emitLog(runId, 'info',
    `■ Run complete · ${totalPassed} passed · ${totalFailed} failed · ${totalSkipped} skipped · ${(elapsed / 1000).toFixed(1)}s`
  );
  emitToRun(runId, 'run:complete', {
    passed: totalPassed, failed: totalFailed, skipped: totalSkipped, duration: elapsed,
  });
}

// ── Helper: emit log line ─────────────────────────────────────────────────
function emitLog(runId: string, kind: 'info' | 'pass' | 'fail' | 'run' | 'warn', text: string): void {
  emitToRun(runId, 'run:log', { kind, text, ts: new Date().toISOString() });
}

// ── Helper: call runner HTTP API ──────────────────────────────────────────
interface SpawnResult {
  exitCode: number;
  error?: string;
  durationMs: number;
  reportData?: RFReport;
  screenshotPath?: string;
  videoPath?: string;
  videoPaths?: string[];
  errorSnippet?: string;
}

async function spawnRunner(
  scriptPath: string,
  reportFile: string,
  outputDir: string,
  opts: { parallelWorkers: number; headless: boolean; browser: string; envBaseUrl: string; envUsername: string; envPassword: string; environment: string; projectSlug?: string; record?: boolean },
  onLine: (line: string) => void,
  onWarning: (line: string) => void,
  externalSignal?: AbortSignal,
): Promise<SpawnResult> {
  const start = Date.now();
  const runnerUrl = process.env.RUNNER_URL ?? 'http://qaasr-runner:5001';

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 960_000);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) { controller.abort(); }
    else { externalSignal.addEventListener('abort', onExternalAbort, { once: true }); }
  }

  try {
    await runnerDisplaySem.acquire();
    const runnerHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.RUNNER_SECRET) {
      runnerHeaders['x-runner-secret'] = process.env.RUNNER_SECRET;
    }
    const response = await fetch(`${runnerUrl}/run`, {
      method: 'POST',
      headers: runnerHeaders,
      signal: controller.signal,
      body: JSON.stringify({
        scriptPath,
        reportFile,
        outputDir,
        browser: opts.browser,
        workers: opts.parallelWorkers,
        headless: opts.headless,
        baseUrl: opts.envBaseUrl || '',
        username: opts.envUsername || '',
        password: opts.envPassword || '',
        environment: opts.environment,
        projectSlug: opts.projectSlug || '',
        record: opts.record ?? false,
      }),
    });

    let exitCode = 1;
    let reportData: RFReport | undefined;
    let rfScreenshotPath: string | undefined;
    let rfVideoPath: string | undefined;
    let rfVideoPaths: string[] | undefined;
    let rfErrorSnippet: string | undefined;

    const processLine = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      let msg: { type: string; text?: string; exitCode?: number; reportData?: RFReport | null; screenshotPath?: string | null; videoPath?: string | null; videoPaths?: string[] | null; errorSnippet?: string | null };
      try {
        msg = JSON.parse(trimmed);
      } catch {
        onLine(trimmed);
        return;
      }
      if (msg.type === 'heartbeat') {
        return;
      } else if (msg.type === 'warning' && msg.text) {
        onWarning(msg.text);
      } else if (msg.type === 'log' && msg.text) {
        onLine(msg.text);
      } else if (msg.type === 'done') {
        exitCode = msg.exitCode ?? 1;
        reportData = msg.reportData ?? undefined;
        if (msg.screenshotPath) rfScreenshotPath = msg.screenshotPath;
        if (msg.videoPaths && Array.isArray(msg.videoPaths) && msg.videoPaths.length > 0) {
          rfVideoPaths = msg.videoPaths;
          rfVideoPath = msg.videoPaths.length === 1 ? msg.videoPaths[0] : JSON.stringify(msg.videoPaths);
        } else if (msg.videoPath) {
          rfVideoPath = msg.videoPath;
        }
        if (msg.errorSnippet) rfErrorSnippet = msg.errorSnippet;
      }
    };

    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = '';
      try {
        while (true) {
          if (controller.signal.aborted) { reader.cancel(); break; }
          const { done, value } = await reader.read();
          if (done) break;
          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() ?? '';
          for (const line of lines) processLine(line);
        }
        if (lineBuffer) processLine(lineBuffer);
      } finally {
        reader.releaseLock();
      }
    } else {
      const text = await response.text();
      for (const raw of text.split('\n')) processLine(raw);
    }

    clearTimeout(fetchTimeout);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    runnerDisplaySem.release();
    const durationMs = Date.now() - start;
    return { exitCode, reportData, durationMs, screenshotPath: rfScreenshotPath, videoPath: rfVideoPath, videoPaths: rfVideoPaths, errorSnippet: rfErrorSnippet };
  } catch (err: unknown) {
    clearTimeout(fetchTimeout);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    runnerDisplaySem.release();
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const isCancelled = isAbort && externalSignal?.aborted;
    return {
      exitCode: 1,
      error: isCancelled
        ? 'Cancelled'
        : isAbort
        ? 'Runner timed out — script may be hanging'
        : `Runner unavailable: ${message}`,
      durationMs,
    };
  }
}

// ── Start worker ──────────────────────────────────────────────────────────
export function startRunWorker(): void {
  const connection = (() => {
    try {
      const u = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
      return {
        host: u.hostname || 'localhost',
        port: parseInt(u.port || '6379', 10),
        password: u.password || undefined,
        db: parseInt(u.pathname.replace('/', '') || '0', 10),
      };
    } catch {
      return { host: 'localhost', port: 6379, db: 0 };
    }
  })();

  const worker = new Worker('test-runs', processRunJob, {
    connection,
    concurrency: 6,
  });

  worker.on('completed', (job) => {
    console.log(`[run-worker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[run-worker] Job ${job?.id} failed:`, err.message);
    if (job?.data.runId) {
      void prisma.run.update({
        where: { id: job.data.runId },
        data: { status: 'FAILED', completedAt: new Date() },
      });
      emitLog(job.data.runId, 'fail', `Worker error: ${err.message}`);
      emitToRun(job.data.runId, 'run:error', err.message);
    }
  });

  console.log('[run-worker] Worker started, listening on queue "test-runs"');

  runWorkerInstance = worker;
}

let runWorkerInstance: import('bullmq').Worker | null = null;

export function getRunWorker(): import('bullmq').Worker | null {
  return runWorkerInstance;
}
