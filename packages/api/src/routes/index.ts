import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import projectsRouter from './projects.js';
import authRouter from './auth.js';
import testCasesRouter from './testCases.js';
import scriptsRouter from './scripts.js';
import runsRouter from './runs.js';
import reportsRouter from './reports.js';
import suitesRouter from './suites.js';
import adminRouter from './admin.js';
import resourcesRouter from './resources.js';
import tcItemsRouter from './tcItems.js';
import { verifyToken } from '../middleware/auth.js';

const router = Router();

// ── Global JWT guard — all routes except /api/auth/* ──────────────────────
// Individual routers that already call verifyToken will get a no-op second
// pass (token is still valid), so this is safe to add globally.
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/auth/')) return next();
  return (verifyToken as RequestHandler)(req, res, next);
});

// ── Mounted routers ────────────────────────────────────────────────────────
router.use('/projects', projectsRouter);
router.use('/auth', authRouter);

// ── Test Cases (Stage 4) ───────────────────────────────────────────────────
router.use('/projects/:projectId/test-cases', testCasesRouter);

// ── Scripts (Stage 6) ─────────────────────────────────────────────────────
router.use('/projects/:projectId/scripts', scriptsRouter);

// ── Runs (Stage 5) ────────────────────────────────────────────────────────
router.use('/projects/:projectId/runs', runsRouter);

// ── Reports (Stage 9) ─────────────────────────────────────────────────────
router.use('/projects/:projectId/reports', reportsRouter);

// ── Suites ────────────────────────────────────────────────────────────────
router.use('/projects/:projectId/suites', suitesRouter);

// ── Admin / platform-level ────────────────────────────────────────────────
router.use('/admin', adminRouter);

// ── Robot Framework resources ─────────────────────────────────────────────
router.use('/projects/:projectId/resources', resourcesRouter);

// ── TC Library items ──────────────────────────────────────────────────────
router.use('/projects/:projectId/tc-items', tcItemsRouter);

export default router;
