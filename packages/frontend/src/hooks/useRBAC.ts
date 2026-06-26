import { useProjectStore } from '../stores/projectStore';
import type { ProjectRole } from '../types';

interface RBACResult {
  /** The user's project-level role, or null if not a member */
  role: ProjectRole | null;
  /** True when globalRole === 'SUPER_ADMIN' — bypasses all project restrictions */
  isSuperAdmin: boolean;
  /** Project ADMIN — full control over members, deletion, all writes */
  isAdmin: boolean;
  /** SUPER_USER — full feature access for allocated project */
  isSuperUser: boolean;
  /** STANDARD_USER — read/write access; no UI Scanner or Healing Agent */
  isStandardUser: boolean;
  /** canWrite = any project role: may create/update/run/approve */
  canWrite: boolean;
  /** canManageMembers = ADMIN only */
  canManageMembers: boolean;
  /** canDeleteProject = ADMIN only */
  canDeleteProject: boolean;
  /** canAccessUIScanner = SUPER_ADMIN | ADMIN | SUPER_USER */
  canAccessUIScanner: boolean;
  /** canAccessHealing = SUPER_ADMIN | ADMIN | SUPER_USER */
  canAccessHealing: boolean;
}

/**
 * useRBAC — returns the current user's effective permissions for the active project.
 *
 * Reads `activeProject.myRole` (set by GET /projects response) and `currentUser.globalRole`.
 * SUPER_ADMIN has full access regardless of project membership.
 *
 * Usage:
 *   const { canWrite, canAccessHealing, isStandardUser } = useRBAC();
 *   {canAccessHealing && <button>Approve Heal</button>}
 *   {canWrite && <button>Save</button>}
 */
export function useRBAC(): RBACResult {
  const { currentUser, activeProject } = useProjectStore();

  const globalRole = currentUser?.globalRole;
  const isSuperAdmin = globalRole === 'SUPER_ADMIN';
  // ADMIN global role has full project access but no user management
  const isGlobalAdmin = globalRole === 'ADMIN';

  if (isSuperAdmin || isGlobalAdmin) {
    return {
      role: null,
      isSuperAdmin,
      isAdmin: true,
      isSuperUser: true,
      isStandardUser: false,
      canWrite: true,
      canManageMembers: true,
      canDeleteProject: true,
      canAccessUIScanner: true,
      canAccessHealing: true,
    };
  }

  const role = (activeProject?.myRole as ProjectRole) ?? null;

  return {
    role,
    isSuperAdmin: false,
    isAdmin: role === 'ADMIN',
    isSuperUser: role === 'SUPER_USER',
    isStandardUser: role === 'STANDARD_USER',
    canWrite: role === 'ADMIN' || role === 'SUPER_USER' || role === 'STANDARD_USER',
    canManageMembers: role === 'ADMIN',
    canDeleteProject: role === 'ADMIN',
    canAccessUIScanner: role === 'ADMIN' || role === 'SUPER_USER',
    canAccessHealing: role === 'ADMIN' || role === 'SUPER_USER',
  };
}
