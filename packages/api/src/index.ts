import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import apiRouter from './routes/index.js';
import { setRunsNamespace, setProjectsNamespace } from './lib/socket.js';
import { prisma } from './lib/prisma.js';
import { loadSchedules } from './lib/scheduler.js';
import { startRunWorker, getRunWorker } from './jobs/runWorker.js';
import { startRetentionSchedule } from './jobs/retentionWorker.js';

const app = express();
const httpServer = createServer(app);

// ── Socket.io ──────────────────────────────────────────────────────────────
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const runsNamespace = io.of('/runs');

// Authenticate every socket connection on the /runs namespace using the JWT
// passed in socket.handshake.auth.token (same token used for REST requests).
runsNamespace.use((socket, next) => {
  const token = socket.handshake.auth['token'] as string | undefined;
  if (!token) return next(new Error('auth:token-required'));
  const secret = process.env.JWT_SECRET;
  if (!secret) return next(new Error('server:misconfiguration'));
  try {
    const decoded = jwt.verify(token, secret) as { id: string; globalRole: string };
    socket.data['userId'] = decoded.id;
    socket.data['globalRole'] = decoded.globalRole;
    next();
  } catch {
    next(new Error('auth:invalid-token'));
  }
});

runsNamespace.on('connection', (socket) => {
  const userId: string = socket.data['userId'];
  const globalRole: string = socket.data['globalRole'];

  socket.on('leaveRun', ({ runId: rid }: { runId: string }) => {
    if (!rid) return;
    void socket.leave(`run:${rid}`);
  });

  socket.on('joinRun', async ({ runId: rid }: { runId: string }) => {
    if (!rid) return;

    // Verify the requesting user has access to this run's project
    try {
      const run = await prisma.run.findUnique({
        where: { id: rid },
        select: { projectId: true, status: true, results: { select: { status: true } } },
      });
      if (!run) return;

      if (globalRole !== 'SUPER_ADMIN') {
        const member = await prisma.projectMember.findFirst({
          where: { projectId: run.projectId, userId },
        });
        if (!member) {
          socket.emit('run:error', 'Access denied');
          return;
        }
      }

      void socket.join(`run:${rid}`);

      // Catch up the client if it joined after early events were already emitted
      if (run.status === 'RUNNING') {
        socket.emit('run:start', { total: run.results.length });
      } else if (run.status === 'PASSED' || run.status === 'FAILED' || run.status === 'CANCELLED') {
        const passed  = run.results.filter((r) => r.status === 'PASSED').length;
        const failed  = run.results.filter((r) => r.status === 'FAILED').length;
        const skipped = run.results.filter((r) => r.status === 'SKIPPED').length;
        socket.emit('run:complete', { passed, failed, skipped, duration: 0 });
      }
    } catch { /* run may not exist yet — ignore */ }
  });
});

// Register namespace so workers can emit without circular imports
setRunsNamespace(runsNamespace);

// ── /projects namespace — per-project events (e.g. script generation jobs) ──
const projectsNamespace = io.of('/projects');

// Require a valid JWT on every /projects connection, same as /runs.
projectsNamespace.use((socket, next) => {
  const token = socket.handshake.auth['token'] as string | undefined;
  if (!token) return next(new Error('auth:token-required'));
  const secret = process.env.JWT_SECRET;
  if (!secret) return next(new Error('server:misconfiguration'));
  try {
    const decoded = jwt.verify(token, secret) as { id: string; globalRole: string };
    socket.data['userId'] = decoded.id;
    socket.data['globalRole'] = decoded.globalRole;
    next();
  } catch {
    next(new Error('auth:invalid-token'));
  }
});

projectsNamespace.on('connection', (socket) => {
  const userId: string = socket.data['userId'];
  const globalRole: string = socket.data['globalRole'];

  const joinProjectRoom = async (pid: string) => {
    if (!pid) return;
    // SUPER_ADMIN may join any project room; others must be a member.
    if (globalRole !== 'SUPER_ADMIN') {
      const member = await prisma.projectMember.findFirst({
        where: { projectId: pid, userId },
      });
      if (!member) {
        socket.emit('project:error', 'Access denied');
        return;
      }
    }
    void socket.join(`project:${pid}`);
  };

  const projectId = socket.handshake.query['projectId'] as string | undefined;
  if (projectId) void joinProjectRoom(projectId);

  socket.on('joinProject', ({ projectId: pid }: { projectId: string }) => {
    void joinProjectRoom(pid);
  });
});

setProjectsNamespace(projectsNamespace);

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  }),
);

app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const checks: Record<string, string> = {};
  let healthy = true;

  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ]);
    checks['db'] = 'ok';
  } catch {
    checks['db'] = 'unreachable';
    healthy = false;
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    version: '1.0.0',
    timestamp: new Date(),
    uptime: process.uptime(),
    checks,
  });
});

// ── API routes ─────────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// ── 404 handler ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler ───────────────────────────────────────────────────
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error('[qa-api] Unhandled error:', err.stack ?? err.message);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  },
);

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '4000', 10);

httpServer.listen(PORT, () => {
  console.log(`[qa-api] Server running  → http://0.0.0.0:${PORT}`);
  console.log(`[qa-api] Environment     → ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`[qa-api] Socket.io       → /runs namespace ready`);

  // Cancel interrupted HEAL_RERUN runs BEFORE workers attach so stalled BullMQ
  // jobs see a terminal status and exit instead of re-executing the healing loop.
  void (async () => {
    try {
      const cleaned = await prisma.run.updateMany({
        where: { triggerType: 'HEAL_RERUN', status: { in: ['PENDING', 'RUNNING'] } },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
      if (cleaned.count > 0) {
        console.log(`[qa-api] Startup cleanup: cancelled ${cleaned.count} interrupted HEAL_RERUN run(s)`);
      }
    } catch (err) {
      console.warn('[qa-api] Startup cleanup failed (non-fatal):', (err as Error).message);
    }

    // Start BullMQ workers only after cleanup so they see the cancelled state
    if (process.env.REDIS_URL || process.env.NODE_ENV !== 'test') {
      try {
        startRunWorker();
      } catch (err) {
        console.warn('[qa-api] Workers failed to start (Redis may be unavailable):', (err as Error).message);
      }
    }

    // Load saved schedules from DB
    void loadSchedules();

    // Start nightly data-retention sweep
    startRetentionSchedule();
  })();
});

// ── Graceful shutdown ──────────────────────────────────────────────────────
function gracefulShutdown(signal: string): void {
  console.log(`[qa-api] Received ${signal} — shutting down gracefully`);

  const worker = getRunWorker();
  const shutdown = async () => {
    if (worker) {
      try {
        await worker.close();
        console.log('[qa-api] BullMQ worker drained');
      } catch (err) {
        console.error('[qa-api] Worker close error:', (err as Error).message);
      }
    }
    await prisma.$disconnect();
    httpServer.close(() => {
      console.log('[qa-api] HTTP server closed — exiting');
      process.exit(0);
    });
  };

  void shutdown();

  setTimeout(() => {
    console.error('[qa-api] Shutdown grace period expired — force exiting');
    process.exit(1);
  }, 30_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
