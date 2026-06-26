import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { addRunJob } from '../lib/queue.js';
import { registerSchedule, unregisterSchedule } from '../lib/scheduler.js';
import { testRunQueue } from '../lib/queue.js';
import { emitToRun } from '../lib/socket.js';

// ── Zod schemas ────────────────────────────────────────────────────────────

const CreateRunSchema = z.object({
  testCaseIds: z.array(z.string().cuid()).min(1),
  environment: z.string().transform(s => s.trim() || 'default'),
  parallelWorkers: z.number().int().min(1).max(8).default(2),
  headless: z.boolean().default(true),
  browser: z.enum(['chrome', 'firefox']).default('chrome'),
  name: z.string().max(200).optional(),
  record: z.boolean().default(true),
});

const CreateGroupRunSchema = z.object({
  useCaseTag: z.string().min(1),
  environment: z.string().transform(s => s.trim() || 'default'),
  parallelWorkers: z.number().int().min(1).max(8).default(2),
  headless: z.boolean().default(true),
  browser: z.enum(['chrome', 'firefox']).default('chrome'),
  record: z.boolean().default(true),
});

const CreateScheduleSchema = z.object({
  name: z.string().min(1).max(100),
  cronExpression: z.string().min(9).max(100),
  testCaseIds: z.array(z.string()).min(1),
  environment: z.string().min(1),
  isActive: z.boolean().default(true),
  emailRecipients: z.array(z.string().email()).default([]),
});

const UpdateScheduleSchema = CreateScheduleSchema.partial();

// ── Router setup ───────────────────────────────────────────────────────────

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── Helpers ────────────────────────────────────────────────────────────────

const MAX_ACTIVE_RUNS_PER_USER    = 5;
const MAX_ACTIVE_RUNS_PER_PROJECT = 20;

async function checkRunRateLimit(
  projectId: string,
  userId: string,
  res: Response,
): Promise<boolean> {
  const [userActive, projectActive] = await Promise.all([
    prisma.run.count({
      where: { createdByUserId: userId, status: { in: ['PENDING', 'RUNNING'] } },
    }),
    prisma.run.count({
      where: { projectId, status: { in: ['PENDING', 'RUNNING'] } },
    }),
  ]);
  if (userActive >= MAX_ACTIVE_RUNS_PER_USER) {
    res.status(429).json({
      error: `You already have ${userActive} active run(s) in progress. Wait for them to complete before starting more.`,
    });
    return false;
  }
  if (projectActive >= MAX_ACTIVE_RUNS_PER_PROJECT) {
    res.status(429).json({
      error: `This project has ${projectActive} active run(s) in progress (limit ${MAX_ACTIVE_RUNS_PER_PROJECT}). Wait for existing runs to complete.`,
    });
    return false;
  }
  return true;
}

async function resolveScriptPaths(
  projectId: string,
  testCaseIds: string[],
): Promise<{ testCaseId: string; scriptPath: string }[]> {
  const [project, scripts] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { slug: true } }),
    prisma.script.findMany({
      where: { projectId, testCaseId: { in: testCaseIds } },
      select: {
        testCaseId: true,
        filename: true,
        content: true,
        testCase: { select: { sourceRef: true } },
      },
    }),
  ]);
  const SCRIPTS_ROOT = process.env.SCRIPTS_ROOT ?? '/scripts';

  const results: { testCaseId: string; scriptPath: string }[] = [];

  for (const s of scripts.filter((s): s is typeof s & { testCaseId: string } => s.testCaseId !== null)) {
    const slug = project?.slug ?? projectId;
    // Hierarchy import: filename is a relative path (e.g. TestCases/foo/TC01.robot)
    const slugRootPath    = `${SCRIPTS_ROOT}/${slug}/${s.filename}`;
    // Legacy flat import: filename is just a basename (e.g. TC01.robot) under scripts/ subdir
    const slugScriptsPath = `${SCRIPTS_ROOT}/${slug}/scripts/${s.filename}`;
    const cuidPath        = `${SCRIPTS_ROOT}/${projectId}/${s.filename}`;
    const sourceRef = s.testCase?.sourceRef;
    const sourceRefPath = sourceRef ? `${SCRIPTS_ROOT}/${slug}/${sourceRef}` : null;

    if (fs.existsSync(slugRootPath)) {
      // Hierarchy layout — file lives at project root with full relative path preserved
      results.push({ testCaseId: s.testCaseId, scriptPath: slugRootPath });
    } else if (fs.existsSync(slugScriptsPath)) {
      results.push({ testCaseId: s.testCaseId, scriptPath: slugScriptsPath });
    } else if (fs.existsSync(cuidPath)) {
      results.push({ testCaseId: s.testCaseId, scriptPath: cuidPath });
    } else if (sourceRefPath && fs.existsSync(sourceRefPath)) {
      results.push({ testCaseId: s.testCaseId, scriptPath: sourceRefPath });
    } else if (s.content) {
      // Script is in the DB but not on disk — restore it to the appropriate location.
      const isHierarchy = s.filename.includes('/');
      const restorePath = isHierarchy ? slugRootPath : slugScriptsPath;
      fs.mkdirSync(path.dirname(restorePath), { recursive: true });
      fs.writeFileSync(restorePath, s.content, 'utf-8');
      results.push({ testCaseId: s.testCaseId, scriptPath: restorePath });
    } else {
      // No content anywhere — runner will fail with a clear file-not-found error.
      results.push({ testCaseId: s.testCaseId, scriptPath: slugRootPath });
    }
  }

  return results;
}

async function nextRunSeq(): Promise<number> {
  const agg = await prisma.run.aggregate({ _max: { runSeq: true } });
  return (agg._max.runSeq ?? 0) + 1;
}

async function getEnvConfig(projectId: string, envName: string): Promise<{ baseUrl: string; username: string; password: string }> {
  const env = await prisma.envConfig.findFirst({
    where: { projectId, name: envName },
    select: { baseUrl: true, username: true, password: true },
  });
  return {
    baseUrl: env?.baseUrl ?? '',
    username: env?.username ?? '',
    password: env?.password ?? '',
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// SCHEDULE routes  (must be registered before /:runId to avoid route collision)
// ══════════════════════════════════════════════════════════════════════════════

// GET /runs/schedules
router.get('/schedules', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schedules = await prisma.schedule.findMany({
      where: { projectId: req.project.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ schedules });
  } catch (err) { next(err); }
});

// POST /runs/schedules
router.post('/schedules', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const { name, cronExpression, testCaseIds, environment, isActive, emailRecipients } = parsed.data;

    const schedule = await prisma.schedule.create({
      data: {
        projectId: req.project.id,
        name,
        cronExpression,
        testCaseIds: JSON.stringify(testCaseIds),
        environment,
        isActive,
        emailRecipients: JSON.stringify(emailRecipients),
      },
    });

    if (isActive) {
      registerSchedule({
        id: schedule.id,
        projectId: schedule.projectId,
        name: schedule.name,
        cronExpression: schedule.cronExpression,
        testCaseIds: schedule.testCaseIds,
        environment: schedule.environment,
      });
    }

    res.status(201).json({ schedule });
  } catch (err) { next(err); }
});

// PUT /runs/schedules/:id
router.put('/schedules/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = UpdateScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const { id } = req.params;
    const existing = await prisma.schedule.findFirst({ where: { id, projectId: req.project.id } });
    if (!existing) { res.status(404).json({ error: 'Schedule not found' }); return; }

    const updated = await prisma.schedule.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.cronExpression !== undefined && { cronExpression: parsed.data.cronExpression }),
        ...(parsed.data.testCaseIds !== undefined && { testCaseIds: JSON.stringify(parsed.data.testCaseIds) }),
        ...(parsed.data.environment !== undefined && { environment: parsed.data.environment }),
        ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
        ...(parsed.data.emailRecipients !== undefined && { emailRecipients: JSON.stringify(parsed.data.emailRecipients) }),
      },
    });

    unregisterSchedule(id);
    if (updated.isActive) {
      registerSchedule({
        id: updated.id,
        projectId: updated.projectId,
        name: updated.name,
        cronExpression: updated.cronExpression,
        testCaseIds: updated.testCaseIds,
        environment: updated.environment,
      });
    }

    res.json({ schedule: updated });
  } catch (err) { next(err); }
});

// POST /runs/schedules/:id/run-now  → immediately fire a schedule
router.post('/schedules/:id/run-now', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const schedule = await prisma.schedule.findFirst({
      where: { id, projectId: req.project.id },
    });
    if (!schedule) { res.status(404).json({ error: 'Schedule not found' }); return; }

    const testCaseIds: string[] = JSON.parse(schedule.testCaseIds);
    if (testCaseIds.length === 0) {
      res.status(400).json({ error: 'Schedule has no test cases configured.' });
      return;
    }

    const resolved = await resolveScriptPaths(req.project.id, testCaseIds);
    const scriptedIds = new Set(resolved.map((r) => r.testCaseId));
    const skippedTcIds = testCaseIds.filter((id) => !scriptedIds.has(id));

    const envConfig = await getEnvConfig(req.project.id, schedule.environment);
    const runSeqSch = await nextRunSeq();

    const run = await prisma.run.create({
      data: {
        projectId: req.project.id,
        runSeq: runSeqSch,
        name: `Scheduled (now): ${schedule.name}`,
        environment: schedule.environment,
        status: 'PENDING',
        triggerType: 'SCHEDULED',
      },
    });

    await addRunJob({
      runId: run.id,
      runSeq: runSeqSch,
      projectId: req.project.id,
      testCaseIds: resolved.map((r) => r.testCaseId),
      scriptPaths: resolved.map((r) => r.scriptPath),
      skippedTcIds,
      environment: schedule.environment,
      envBaseUrl: envConfig.baseUrl,
      envUsername: envConfig.username,
      envPassword: envConfig.password,
      parallelWorkers: 2,
      headless: true,
      browser: 'chrome',
      record: req.project.videoEnabled !== false,
      triggerType: 'SCHEDULED',
    });

    res.status(201).json({ run });
  } catch (err) { next(err); }
});

// DELETE /runs/schedules/:id
router.delete('/schedules/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const existing = await prisma.schedule.findFirst({ where: { id, projectId: req.project.id } });
    if (!existing) { res.status(404).json({ error: 'Schedule not found' }); return; }
    unregisterSchedule(id);
    await prisma.schedule.delete({ where: { id } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// RUN routes
// ══════════════════════════════════════════════════════════════════════════════

// POST /runs  → MANUAL run
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const { testCaseIds, environment, parallelWorkers, headless, browser, name } = parsed.data;
    const record = req.project.videoEnabled !== false;

    if (!await checkRunRateLimit(req.project.id, req.user.id, res)) return;

    const resolved = await resolveScriptPaths(req.project.id, testCaseIds);
    const scriptedIds = new Set(resolved.map((r) => r.testCaseId));
    const skippedTcIds = testCaseIds.filter((id) => !scriptedIds.has(id));

    const envConfig = await getEnvConfig(req.project.id, environment);
    const runSeq = await nextRunSeq();

    const run = await prisma.run.create({
      data: {
        projectId: req.project.id,
        runSeq,
        name: name ?? `Manual run — ${new Date().toLocaleString()}`,
        environment,
        status: 'PENDING',
        triggerType: 'MANUAL',
        createdByUserId: req.user.id,
      },
    });

    await addRunJob({
      runId: run.id,
      runSeq,
      projectId: req.project.id,
      testCaseIds: resolved.map((r) => r.testCaseId),
      scriptPaths: resolved.map((r) => r.scriptPath),
      skippedTcIds,
      environment,
      envBaseUrl: envConfig.baseUrl,
      envUsername: envConfig.username,
      envPassword: envConfig.password,
      parallelWorkers,
      headless,
      browser,
      record,
      triggerType: 'MANUAL',
    });

    res.status(201).json({ run });
  } catch (err) { next(err); }
});

// POST /runs/individual/:testCaseId
router.post('/individual/:testCaseId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { testCaseId } = req.params;
    const environment: string = req.body.environment ?? 'Dev';
    const browser: 'chrome' | 'firefox' = req.body.browser ?? 'chrome';
    const headless: boolean = req.body.headless ?? true;

    if (!await checkRunRateLimit(req.project.id, req.user.id, res)) return;

    const tc = await prisma.testCase.findFirst({
      where: { id: testCaseId, projectId: req.project.id },
      select: { id: true, tcId: true, title: true },
    });
    if (!tc) { res.status(404).json({ error: 'Test case not found' }); return; }

    const resolved = await resolveScriptPaths(req.project.id, [testCaseId]);
    if (resolved.length === 0) {
      res.status(400).json({ error: 'No script found for this test case. Generate a script first.' });
      return;
    }

    const envConfig = await getEnvConfig(req.project.id, environment);
    const runSeqInd = await nextRunSeq();

    const run = await prisma.run.create({
      data: {
        projectId: req.project.id,
        runSeq: runSeqInd,
        name: `Individual: ${tc.tcId} — ${tc.title}`,
        environment,
        status: 'PENDING',
        triggerType: 'INDIVIDUAL',
        createdByUserId: req.user.id,
      },
    });

    await addRunJob({
      runId: run.id,
      runSeq: runSeqInd,
      projectId: req.project.id,
      testCaseIds: [testCaseId],
      scriptPaths: [resolved[0].scriptPath],
      environment,
      envBaseUrl: envConfig.baseUrl,
      envUsername: envConfig.username,
      envPassword: envConfig.password,
      parallelWorkers: 1,
      headless,
      browser,
      record: req.project.videoEnabled !== false,
      triggerType: 'INDIVIDUAL',
    });

    res.status(201).json({ run });
  } catch (err) { next(err); }
});

// POST /runs/group
router.post('/group', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateGroupRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const { useCaseTag, environment, parallelWorkers, headless, browser } = parsed.data;
    const record = req.project.videoEnabled !== false;

    if (!await checkRunRateLimit(req.project.id, req.user.id, res)) return;

    const tcs = await prisma.testCase.findMany({
      where: { projectId: req.project.id, useCaseTag, status: { in: ['APPROVED', 'DRAFT'] } },
      select: { id: true },
    });
    if (tcs.length === 0) {
      res.status(400).json({ error: `No test cases found in use case group "${useCaseTag}"` });
      return;
    }

    const testCaseIds = tcs.map((t) => t.id);
    const resolved = await resolveScriptPaths(req.project.id, testCaseIds);
    const scriptedIds = new Set(resolved.map((r) => r.testCaseId));
    const skippedTcIds = testCaseIds.filter((id) => !scriptedIds.has(id));

    const envConfig = await getEnvConfig(req.project.id, environment);
    const runSeqGrp = await nextRunSeq();

    const run = await prisma.run.create({
      data: {
        projectId: req.project.id,
        runSeq: runSeqGrp,
        name: `Group: ${useCaseTag}`,
        environment,
        status: 'PENDING',
        triggerType: 'GROUP',
        createdByUserId: req.user.id,
      },
    });

    await addRunJob({
      runId: run.id,
      runSeq: runSeqGrp,
      projectId: req.project.id,
      testCaseIds: resolved.map((r) => r.testCaseId),
      scriptPaths: resolved.map((r) => r.scriptPath),
      skippedTcIds,
      environment,
      envBaseUrl: envConfig.baseUrl,
      envUsername: envConfig.username,
      envPassword: envConfig.password,
      parallelWorkers,
      headless,
      browser,
      record,
      triggerType: 'GROUP',
    });

    res.status(201).json({ run });
  } catch (err) { next(err); }
});

// GET /runs  → list paginated
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query['page'] as string || '1', 10));
    const limit = Math.min(50, parseInt(req.query['limit'] as string || '20', 10));
    const skip = (page - 1) * limit;

    const [runs, total] = await Promise.all([
      prisma.run.findMany({
        where: { projectId: req.project.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          _count: { select: { results: true } },
          results: {
            select: { status: true },
          },
        },
      }),
      prisma.run.count({ where: { projectId: req.project.id } }),
    ]);

    res.json({ runs, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

// GET /runs/:runId  → run details + results
router.get('/:runId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.run.findFirst({
      where: { id: req.params['runId'], projectId: req.project.id },
      include: {
        results: {
          include: {
            testCase: { select: { id: true, tcId: true, title: true, type: true, useCaseTag: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!run) { res.status(404).json({ error: 'Run not found' }); return; }
    res.json({ run });
  } catch (err) { next(err); }
});

// POST /runs/:runId/retry  → re-run all TCs from a completed run
router.post('/:runId/retry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.run.findFirst({
      where: { id: req.params['runId'], projectId: req.project.id },
      include: { results: { select: { testCaseId: true } } },
    });
    if (!run) { res.status(404).json({ error: 'Run not found' }); return; }
    if (run.status === 'PENDING' || run.status === 'RUNNING') {
      res.status(400).json({ error: 'Cannot retry an active run' }); return;
    }

    const testCaseIds = [...new Set(run.results.map((r) => r.testCaseId))];
    if (testCaseIds.length === 0) {
      res.status(400).json({ error: 'No test cases in this run to retry' }); return;
    }

    const resolved = await resolveScriptPaths(req.project.id, testCaseIds);
    const scriptedIds = new Set(resolved.map((r) => r.testCaseId));
    const skippedTcIds = testCaseIds.filter((id) => !scriptedIds.has(id));

    const envConfig = await getEnvConfig(req.project.id, run.environment);
    const retryRunSeq = await nextRunSeq();

    const newRun = await prisma.run.create({
      data: {
        projectId: req.project.id,
        runSeq: retryRunSeq,
        name: `Retry #${String(run.runSeq).padStart(4, '0')} — ${run.environment}`,
        environment: run.environment,
        status: 'PENDING',
        triggerType: 'MANUAL',
        createdByUserId: req.user.id,
      },
    });

    await addRunJob({
      runId: newRun.id,
      runSeq: retryRunSeq,
      projectId: req.project.id,
      testCaseIds: resolved.map((r) => r.testCaseId),
      scriptPaths: resolved.map((r) => r.scriptPath),
      skippedTcIds,
      environment: run.environment,
      envBaseUrl: envConfig.baseUrl,
      envUsername: envConfig.username,
      envPassword: envConfig.password,
      parallelWorkers: 2,
      headless: true,
      browser: 'chrome',
      record: req.project.videoEnabled !== false,
      triggerType: 'MANUAL',
    });

    res.status(201).json({ run: newRun });
  } catch (err) { next(err); }
});

// POST /runs/:runId/cancel
router.post('/:runId/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.run.findFirst({
      where: { id: req.params['runId'], projectId: req.project.id },
      select: { id: true, status: true },
    });
    if (!run) { res.status(404).json({ error: 'Run not found' }); return; }
    if (run.status === 'PASSED' || run.status === 'FAILED' || run.status === 'CANCELLED') {
      res.status(400).json({ error: `Run is already in terminal state: ${run.status}` });
      return;
    }

    await prisma.run.update({
      where: { id: run.id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });

    // Immediately tell the frontend the run is cancelled — don't wait for the worker
    emitToRun(run.id, 'run:cancelled', { runId: run.id });

    // Try to remove from queue if still pending (no-op if already executing)
    try {
      const job = await testRunQueue.getJob(run.id);
      if (job) await job.remove();
    } catch { /* job may already be processing */ }

    res.json({ message: 'Run cancelled' });
  } catch (err) { next(err); }
});

export default router;
