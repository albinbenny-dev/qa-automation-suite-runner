import { Request, Response, NextFunction } from 'express';

export type ProjectRole = 'ADMIN' | 'SUPER_USER' | 'STANDARD_USER';

/**
 * requireRole — project-level RBAC gate.
 *
 * Must run after verifyToken + requireProjectAccess (which sets req.projectMember).
 * SUPER_ADMIN global role bypasses all project-level role checks.
 *
 * Role hierarchy (spec):
 *   ADMIN         — all operations including member management and project deletion
 *   SUPER_USER    — full feature access for allocated project; no member management or project deletion
 *   STANDARD_USER — read/write TCs, scripts, runs, scheduler, reports, chat; no UI Scanner or Healing
 *
 * @param roles — project roles that are allowed to perform this action
 *
 * @example
 *   // Only project ADMIN may delete:
 *   router.delete('/:id', requireProjectAccess, requireRole(['ADMIN']), handler);
 *
 *   // ADMIN or SUPER_USER may access advanced features:
 *   router.post('/scan', requireProjectAccess, requireAdvancedFeatures, handler);
 */
export function requireRole(roles: ProjectRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // SUPER_ADMIN and ADMIN bypass all project-level role restrictions
    if (req.user?.globalRole === 'SUPER_ADMIN' || req.user?.globalRole === 'ADMIN') {
      next();
      return;
    }

    const memberRole = req.projectMember?.role as ProjectRole | undefined;

    if (!memberRole) {
      res.status(403).json({ error: 'Project membership required' });
      return;
    }

    if (!roles.includes(memberRole)) {
      res.status(403).json({
        error: 'Insufficient permissions for this action',
        required: roles,
        current: memberRole,
      });
      return;
    }

    next();
  };
}

/**
 * requireWrite — all project members may mutate.
 * Equivalent to requireRole(['ADMIN', 'SUPER_USER', 'STANDARD_USER']).
 */
export const requireWrite = requireRole(['ADMIN', 'SUPER_USER', 'STANDARD_USER']);

/**
 * requireAdvancedFeatures — restricts UI Scanner and Healing Agent to ADMIN and SUPER_USER.
 * STANDARD_USER does not have access to these features.
 */
export const requireAdvancedFeatures = requireRole(['ADMIN', 'SUPER_USER']);

/**
 * requireAdmin — restricts to project ADMIN only.
 * Use for: project deletion, member management, env config changes.
 * Equivalent to requireRole(['ADMIN']).
 */
export const requireAdmin = requireRole(['ADMIN']);
