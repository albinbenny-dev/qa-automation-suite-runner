import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import toast from 'react-hot-toast';
import Topbar from '../components/layout/Topbar';
import { useProjectStore } from '../stores/projectStore';
import {
  useAdminUsers,
  useUpdateUserRole,
  useResetUserPassword,
  useDeleteUser,
  type AdminUser,
} from '../hooks/useAdminUsers';
import { getInitials } from '../lib/utils';
import { ROLES } from '../lib/roles';

const LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '1.2px',
  textTransform: 'uppercase' as const,
  color: 'var(--text-mid)',
  marginBottom: '6px',
};

// ── Reset Password Dialog ──────────────────────────────────────────────────
function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUser | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const resetPassword = useResetUserPassword();
  const [newPassword, setNewPassword]     = useState('');
  const [confirmPw, setConfirmPw]         = useState('');
  const [showPw, setShowPw]               = useState(false);

  function handleClose() {
    setNewPassword('');
    setConfirmPw('');
    onOpenChange(false);
  }

  async function handleSubmit() {
    if (!user) return;
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPw) {
      toast.error('Passwords do not match.');
      return;
    }
    try {
      await resetPassword.mutateAsync({ userId: user.id, newPassword });
      toast.success(`Password reset for ${user.name}.`);
      handleClose();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast.error(axiosErr.response?.data?.error ?? 'Failed to reset password.');
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(6,34,74,0.6)',
            backdropFilter: 'blur(4px)',
            zIndex: 9998,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Dialog.Content
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: '28px',
              width: '400px',
              maxWidth: '96vw',
              zIndex: 9999,
              fontFamily: 'var(--font-ui)',
            }}
          >
            <Dialog.Title style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text)', marginBottom: '4px' }}>
              Reset Password
            </Dialog.Title>
            <Dialog.Description style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '20px' }}>
              Set a new password for <strong style={{ color: 'var(--cyan)' }}>{user?.name}</strong> ({user?.email})
            </Dialog.Description>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={LABEL_STYLE}>New Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    className="input-field"
                    type={showPw ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    style={{ fontFamily: 'var(--font-mono)', paddingRight: '36px', width: '100%', boxSizing: 'border-box' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', color: 'var(--text-dim)', padding: 0 }}
                  >{showPw ? '🙈' : '👁'}</button>
                </div>
              </div>
              <div>
                <label style={LABEL_STYLE}>Confirm Password</label>
                <input
                  className="input-field"
                  type={showPw ? 'text' : 'password'}
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
                  placeholder="Repeat password"
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
                {confirmPw && newPassword !== confirmPw && (
                  <p style={{ marginTop: '4px', fontSize: '10px', color: 'var(--fail)', fontFamily: 'var(--font-mono)' }}>
                    Passwords do not match
                  </p>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '24px' }}>
              <Dialog.Close asChild>
                <button type="button" className="tb-btn tb-btn-ghost">Cancel</button>
              </Dialog.Close>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!newPassword || !confirmPw || resetPassword.isPending}
                style={{
                  padding: '8px 18px',
                  background: 'linear-gradient(135deg, #F47B20, #D9601A)',
                  border: 'none', borderRadius: '6px',
                  color: '#fff', fontSize: '13px', fontWeight: 700,
                  cursor: !newPassword || !confirmPw || resetPassword.isPending ? 'not-allowed' : 'pointer',
                  opacity: !newPassword || !confirmPw || resetPassword.isPending ? 0.6 : 1,
                }}
              >
                {resetPassword.isPending ? 'Resetting…' : 'Reset Password'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Role Permissions Matrix ────────────────────────────────────────────────

type PermRow = {
  section: string;
  feature: string;
  SUPER_ADMIN: boolean;
  ADMIN: boolean;
  SUPER_USER: boolean;
  STANDARD_USER: boolean;
};

const PERMISSIONS: PermRow[] = [
  // Platform
  { section: 'Platform',  feature: 'User Management',   SUPER_ADMIN: true,  ADMIN: false, SUPER_USER: false, STANDARD_USER: false },
  { section: 'Platform',  feature: 'All Projects',       SUPER_ADMIN: true,  ADMIN: true,  SUPER_USER: false, STANDARD_USER: false },
  { section: 'Platform',  feature: 'AI Usage',           SUPER_ADMIN: true,  ADMIN: true,  SUPER_USER: true,  STANDARD_USER: true  },
  // Overview
  { section: 'Overview',  feature: 'Dashboard',          SUPER_ADMIN: true,  ADMIN: true,  SUPER_USER: true,  STANDARD_USER: true  },
  { section: 'Overview',  feature: 'TC Library',         SUPER_ADMIN: true,  ADMIN: true,  SUPER_USER: true,  STANDARD_USER: true  },
  // Agents
  { section: 'Agents',    feature: 'Test Writer',        SUPER_ADMIN: true,  ADMIN: true,  SUPER_USER: true,  STANDARD_USER: true  },
  { section: 'Agents',    feature: 'Script Agent',       SUPER_ADMIN: true,  ADMIN: true,  SUPER_USER: true,  STANDARD_USER: true  },
  { section: 'Agents',    feature: 'Execution',          SUPER_ADMIN: true,  ADMIN: true,  SUPER_USER: true,  STANDARD_USER: true  },
  { section: 'Agents',    feature: 'Scheduler',          SUPER_ADMIN: true,  ADMIN: true,  SUPER_USER: true,  STANDARD_USER: true  },
  { section: 'Agents',    feature: 'UI Scanner',         SUPER_ADMIN: true,  ADMIN: true,  SUPER_USER: true,  STANDARD_USER: false },
  { section: 'Agents',    feature: 'Healing Agent',      SUPER_ADMIN: true,  ADMIN: true,  SUPER_USER: true,  STANDARD_USER: false },
  // Analytics
  { section: 'Analytics', feature: 'Reports',            SUPER_ADMIN: true,  ADMIN: true,  SUPER_USER: true,  STANDARD_USER: true  },
  { section: 'Analytics', feature: 'Chat Agent',         SUPER_ADMIN: true,  ADMIN: true,  SUPER_USER: true,  STANDARD_USER: true  },
  // Project Tools
  { section: 'Project Tools', feature: 'Copy / Export',  SUPER_ADMIN: true,  ADMIN: true,  SUPER_USER: true,  STANDARD_USER: true  },
  { section: 'Project Tools', feature: 'Project Settings', SUPER_ADMIN: true, ADMIN: true, SUPER_USER: false, STANDARD_USER: false },
  { section: 'Project Tools', feature: 'Member Management', SUPER_ADMIN: true, ADMIN: true, SUPER_USER: false, STANDARD_USER: false },
];

function PermCell({ allowed }: { allowed: boolean }) {
  return (
    <td style={{ textAlign: 'center', padding: '8px 6px' }}>
      {allowed ? (
        <span style={{ color: 'var(--pass)', fontSize: '14px', fontWeight: 700 }}>✓</span>
      ) : (
        <span style={{ color: 'var(--fail)', fontSize: '13px', opacity: 0.6 }}>✕</span>
      )}
    </td>
  );
}

function RolePermissionsMatrix() {
  const sections = [...new Set(PERMISSIONS.map((p) => p.section))];

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ minWidth: '600px' }}>
        <thead>
          <tr>
            <th style={{ width: '90px', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>Section</th>
            <th style={{ minWidth: '140px' }}>Feature</th>
            {ROLES.map((r) => (
              <th key={r.key} style={{ textAlign: 'center', minWidth: '110px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                  <span className={`badge ${r.badge}`} style={{ fontSize: '9px', letterSpacing: '0.5px' }}>
                    {r.icon} {r.label}
                  </span>
                  <span style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontWeight: 400 }}>
                    {r.tier}
                  </span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => {
            const rows = PERMISSIONS.filter((p) => p.section === section);
            return rows.map((row, idx) => (
              <tr key={row.feature}>
                {idx === 0 && (
                  <td
                    rowSpan={rows.length}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '9px',
                      fontWeight: 700,
                      letterSpacing: '1px',
                      textTransform: 'uppercase',
                      color: 'var(--text-dim)',
                      verticalAlign: 'middle',
                      paddingLeft: '14px',
                      borderRight: '1px solid var(--border)',
                      background: 'var(--surface2)',
                    }}
                  >
                    {section}
                  </td>
                )}
                <td style={{ fontFamily: 'var(--font-ui)', fontSize: '12px', color: 'var(--text-mid)', paddingLeft: '14px' }}>
                  {row.feature}
                </td>
                <PermCell allowed={row.SUPER_ADMIN} />
                <PermCell allowed={row.ADMIN} />
                <PermCell allowed={row.SUPER_USER} />
                <PermCell allowed={row.STANDARD_USER} />
              </tr>
            ));
          })}
        </tbody>
      </table>

      {/* Role descriptions */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', padding: '16px 14px', borderTop: '1px solid var(--border)' }}>
        {ROLES.map((r) => (
          <div key={r.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flex: 1, minWidth: '200px' }}>
            <span className={`badge ${r.badge}`} style={{ flexShrink: 0, marginTop: '1px', fontSize: '9px' }}>
              {r.icon} {r.label}
            </span>
            <p style={{ fontSize: '11px', color: 'var(--text-dim)', lineHeight: 1.5, margin: 0 }}>{r.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function UserManagement() {
  const { currentUser } = useProjectStore();
  const { data: users = [], isLoading } = useAdminUsers();
  const updateRole  = useUpdateUserRole();
  const deleteUser  = useDeleteUser();

  const [deletingId, setDeletingId]           = useState<string | null>(null);
  const [resetTarget, setResetTarget]         = useState<AdminUser | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [changingRoleId, setChangingRoleId]   = useState<string | null>(null);

  // SUPER_ADMIN guard — shouldn't reach here without it, but belt-and-suspenders
  if (currentUser?.globalRole !== 'SUPER_ADMIN') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', padding: '40px' }}>
        <div style={{ fontSize: '48px' }}>🔒</div>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)' }}>Access Denied</h1>
        <p style={{ fontSize: '12px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>Super Admin role required.</p>
      </div>
    );
  }

  async function handleRoleChange(userId: string, globalRole: string) {
    try {
      await updateRole.mutateAsync({ userId, globalRole });
      setChangingRoleId(null);
      toast.success('Global role updated.');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast.error(axiosErr.response?.data?.error ?? 'Failed to update role.');
    }
  }

  async function handleDelete(userId: string) {
    try {
      await deleteUser.mutateAsync(userId);
      setDeletingId(null);
      toast.success('User deleted.');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast.error(axiosErr.response?.data?.error ?? 'Failed to delete user.');
    }
  }

  const totalUsers       = users.length;
  const superAdminCount  = users.filter((u) => u.globalRole === 'SUPER_ADMIN').length;
  const adminCount       = users.filter((u) => u.globalRole === 'ADMIN').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Topbar
        breadcrumbs={[
          { label: 'Admin' },
          { label: '👥 User Management' },
        ]}
      />

      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Page header */}
        <div>
          <div className="page-eyebrow">Administration</div>
          <h1 className="page-title">User Management</h1>
          <p className="page-sub">Manage user accounts, roles, and access across the platform.</p>
        </div>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
          {[
            { label: 'Total Users',    value: totalUsers,                              color: 'var(--cyan)' },
            { label: 'Super Admins',   value: superAdminCount,                         color: 'var(--6d-orange)' },
            { label: 'Admins',         value: adminCount,                              color: 'var(--pass)' },
            { label: 'Project Users',  value: totalUsers - superAdminCount - adminCount, color: 'var(--violet)' },
          ].map((s) => (
            <div key={s.label} className="stat-card" style={{ padding: '14px' }}>
              <div className="stat-label">{s.label}</div>
              <div className="stat-value" style={{ fontSize: '24px', color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Users table */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">All Users</div>
            <span className="badge badge-draft">{totalUsers}</span>
          </div>
          <div style={{ height: '380px', overflowY: 'auto' }}>
          <table className="data-table">
            <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)' }}>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Global Role</th>
                <th>Projects</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                    Loading users…
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isSelf = u.id === currentUser?.id;
                  return (
                    <tr key={u.id}>
                      {/* Name + avatar */}
                      <td className="primary">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div
                            style={{
                              width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
                              background: u.globalRole === 'SUPER_ADMIN'
                                ? 'linear-gradient(135deg, var(--6d-orange), #D9601A)'
                                : 'linear-gradient(135deg, var(--violet), var(--cyan))',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '11px', fontWeight: 700, color: '#fff',
                            }}
                          >
                            {getInitials(u.name)}
                          </div>
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
                              {u.name}
                              {isSelf && (
                                <span style={{ marginLeft: '6px', fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--cyan)', background: 'var(--cyan-dim)', padding: '1px 5px', borderRadius: '8px', border: '1px solid rgba(34,211,238,0.3)' }}>
                                  YOU
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Email */}
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-mid)' }}>
                        {u.email}
                      </td>

                      {/* Global Role */}
                      <td>
                        {changingRoleId === u.id ? (
                          <select
                            className="input-field"
                            defaultValue={u.globalRole}
                            autoFocus
                            onChange={(e) => void handleRoleChange(u.id, e.target.value)}
                            onBlur={() => setChangingRoleId(null)}
                            style={{ fontSize: '11px', padding: '3px 8px', width: '160px', fontFamily: 'var(--font-ui)' }}
                          >
                            <option value="SUPER_ADMIN">⭐ SUPER_ADMIN</option>
                            <option value="ADMIN">🛡 ADMIN</option>
                            <option value="SUPER_USER">👤 SUPER_USER</option>
                            <option value="STANDARD_USER">👥 STANDARD_USER</option>
                          </select>
                        ) : (
                          <button
                            type="button"
                            className={`badge ${
                              u.globalRole === 'SUPER_ADMIN' ? 'badge-cyan' :
                              u.globalRole === 'ADMIN' ? 'badge-pass' : 'badge-draft'
                            }`}
                            title={isSelf ? 'Cannot change own role' : 'Click to change role'}
                            onClick={() => { if (!isSelf) setChangingRoleId(u.id); }}
                            style={{
                              cursor: isSelf ? 'not-allowed' : 'pointer',
                              border: 'none', background: 'none',
                              opacity: isSelf ? 0.7 : 1,
                            }}
                          >
                            {u.globalRole === 'SUPER_ADMIN' ? '⭐ SUPER_ADMIN' :
                             u.globalRole === 'ADMIN' ? '🛡 ADMIN' :
                             u.globalRole === 'SUPER_USER' ? '👤 SUPER_USER' : '👥 STANDARD_USER'}
                            {!isSelf && ' ✎'}
                          </button>
                        )}
                      </td>

                      {/* Project count */}
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-mid)' }}>
                        {u._count.memberships}
                      </td>

                      {/* Joined date */}
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-dim)' }}>
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>

                      {/* Actions */}
                      <td>
                        {deletingId === u.id ? (
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <span style={{ fontSize: '10px', color: 'var(--fail)' }}>Delete?</span>
                            <button
                              className="tb-btn tb-btn-ghost"
                              style={{ padding: '3px 8px', fontSize: '10px', color: 'var(--rose)', borderColor: 'rgba(220,38,38,0.3)' }}
                              onClick={() => void handleDelete(u.id)}
                              disabled={deleteUser.isPending}
                            >Yes</button>
                            <button
                              className="tb-btn tb-btn-ghost"
                              style={{ padding: '3px 8px', fontSize: '10px' }}
                              onClick={() => setDeletingId(null)}
                            >No</button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              className="tb-btn tb-btn-ghost"
                              style={{ padding: '4px 10px', fontSize: '11px' }}
                              onClick={() => { setResetTarget(u); setResetDialogOpen(true); }}
                            >
                              🔑 Reset PW
                            </button>
                            <button
                              className="tb-btn tb-btn-ghost"
                              style={{
                                padding: '4px 10px', fontSize: '11px',
                                color: isSelf ? 'var(--text-dim)' : 'var(--rose)',
                                borderColor: isSelf ? 'var(--border)' : 'rgba(220,38,38,0.3)',
                                cursor: isSelf ? 'not-allowed' : 'pointer',
                              }}
                              onClick={() => { if (!isSelf) setDeletingId(u.id); }}
                              disabled={isSelf}
                              title={isSelf ? 'Cannot delete your own account' : 'Remove user'}
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        </div>

        {/* Role Permissions Matrix */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Role Permissions</div>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              Platform &amp; project-level access control
            </span>
          </div>
          <RolePermissionsMatrix />
        </div>
      </div>

      {/* Reset Password Dialog */}
      <ResetPasswordDialog
        user={resetTarget}
        open={resetDialogOpen}
        onOpenChange={(v) => {
          setResetDialogOpen(v);
          if (!v) setResetTarget(null);
        }}
      />
    </div>
  );
}
