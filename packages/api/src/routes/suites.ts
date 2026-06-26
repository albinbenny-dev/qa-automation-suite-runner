import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import fs from 'fs';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { addRunJob } from '../lib/queue.js';

// ── Zod schemas ────────────────────────────────────────────────────────────

const CreateSuiteSchema = z.object({
  name: z.string().min(1).max(100),
  testCaseIds: z.array(z.string()).min(1),
});

const UpdateSuiteSchema = CreateSuiteSchema.partial();

const RunSuiteSchema = z.object({
  environment:     z.string().min(1),
  parallelWorkers: z.number().int().min(1).max(8).default(2),
  headless:        z.boolean().default(true),
  browser:         z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
  /** Optional override for the run name shown in the UI */
  name:            z.string().max(200).optional(),
});

// ── Shared helpers (mirrors the private helpers in runs.ts) ────────────────

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
        testCase: { select: { sourceRef: true } },
      },
    }),
  ]);
  const SCRIPTS_ROOT = process.env.SCRIPTS_ROOT ?? '/scripts';
  return scripts
    .filter((s): s is typeof s & { testCaseId: string } => s.testCaseId !== null)
    .map((s) => {
      const cuidPath = `${SCRIPTS_ROOT}/${projectId}/${s.filename}`;
      if (fs.existsSync(cuidPath)) {
        return { testCaseId: s.testCaseId, scriptPath: cuidPath };
      }
      const sourceRef = s.testCase?.sourceRef;
      if (sourceRef) {
        const slugPath = `${SCRIPTS_ROOT}/${project?.slug}/${sourceRef}`;
        if (fs.existsSync(slugPath)) {
          return { testCaseId: s.testCaseId, scriptPath: slugPath };
        }
        if (sourceRef.includes('/')) {
          return { testCaseId: s.testCaseId, scriptPath: slugPath };
        }
      }
      return { testCaseId: s.testCaseId, scriptPath: cuidPath };
    });
}

async function nextRunSeq(): Promise<number> {
  const agg = await prisma.run.aggregate({ _max: { runSeq: true } });
  return (agg._max.runSeq ?? 0) + 1;
}

async function getEnvConfig(
  projectId: string,
  envName: string,
): Promise<{ baseUrl: string; username: string; password: string }> {
  const env = await prisma.envConfig.findFirst({
    where: { projectId, name: envName },
    select: { baseUrl: true, username: true, password: true },
  });
  return {
    baseUrl:  env?.baseUrl  ?? '',
    username: env?.username ?? '',
    password: env?.password ?? '',
  };
}

// ── Router setup ───────────────────────────────────────────────────────────

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── GET /projects/:projectId/suites ────────────────────────────────────────

router.get('/', (async (req, res) => {
  const projectId = req.project.id;
  const suites = await prisma.suite.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ suites });
}) as RequestHandler);

// ── POST /projects/:projectId/suites ───────────────────────────────────────

router.post('/', (async (req, res) => {
  const projectId = req.project.id;
  const parsed = CreateSuiteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { name, testCaseIds } = parsed.data;
  const suite = await prisma.suite.create({
    data: {
      projectId,
      name,
      testCaseIds: JSON.stringify(testCaseIds),
    },
  });
  res.status(201).json({ suite });
}) as RequestHandler);

// ── PUT /projects/:projectId/suites/:suiteId ───────────────────────────────

router.put('/:suiteId', (async (req, res) => {
  const projectId = req.project.id;
  const { suiteId } = req.params;
  const parsed = UpdateSuiteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const existing = await prisma.suite.findFirst({ where: { id: suiteId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Suite not found' });

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.testCaseIds !== undefined) data.testCaseIds = JSON.stringify(parsed.data.testCaseIds);

  const suite = await prisma.suite.update({ where: { id: suiteId }, data });
  res.json({ suite });
}) as RequestHandler);

// ── POST /projects/:projectId/suites/:suiteId/run ─────────────────────────
//
// CI/CD entry point — trigger a full suite run without knowing individual TC IDs.
//
// Request body:
//   { environment, parallelWorkers?, headless?, browser?, name? }
//
// Response 201:
//   { run: { id, runSeq, name, status, triggerType, ... } }
//
// Poll status via:
//   GET /api/projects/:projectId/runs/:runId
//   → run.status: "PENDING" | "RUNNING" | "PASSED" | "FAILED" | "CANCELLED"
//
// Example (GitHub Actions):
//   RUN_ID=$(curl -sf -X POST $QA_URL/api/projects/$PROJECT_ID/suites/$SUITE_ID/run \
//     -H "Authorization: Bearer $TOKEN" \
//     -H "Content-Type: application/json" \
//     -d '{"environment":"Staging","parallelWorkers":4}' | jq -r '.run.id')

router.post('/:suiteId/run', (async (req, res) => {
  const projectId = req.project.id;
  const { suiteId } = req.params;

  // 1. Validate request body
  const parsed = RunSuiteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }
  const { environment, parallelWorkers, headless, browser, name } = parsed.data;

  // 2. Load suite and decode its test case list
  const suite = await prisma.suite.findFirst({ where: { id: suiteId, projectId } });
  if (!suite) return res.status(404).json({ error: 'Suite not found' });

  let testCaseIds: string[];
  try {
    testCaseIds = JSON.parse(suite.testCaseIds) as string[];
  } catch {
    return res.status(500).json({ error: 'Suite testCaseIds is corrupted — re-save the suite.' });
  }

  if (testCaseIds.length === 0) {
    return res.status(400).json({ error: `Suite "${suite.name}" has no test cases. Add test cases to the suite first.` });
  }

  // 3. Resolve which TC IDs have automation scripts
  const resolved = await resolveScriptPaths(projectId, testCaseIds);
  const scriptedIds = new Set(resolved.map((r) => r.testCaseId));
  const skippedTcIds = testCaseIds.filter((id) => !scriptedIds.has(id));

  if (resolved.length === 0) {
    return res.status(400).json({
      error: `None of the ${testCaseIds.length} test case(s) in suite "${suite.name}" have automation scripts. Generate scripts first.`,
      skippedCount: skippedTcIds.length,
    });
  }

  // 4. Build run record
  const envConfig = await getEnvConfig(projectId, environment);
  const runSeq   = await nextRunSeq();
  const runName  = name ?? `Suite: ${suite.name} — ${environment}`;

  const run = await prisma.run.create({
    data: {
      projectId,
      runSeq,
      name: runName,
      environment,
      status:      'PENDING',
      triggerType: 'SUITE',
    },
  });

  // 5. Enqueue the job (same BullMQ pipeline as every other trigger type)
  await addRunJob({
    runId:          run.id,
    runSeq,
    projectId,
    testCaseIds:    resolved.map((r) => r.testCaseId),
    scriptPaths:    resolved.map((r) => r.scriptPath),
    skippedTcIds,
    environment,
    envBaseUrl:     envConfig.baseUrl,
    envUsername:    envConfig.username,
    envPassword:    envConfig.password,
    parallelWorkers,
    headless,
    browser,
    triggerType:    'SUITE',
  });

  // 6. Return run record so the caller can poll status
  return res.status(201).json({
    run,
    meta: {
      totalTestCases: testCaseIds.length,
      scriptedCount:  resolved.length,
      skippedCount:   skippedTcIds.length,
      ...(skippedTcIds.length > 0 && {
        skippedTcIds,
        warning: `${skippedTcIds.length} test case(s) skipped — no automation script found.`,
      }),
    },
  });
}) as RequestHandler);

// ── DELETE /projects/:projectId/suites/:suiteId ────────────────────────────

router.delete('/:suiteId', (async (req, res) => {
  const projectId = req.project.id;
  const { suiteId } = req.params;
  const existing = await prisma.suite.findFirst({ where: { id: suiteId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Suite not found' });
  await prisma.suite.delete({ where: { id: suiteId } });
  res.json({ message: 'Suite deleted' });
}) as RequestHandler);

export default router;
