import cron from 'node-cron';
import { prisma } from './prisma.js';
import { addRunJob } from './queue.js';

const jobs = new Map<string, cron.ScheduledTask>();

export async function loadSchedules(): Promise<void> {
  try {
    const schedules = await prisma.schedule.findMany({
      where: { isActive: true },
      include: { project: { select: { baseUrl: true } } },
    });
    for (const schedule of schedules) {
      registerSchedule(schedule);
    }
    console.log(`[scheduler] Loaded ${schedules.length} active schedule(s)`);
  } catch (err) {
    console.error('[scheduler] Failed to load schedules:', err);
  }
}

interface ScheduleRow {
  id: string;
  projectId: string;
  name: string;
  cronExpression: string;
  testCaseIds: string;
  environment: string;
  project?: { baseUrl?: string | null } | null;
}

export function registerSchedule(schedule: ScheduleRow): void {
  if (jobs.has(schedule.id)) {
    jobs.get(schedule.id)?.stop();
    jobs.delete(schedule.id);
  }

  if (!cron.validate(schedule.cronExpression)) {
    console.warn(`[scheduler] Invalid cron for schedule ${schedule.id}: "${schedule.cronExpression}"`);
    return;
  }

  const task = cron.schedule(schedule.cronExpression, async () => {
    console.log(`[scheduler] Firing schedule "${schedule.name}" (${schedule.id})`);
    try {
      const testCaseIds: string[] = JSON.parse(schedule.testCaseIds);
      if (testCaseIds.length === 0) return;

      const scripts = await prisma.script.findMany({
        where: { projectId: schedule.projectId, testCaseId: { in: testCaseIds } },
        select: { filename: true, testCaseId: true },
      });

      const scriptedIds = new Set(scripts.map((s) => s.testCaseId).filter(Boolean) as string[]);
      const skippedTcIds = testCaseIds.filter((id) => !scriptedIds.has(id));
      const scriptedTcIds = testCaseIds.filter((id) => scriptedIds.has(id));

      const envConfig = await prisma.envConfig.findFirst({
        where: { projectId: schedule.projectId, name: schedule.environment },
        select: { baseUrl: true, username: true, password: true },
      });

      const seqAgg = await prisma.run.aggregate({ _max: { runSeq: true } });
      const runSeq = (seqAgg._max.runSeq ?? 0) + 1;

      const run = await prisma.run.create({
        data: {
          projectId: schedule.projectId,
          runSeq,
          name: `Scheduled: ${schedule.name}`,
          environment: schedule.environment,
          status: 'PENDING',
          triggerType: 'SCHEDULED',
        },
      });

      await addRunJob({
        runId: run.id,
        runSeq,
        projectId: schedule.projectId,
        testCaseIds: scriptedTcIds,
        scriptPaths: scriptedTcIds.map((id) => {
          const s = scripts.find((sc) => sc.testCaseId === id);
          return `/scripts/${schedule.projectId}/${s!.filename}`;
        }),
        skippedTcIds,
        environment: schedule.environment,
        envBaseUrl: envConfig?.baseUrl ?? schedule.project?.baseUrl ?? '',
        envUsername: envConfig?.username ?? '',
        envPassword: envConfig?.password ?? '',
        parallelWorkers: 2,
        headless: true,
        browser: 'chromium',
        triggerType: 'SCHEDULED',
      });
    } catch (err) {
      console.error(`[scheduler] Error firing schedule ${schedule.id}:`, err);
    }
  });

  jobs.set(schedule.id, task);
}

export function unregisterSchedule(id: string): void {
  jobs.get(id)?.stop();
  jobs.delete(id);
}
