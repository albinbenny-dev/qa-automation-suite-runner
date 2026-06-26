import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';

/**
 * requireProjectAccess — project membership gate.
 *
 * Reads :projectId from req.params (accepts either DB cuid OR project slug).
 * Checks that req.user is a member of the project, or is a SUPER_ADMIN.
 *
 * Attaches:
 *   req.project       — the found Project row
 *   req.projectMember — the ProjectMember row (undefined for SUPER_ADMIN)
 *
 * Returns:
 *   404  Project not found
 *   403  User is not a member and is not a SUPER_ADMIN
 */
export async function requireProjectAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;
    const globalRole = req.user.globalRole;
    // SUPER_ADMIN and ADMIN both bypass project membership checks
    const bypassesMembership = globalRole === 'SUPER_ADMIN' || globalRole === 'ADMIN';

    // Support lookup by cuid OR slug
    const project = await prisma.project.findFirst({
      where: { OR: [{ id: projectId }, { slug: projectId }] },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // SUPER_ADMIN and ADMIN bypass membership check
    if (bypassesMembership) {
      req.project = project;
      next();
      return;
    }

    const member = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: { projectId: project.id, userId },
      },
    });

    if (!member) {
      res.status(403).json({ error: 'You do not have access to this project' });
      return;
    }

    req.project = project;
    req.projectMember = member;
    next();
  } catch (err) {
    next(err);
  }
}
