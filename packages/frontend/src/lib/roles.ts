export const ROLES = [
  {
    key: 'SUPER_ADMIN',
    label: 'Super Admin',
    badge: 'badge-cyan',
    icon: '⭐',
    tier: 'Platform',
    desc: 'Full platform access. Bypasses all project checks.',
  },
  {
    key: 'ADMIN',
    label: 'Admin',
    badge: 'badge-pass',
    icon: '🛡',
    tier: 'Project',
    desc: 'All features except platform user management.',
  },
  {
    key: 'SUPER_USER',
    label: 'Super User',
    badge: 'badge-draft',
    icon: '👤',
    tier: 'Project',
    desc: 'All menus accessible for allocated project.',
  },
  {
    key: 'STANDARD_USER',
    label: 'Standard User',
    badge: 'badge-draft',
    icon: '👥',
    tier: 'Project',
    desc: 'Core features only — no UI Scanner or Healing.',
  },
] as const;

export type RoleKey = (typeof ROLES)[number]['key'];

/** Project-level roles only (excludes SUPER_ADMIN) */
export const PROJECT_ROLES = ROLES.filter((r) => r.tier === 'Project');

/** Look up role metadata by key */
export function getRoleMeta(key: string) {
  return ROLES.find((r) => r.key === key);
}
