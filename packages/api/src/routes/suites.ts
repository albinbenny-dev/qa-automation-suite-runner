import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import fs from 'fs';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { addRunJob } from '../lib/queue.js';

// ── Zod schemas ────────────────────────────────────────────────────────────

const SuiteStageSchema = z.object({
  useCaseTag: z.string().min(1),
  mode: z.enum(['sequential', 'parallel']),
  testCaseIds: z.array(z.string()).optional(),
});

const CreateSuiteSchema = z.object({
  name: z.string().min(1).max(100),
  stages: z.array(SuiteStageSchema).min(1),
});

const UpdateSuiteSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  stages: z.array(SuiteStageSchema).optional(),
});

const RunSuiteSchema = z.object({
  environment:     z.string().min(1),
  parallelWorkers: z.number().int().min(1).max(8).default(2),
  headless:        z.boolean().default(true),
  browser:         z.enum(['chrome', 'firefox']).default('chrome'),
  record:          z.boolean().default(true),
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
      // Prefer slug/filename path (always works regardless of sourceRef)
      const slugByFilename = `${SCRIPTS_ROOT}/${project?.slug}/${s.filename}`;
      if (fs.existsSync(slugByFilename)) {
        return { testCaseId: s.testCaseId, scriptPath: slugByFilename };
      }
      // Fall back to sourceRef-based slug path
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
      // Last resort: projectId-based path
      const cuidPath = `${SCRIPTS_ROOT}/${projectId}/${s.filename}`;
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
  const { name, stages } = parsed.data;
  const suite = await prisma.suite.create({
    data: {
      projectId,
      name,
      stages: JSON.stringify(stages),
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
  if (parsed.data.stages !== undefined) data.stages = JSON.stringify(parsed.data.stages);

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
  const { environment, parallelWorkers, headless, browser, record, name } = parsed.data;

  // 2. Load suite and decode its stages
  const suite = await prisma.suite.findFirst({ where: { id: suiteId, projectId } });
  if (!suite) return res.status(404).json({ error: 'Suite not found' });

  type StageDefinition = { useCaseTag: string; mode: 'sequential' | 'parallel'; testCaseIds?: string[] };
  let stageDefs: StageDefinition[];
  try {
    stageDefs = JSON.parse(suite.stages) as StageDefinition[];
  } catch {
    return res.status(500).json({ error: 'Suite stages data is corrupted — re-save the suite.' });
  }

  if (stageDefs.length === 0) {
    return res.status(400).json({ error: `Suite "${suite.name}" has no stages. Add use cases to the suite first.` });
  }

  // 3. For each stage, fetch TCs ordered by sortOrder and resolve script paths
  const allTestCaseIds: string[] = [];
  const allSkippedTcIds: string[] = [];
  const resolvedStages: Array<{ useCaseTag: string; mode: 'sequential' | 'parallel'; testCaseIds: string[]; scriptPaths: string[] }> = [];

  for (const stageDef of stageDefs) {
    let stageTcIds: string[];
    if (stageDef.testCaseIds && stageDef.testCaseIds.length > 0) {
      // Use the explicit TC list saved in the stage, but re-fetch sortOrder to preserve run order
      const tcs = await prisma.testCase.findMany({
        where: { id: { in: stageDef.testCaseIds }, projectId, status: { in: ['APPROVED', 'DRAFT'] } },
        select: { id: true },
        orderBy: { sortOrder: 'asc' },
      });
      stageTcIds = tcs.map((t) => t.id);
    } else {
      // Fall back to all TCs in the use case, sorted by sortOrder
      const tcs = await prisma.testCase.findMany({
        where: { projectId, useCaseTag: stageDef.useCaseTag, status: { in: ['APPROVED', 'DRAFT'] } },
        select: { id: true },
        orderBy: { sortOrder: 'asc' },
      });
      stageTcIds = tcs.map((t) => t.id);
    }
    const rawResolved = await resolveScriptPaths(projectId, stageTcIds);
    // Preserve sortOrder sequence
    const scriptPathMap = new Map(rawResolved.map((r) => [r.testCaseId, r.scriptPath]));
    const resolved = stageTcIds
      .filter((id) => scriptPathMap.has(id))
      .map((id) => ({ testCaseId: id, scriptPath: scriptPathMap.get(id)! }));
    const scriptedIds = new Set(resolved.map((r) => r.testCaseId));
    const skipped = stageTcIds.filter((id) => !scriptedIds.has(id));

    allTestCaseIds.push(...resolved.map((r) => r.testCaseId));
    allSkippedTcIds.push(...skipped);

    if (resolved.length > 0) {
      resolvedStages.push({
        useCaseTag: stageDef.useCaseTag,
        mode: stageDef.mode,
        testCaseIds: resolved.map((r) => r.testCaseId),
        scriptPaths: resolved.map((r) => r.scriptPath),
      });
    }
  }

  if (allTestCaseIds.length === 0) {
    return res.status(400).json({
      error: `None of the test cases in suite "${suite.name}" have automation scripts. Generate scripts first.`,
    });
  }

  // 4. Build run record
  const envConfig = await getEnvConfig(projectId, environment);
  const runSeq   = await nextRunSeq();
  const runName  = name ?? `Suite: ${suite.name} — ${environment}`;

  // Ensure parallelWorkers is at least the number of parallel stages so every
  // parallel stage gets its own actor slot and none are queued behind others.
  const parallelStageCount = resolvedStages.filter((s) => s.mode === 'parallel').length;
  const effectiveParallelWorkers = Math.max(parallelWorkers, parallelStageCount);

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

  // 5. Enqueue the job with stage info for stage-aware execution
  await addRunJob({
    runId:          run.id,
    runSeq,
    projectId,
    testCaseIds:    allTestCaseIds,
    scriptPaths:    resolvedStages.flatMap((s) => s.scriptPaths),
    skippedTcIds:   allSkippedTcIds,
    stages:         resolvedStages,
    environment,
    envBaseUrl:     envConfig.baseUrl,
    envUsername:    envConfig.username,
    envPassword:    envConfig.password,
    parallelWorkers: effectiveParallelWorkers,
    headless,
    browser,
    triggerType:    'SUITE',
    record:         record && req.project.videoEnabled !== false,
  });

  // 6. Return run record so the caller can poll status
  return res.status(201).json({
    run,
    meta: {
      totalStages:    resolvedStages.length,
      scriptedCount:  allTestCaseIds.length,
      skippedCount:   allSkippedTcIds.length,
      ...(allSkippedTcIds.length > 0 && {
        warning: `${allSkippedTcIds.length} test case(s) skipped — no automation script found.`,
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
