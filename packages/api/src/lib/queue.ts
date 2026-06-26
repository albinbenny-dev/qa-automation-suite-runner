import { Queue } from 'bullmq';

function parseRedisUrl(url: string): { host: string; port: number; password?: string; db: number } {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
      db: parseInt(parsed.pathname.replace('/', '') || '0', 10),
    };
  } catch {
    return { host: 'localhost', port: 6379, db: 0 };
  }
}

const connection = parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');

export const testRunQueue = new Queue('test-runs', { connection });

export interface RunJobPayload {
  runId: string;
  runSeq: number;
  projectId: string;
  testCaseIds: string[];
  scriptPaths: string[];
  skippedTcIds?: string[];
  environment: string;
  envBaseUrl: string;
  envUsername?: string;
  envPassword?: string;
  parallelWorkers: number;
  headless: boolean;
  browser: 'chrome' | 'firefox';
  record?: boolean;
  triggerType: 'MANUAL' | 'SCHEDULED' | 'INDIVIDUAL' | 'GROUP' | 'HEAL_RERUN';
}

export async function addRunJob(payload: RunJobPayload): Promise<void> {
  await testRunQueue.add('run', payload, {
    jobId: payload.runId,
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 50,
  });
}
