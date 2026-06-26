import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';

const router = Router();
router.use(verifyToken as RequestHandler);

// ── SUPER_ADMIN guard ──────────────────────────────────────────────────────
function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user.globalRole !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'SUPER_ADMIN role is required for this action' });
    return;
  }
  next();
}

// ══════════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT ROUTES (SUPER_ADMIN only)
// ══════════════════════════════════════════════════════════════════════════════

// GET /admin/users — list all users
router.get('/users', requireSuperAdmin as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        globalRole: true,
        createdAt: true,
        _count: { select: { memberships: true } },
      },
    });
    res.json({ users });
  } catch (err) { next(err); }
});

// PUT /admin/users/:uid/role — change a user's global role
router.put('/users/:uid/role', requireSuperAdmin as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { uid } = req.params;
    const { globalRole } = req.body as { globalRole: string };

    if (!['SUPER_ADMIN', 'ADMIN', 'SUPER_USER', 'STANDARD_USER'].includes(globalRole)) {
      res.status(400).json({ error: 'globalRole must be one of: SUPER_ADMIN, ADMIN, SUPER_USER, STANDARD_USER' });
      return;
    }

    // Prevent demoting yourself away from SUPER_ADMIN
    if (uid === req.user.id && globalRole !== 'SUPER_ADMIN') {
      res.status(400).json({ error: 'You cannot change your own SUPER_ADMIN role' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: uid },
      data: { globalRole },
      select: { id: true, email: true, name: true, globalRole: true },
    });
    res.json({ user: updated });
  } catch (err) { next(err); }
});

// POST /admin/users/:uid/reset-password — set a new password for a user
router.post('/users/:uid/reset-password', requireSuperAdmin as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { uid } = req.params;
    const { newPassword } = req.body as { newPassword: string };

    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({ error: 'newPassword must be at least 8 characters' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: uid }, data: { passwordHash } });

    res.json({ ok: true, message: 'Password has been reset successfully' });
  } catch (err) { next(err); }
});

// DELETE /admin/users/:uid — delete a user
router.delete('/users/:uid', requireSuperAdmin as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { uid } = req.params;

    // Prevent deleting yourself
    if (uid === req.user.id) {
      res.status(400).json({ error: 'You cannot delete your own account' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await prisma.user.delete({ where: { id: uid } });
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
