import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import path from 'path';
import fs from 'fs';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  DeleteProjectSchema,
  CreateMemberSchema,
  UpdateMemberSchema,
  CreateEnvConfigSchema,
  UpdateEnvConfigSchema,
} from '../lib/validation.js';

const router = Router();

// ── RBAC helper — checks project-level ADMIN role ──────────────────────────

function requireProjectAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user.globalRole === 'SUPER_ADMIN') {
    next();
    return;
  }
  if (!req.projectMember || req.projectMember.role !== 'ADMIN') {
    res.status(403).json({ error: 'Project ADMIN role is required for this action' });
    return;
  }
  next();
}

// ── Slug generator ─────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ── File helpers for project cloning ───────────────────────────────────────

function cloneDirRecursive(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dst, entry);
    if (fs.statSync(s).isDirectory()) {
      cloneDirRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

const TEXT_EXTS_CLONE = new Set(['.robot', '.resource', '.py', '.yaml', '.yml', '.txt', '.cfg', '.ini', '.tsv', '.csv']);

function replaceSlugInDir(dir: string, oldSlug: string, newSlug: string): void {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      replaceSlugInDir(full, oldSlug, newSlug);
    } else if (TEXT_EXTS_CLONE.has(path.extname(entry).toLowerCase())) {
      try {
        const content = fs.readFileSync(full, 'utf-8');
        if (content.includes(oldSlug)) {
          fs.writeFileSync(full, content.split(oldSlug).join(newSlug), 'utf-8');
        }
      } catch { /* skip unreadable / binary */ }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC-PROJECT ROUTES  (auth only, no project membership check)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/projects — list all projects the authenticated user is a member of
router.get('/', verifyToken as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const isSuperAdmin = req.user.globalRole === 'SUPER_ADMIN';

    const projects = await prisma.project.findMany({
      where: isSuperAdmin ? undefined : { members: { some: { userId: req.user.id } } },
      include: {
        _count: {
          select: {
            testCases: true,
            tcItems: true,
            members: true,
            runs: true,
          },
        },
        envConfigs: { orderBy: { isDefault: 'desc' } },
        members: {
          where: { userId: req.user.id },
          select: { role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      projects: projects.map((p) => ({
        ...p,
        myRole: p.members[0]?.role ?? (isSuperAdmin ? 'ADMIN' : null),
        members: undefined, // remove raw members array from response
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects — create a new project
router.post('/', verifyToken as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }

    const { name, description, baseUrl, color, reqLibraryPath } = parsed.data;
    const slug = parsed.data.slug ?? toSlug(name);

    // Validate slug uniqueness
    const existing = await prisma.project.findUnique({ where: { slug } });
    if (existing) {
      res.status(409).json({ error: 'A project with this slug already exists', slug });
      return;
    }

    const project = await prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          name,
          slug,
          description,
          baseUrl: baseUrl || undefined,
          color: color ?? '#22d3ee',
          reqLibraryPath,
          createdBy: req.user.id,
        },
      });

      // Creator is automatically an ADMIN
      await tx.projectMember.create({
        data: { projectId: p.id, userId: req.user.id, role: 'ADMIN' },
      });

      return p;
    });

    res.status(201).json({ project });
  } catch (err) {
    next(err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PER-PROJECT ROUTES  (/api/projects/:projectId/...)
// All routes below require: verifyToken → requireProjectAccess
// ══════════════════════════════════════════════════════════════════════════════

const projectRouter = Router({ mergeParams: true });

projectRouter.use(verifyToken as RequestHandler);
projectRouter.use(requireProjectAccess as unknown as RequestHandler);

// ── Project CRUD ───────────────────────────────────────────────────────────

// GET /api/projects/:projectId
projectRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.project.id },
      include: {
        envConfigs: { orderBy: { isDefault: 'desc' } },
        _count: { select: { members: true, testCases: true, tcItems: true, runs: true, scripts: true } },
      },
    });

    res.json({ project });
  } catch (err) {
    next(err);
  }
});

// PUT /api/projects/:projectId
projectRouter.put(
  '/',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = UpdateProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
        return;
      }

      const { name, description, baseUrl, color, reqLibraryPath, videoEnabled } = parsed.data;

      const updated = await prisma.project.update({
        where: { id: req.project.id },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(baseUrl !== undefined && { baseUrl: baseUrl || null }),
          ...(color !== undefined && { color }),
          ...(reqLibraryPath !== undefined && { reqLibraryPath }),
          ...(videoEnabled !== undefined && { videoEnabled }),
        },
      });

      res.json({ project: updated });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/projects/:projectId
// Requires project name confirmation to prevent accidental deletion
projectRouter.delete(
  '/',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = DeleteProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
        return;
      }

      if (parsed.data.confirmName !== req.project.name) {
        res.status(400).json({
          error: 'Project name confirmation does not match',
          expected: req.project.name,
        });
        return;
      }

      // Cascade delete handles all child records via Prisma relations
      await prisma.project.delete({ where: { id: req.project.id } });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// ── Members ────────────────────────────────────────────────────────────────

// GET /api/projects/:projectId/users/search?q= — search registered users for member autocomplete
projectRouter.get(
  '/users/search',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = (req.query.q as string ?? '').trim();
      if (!q || q.length < 2) {
        res.json({ users: [] });
        return;
      }
      const existingMemberIds = (
        await prisma.projectMember.findMany({
          where: { projectId: req.project.id },
          select: { userId: true },
        })
      ).map((m) => m.userId);

      const users = await prisma.user.findMany({
        where: {
          id: { notIn: existingMemberIds },
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, email: true },
        take: 8,
        orderBy: { email: 'asc' },
      });
      res.json({ users });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/projects/:projectId/members — list all members of a project
projectRouter.get('/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const members = await prisma.projectMember.findMany({
      where: { projectId: req.project.id },
      include: { user: { select: { id: true, name: true, email: true, globalRole: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ members });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/:projectId/members — add a member by email
projectRouter.post(
  '/members',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CreateMemberSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
        return;
      }

      const { email, role } = parsed.data;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        res.status(404).json({ error: `No user found with email "${email}"` });
        return;
      }

      // Check for existing membership
      const existing = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: req.project.id, userId: user.id } },
      });
      if (existing) {
        res.status(409).json({ error: 'User is already a member of this project' });
        return;
      }

      const member = await prisma.projectMember.create({
        data: { projectId: req.project.id, userId: user.id, role },
        include: { user: { select: { id: true, name: true, email: true } } },
      });

      res.status(201).json({ member });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/projects/:projectId/members/:uid — remove a member
projectRouter.delete(
  '/members/:uid',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.params;

      // Prevent removing yourself if you are the only ADMIN
      const adminCount = await prisma.projectMember.count({
        where: { projectId: req.project.id, role: 'ADMIN' },
      });
      const targetMember = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: req.project.id, userId: uid } },
      });

      if (!targetMember) {
        res.status(404).json({ error: 'Member not found in this project' });
        return;
      }

      if (targetMember.role === 'ADMIN' && adminCount <= 1) {
        res.status(400).json({ error: 'Cannot remove the last ADMIN from a project' });
        return;
      }

      await prisma.projectMember.delete({
        where: { projectId_userId: { projectId: req.project.id, userId: uid } },
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/projects/:projectId/members/:uid — change a member's role
projectRouter.put(
  '/members/:uid',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = UpdateMemberSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
        return;
      }

      const { uid } = req.params;
      const { role } = parsed.data;

      const existing = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: req.project.id, userId: uid } },
      });
      if (!existing) {
        res.status(404).json({ error: 'Member not found in this project' });
        return;
      }

      // Prevent removing last ADMIN by demoting them
      if (existing.role === 'ADMIN' && role !== 'ADMIN') {
        const adminCount = await prisma.projectMember.count({
          where: { projectId: req.project.id, role: 'ADMIN' },
        });
        if (adminCount <= 1) {
          res.status(400).json({ error: 'Cannot demote the last ADMIN of a project' });
          return;
        }
      }

      const updated = await prisma.projectMember.update({
        where: { projectId_userId: { projectId: req.project.id, userId: uid } },
        data: { role },
        include: { user: { select: { id: true, name: true, email: true } } },
      });

      res.json({ member: updated });
    } catch (err) {
      next(err);
    }
  },
);

// ── Environments ───────────────────────────────────────────────────────────

// GET /api/projects/:projectId/envs
projectRouter.get('/envs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const isAdmin =
      req.user.globalRole === 'SUPER_ADMIN' ||
      req.user.globalRole === 'ADMIN' ||
      req.projectMember?.role === 'ADMIN';

    const envs = await prisma.envConfig.findMany({
      where: { projectId: req.project.id },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });

    // Only project ADMINs and global admins receive the raw password; all other
    // roles receive a masked placeholder so they know a password exists without
    // being able to read it.
    const sanitized = envs.map((e) => ({
      ...e,
      password: isAdmin ? e.password : e.password ? '••••••••' : null,
    }));

    res.json({ envs: sanitized });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/:projectId/envs
projectRouter.post(
  '/envs',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CreateEnvConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
        return;
      }

      const { name, baseUrl, username, password, isDefault } = parsed.data;

      // If new env is default, clear other defaults first
      if (isDefault) {
        await prisma.envConfig.updateMany({
          where: { projectId: req.project.id, isDefault: true },
          data: { isDefault: false },
        });
      }

      const env = await prisma.envConfig.create({
        data: {
          projectId: req.project.id,
          name,
          baseUrl,
          username: username ?? null,
          password: password ?? null,
          isDefault: isDefault ?? false,
        },
      });

      res.status(201).json({ env });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/projects/:projectId/envs/:id
projectRouter.put(
  '/envs/:id',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = UpdateEnvConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
        return;
      }

      const { id } = req.params;

      const existing = await prisma.envConfig.findFirst({
        where: { id, projectId: req.project.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Environment not found' });
        return;
      }

      // If setting as default, clear others
      if (parsed.data.isDefault === true) {
        await prisma.envConfig.updateMany({
          where: { projectId: req.project.id, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }

      const updated = await prisma.envConfig.update({
        where: { id },
        data: parsed.data,
      });

      res.json({ env: updated });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/projects/:projectId/envs/:id
projectRouter.delete(
  '/envs/:id',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const existing = await prisma.envConfig.findFirst({
        where: { id, projectId: req.project.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Environment not found' });
        return;
      }

      await prisma.envConfig.delete({ where: { id } });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /clone — duplicate project (TCs, scripts, files; no runs/reports) ──
projectRouter.post(
  '/clone',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const src = req.project;
      const { name, slug: rawSlug, color } = req.body as { name?: string; slug?: string; color?: string };

      if (!name?.trim()) {
        res.status(400).json({ error: 'name is required' });
        return;
      }

      const newSlug = rawSlug?.trim() ? toSlug(rawSlug.trim()) : toSlug(name.trim());

      const conflict = await prisma.project.findUnique({ where: { slug: newSlug } });
      if (conflict) {
        res.status(409).json({ error: 'A project with this slug already exists', slug: newSlug });
        return;
      }

      const SCRIPTS_ROOT = process.env.SCRIPTS_ROOT ?? '/scripts';
      const srcDir = path.join(SCRIPTS_ROOT, src.slug);
      const dstDir = path.join(SCRIPTS_ROOT, newSlug);

      // ── DB copy (transaction) ──────────────────────────────────────────────
      const newProject = await prisma.$transaction(async (tx) => {
        const p = await tx.project.create({
          data: {
            name: name.trim(),
            slug: newSlug,
            description: src.description,
            baseUrl: src.baseUrl,
            color: color ?? src.color,
            createdBy: req.user.id,
          },
        });

        await tx.projectMember.create({
          data: { projectId: p.id, userId: req.user.id, role: 'ADMIN' },
        });

        // Env configs
        const envs = await tx.envConfig.findMany({ where: { projectId: src.id } });
        for (const e of envs) {
          await tx.envConfig.create({
            data: { projectId: p.id, name: e.name, baseUrl: e.baseUrl, username: e.username, password: e.password, isDefault: e.isDefault },
          });
        }

        // TestCases — build ID map
        const tcs = await tx.testCase.findMany({ where: { projectId: src.id } });
        const tcMap = new Map<string, string>(); // oldId → newId
        for (const tc of tcs) {
          const nt = await tx.testCase.create({
            data: {
              projectId: p.id, tcId: tc.tcId, title: tc.title,
              description: tc.description, steps: tc.steps,
              expectedResult: tc.expectedResult, type: tc.type,
              tags: tc.tags, useCaseTag: tc.useCaseTag,
              status: tc.status, priority: tc.priority,
            },
          });
          tcMap.set(tc.id, nt.id);
        }

        // Scripts — replace slug in content
        const scripts = await tx.script.findMany({ where: { projectId: src.id } });
        for (const s of scripts) {
          const newTcId = s.testCaseId ? (tcMap.get(s.testCaseId) ?? null) : null;
          const newContent = s.content.includes(src.slug)
            ? s.content.split(src.slug).join(newSlug)
            : s.content;
          await tx.script.create({
            data: { projectId: p.id, testCaseId: newTcId, filename: s.filename, content: newContent, scriptType: s.scriptType, isCustomUpload: s.isCustomUpload },
          });
        }

        // TcItems
        const items = await tx.tcItem.findMany({ where: { projectId: src.id } });
        for (const item of items) {
          const newLinked = item.linkedScriptId ? (tcMap.get(item.linkedScriptId) ?? null) : null;
          await tx.tcItem.create({
            data: { projectId: p.id, srNo: item.srNo, module: item.module, feature: item.feature, title: item.title, description: item.description, steps: item.steps, expectedResult: item.expectedResult, linkedScriptId: newLinked },
          });
        }

        // ProjectResources (metadata only — files copied on disk below)
        const resources = await tx.projectResource.findMany({ where: { projectId: src.id } });
        for (const r of resources) {
          await tx.projectResource.create({
            data: { projectId: p.id, filename: r.filename, originalName: r.originalName, size: r.size },
          });
        }

        return p;
      }, { timeout: 120_000 });

      // ── File copy (disk) ───────────────────────────────────────────────────
      if (fs.existsSync(srcDir)) {
        cloneDirRecursive(srcDir, dstDir);
        replaceSlugInDir(dstDir, src.slug, newSlug);
      }

      res.status(201).json({ project: newProject });
    } catch (err) {
      next(err);
    }
  },
);

// ── Mount sub-router ───────────────────────────────────────────────────────
router.use('/:projectId', projectRouter);

export default router;
