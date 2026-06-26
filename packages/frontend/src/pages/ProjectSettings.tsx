import React, { useState, useEffect } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Lock, Map, Target, ClipboardList, ScanLine } from 'lucide-react';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import {
  useProjectEnvConfigs,
  useProjectMembers,
  useAddMember,
  useRemoveMember,
  useUpdateMemberRole,
  useRequirementDocs,
  useUploadReqDoc,
  useToggleReqDoc,
  useDeleteReqDoc,
  useUpdateProject,
  useDeleteProject,
  useCreateEnvConfig,
  useDeleteEnvConfig,
  useUserSearch,
  type UserSearchResult,
} from '../hooks/useProjects';
import { useProjectStore } from '../stores/projectStore';
import { useRBAC } from '../hooks/useRBAC';
import { PROJECT_GRADIENTS, getInitials } from '../lib/utils';
import { PROJECT_ROLES, getRoleMeta } from '../lib/roles';
import {
  useScans,
  useScan,
  useProjectContext,
  useStartScan,
  useUpdateContext,
  useUpdateLoginInstructions,
  useDeleteScan,
  useQuickLoginTest,
} from '../hooks/useScans';
import ScanProgress from '../components/scanner/ScanProgress';
import LoginInstructions from '../components/scanner/LoginInstructions';
import NavigationMap from '../components/scanner/NavigationMap';

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

// ── Tab indicator shared style ─────────────────────────────────────────────
const TAB_TRIGGER_STYLE = (active: boolean): React.CSSProperties => ({
  padding: '10px 18px',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
  background: 'transparent',
  color: active ? 'var(--6d-orange)' : 'var(--text-mid)',
  borderBottom: active ? '2px solid var(--6d-orange)' : '2px solid transparent',
  transition: 'all 0.15s',
  fontFamily: 'var(--font-ui)',
  whiteSpace: 'nowrap' as const,
});

// ── Details tab ────────────────────────────────────────────────────────────
function DetailsTab() {
  const { activeProject } = useProjectStore();
  const { slug } = useParams<{ slug: string }>();
  const updateProject = useUpdateProject(activeProject?.id ?? '');
  const updateCtx     = useUpdateContext(activeProject?.id ?? '');
  const { data: context } = useProjectContext(activeProject?.id ?? '');
  const { isAdmin } = useRBAC(activeProject?.id ?? '');

  const [name, setName]       = useState(activeProject?.name ?? '');
  const [desc, setDesc]       = useState(activeProject?.description ?? '');
  const [baseUrl, setBaseUrl] = useState(activeProject?.baseUrl ?? '');
  const [colorIdx, setColorIdx] = useState(0);
  const [customInstructions, setCustomInstructions] = useState('');
  const [instructionsSaved, setInstructionsSaved] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState<boolean>(() => activeProject?.videoEnabled ?? true);

  useEffect(() => {
    if (activeProject) {
      setName(activeProject.name);
      setDesc(activeProject.description ?? '');
      setBaseUrl(activeProject.baseUrl ?? '');
      setVideoEnabled(activeProject.videoEnabled ?? true);
    }
  }, [activeProject]);

  // Pre-fill custom instructions from stored context
  useEffect(() => {
    if (context?.customInstructions != null && customInstructions === '') {
      setCustomInstructions(context.customInstructions ?? '');
    }
  }, [context?.customInstructions]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!activeProject) return;
    try {
      await updateProject.mutateAsync({ name, description: desc, baseUrl, videoEnabled });
      toast.success('Project details saved.');
    } catch {
      toast.error('Failed to save project details.');
    }
  }

  async function handleSaveInstructions() {
    try {
      await updateCtx.mutateAsync({ customInstructions: customInstructions.trim() || null });
      setInstructionsSaved(true);
      setTimeout(() => setInstructionsSaved(false), 2500);
      toast.success('AI instructions saved.');
    } catch {
      toast.error('Failed to save instructions.');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '560px' }}>
      <div>
        <label style={LABEL_STYLE}>Project Name</label>
        <input
          className="input-field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ fontFamily: 'var(--font-ui)', fontSize: '14px', fontWeight: 600 }}
        />
      </div>

      <div>
        <label style={LABEL_STYLE}>
          Slug{' '}
          <span style={{ color: 'var(--text-dim)', fontSize: '9px', fontWeight: 400, letterSpacing: 0 }}>
            (readonly after creation)
          </span>
        </label>
        <input
          className="input-field"
          value={slug ?? ''}
          readOnly
          style={{ color: 'var(--cyan)', cursor: 'not-allowed', opacity: 0.8 }}
        />
      </div>

      <div>
        <label style={LABEL_STYLE}>Description</label>
        <textarea
          className="input-field"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          style={{ minHeight: '80px', fontFamily: 'var(--font-ui)', fontSize: '13px' }}
        />
      </div>

      <div>
        <label style={LABEL_STYLE}>Base URL</label>
        <input
          className="input-field"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://app.example.com"
          style={{ fontFamily: 'var(--font-mono)' }}
        />
      </div>

      <div>
        <label style={LABEL_STYLE}>Project Color</label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '9px',
              background: PROJECT_GRADIENTS[colorIdx],
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
              color: '#fff',
              fontWeight: 800,
              cursor: 'pointer',
              border: '2px solid rgba(37,99,171,0.3)',
            }}
          >
            {getInitials(name || 'P')}
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {PROJECT_GRADIENTS.map((g, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setColorIdx(i)}
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: g,
                  border: colorIdx === i ? '2px solid var(--cyan)' : '2px solid transparent',
                  cursor: 'pointer',
                  transition: 'border 0.15s',
                }}
              />
            ))}
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
            Pick color
          </span>
        </div>
      </div>

      {isAdmin && (
        <div style={{
          padding: '16px', borderRadius: '10px',
          background: 'var(--surface2)',
          border: `1px solid ${videoEnabled ? 'rgba(245,158,11,0.3)' : 'var(--border)'}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ ...LABEL_STYLE, marginBottom: 2 }}>🎬 Video Recording</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                {videoEnabled ? 'Enabled — all runs record by default' : 'Disabled — no videos will be captured'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setVideoEnabled(v => !v)}
              style={{
                width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                background: videoEnabled ? '#f59e0b' : 'var(--surface3)',
                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
              }}
            >
              <span style={{
                position: 'absolute', top: 3, left: videoEnabled ? 23 : 3,
                width: 18, height: 18, borderRadius: '50%',
                background: '#fff', transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </button>
          </div>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={handleSave}
          disabled={updateProject.isPending}
          style={{
            padding: '9px 20px',
            background: 'linear-gradient(135deg, #F47B20, #D9601A)',
            border: 'none',
            borderRadius: '6px',
            color: '#fff',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'var(--font-ui)',
            opacity: updateProject.isPending ? 0.6 : 1,
          }}
        >
          {updateProject.isPending ? 'Saving…' : '💾 Save Changes'}
        </button>
      </div>

      {/* ── Custom AI Instructions ─────────────────────────────────────── */}
      <div
        style={{
          marginTop: '12px',
          padding: '20px',
          background: 'var(--surface2)',
          border: '1px solid rgba(108,99,255,0.25)',
          borderRadius: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <label style={{ ...LABEL_STYLE, marginBottom: 0, color: 'var(--violet)' }}>
            🧠 AI Script Instructions
          </label>
          <span
            style={{
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-dim)',
              background: 'var(--surface3)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              padding: '2px 7px',
            }}
          >
            injected into every script generation
          </span>
        </div>
        <p style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: '10px', lineHeight: 1.6 }}>
          Describe your app's login type, sidebar structure, and any known quirks. The AI reads this before
          generating every Robot script — no UI scan needed.
        </p>
        <textarea
          className="input-field"
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
          placeholder={
            '## Login\n' +
            '- Two-step Keycloak: enter username → click Login → password field appears\n' +
            '- Login selectors: css=#username / css=#password / css=#kc-login\n' +
            '- Post-login URL contains: /myProfile (takes 20-30s to load)\n\n' +
            '## Navigation\n' +
            '- Hash routing: URLs look like /#/stockManagement\n' +
            '- Sidebar is a ul/li list — use exact text match for menu clicks\n' +
            '- "Stock Creation" and "Stock Management > Stock" are different menu items\n\n' +
            '## Forms\n' +
            '- ng-select dropdowns: open with focus() + ArrowDown, NOT click()\n' +
            '- Field IDs follow pattern: css=#sixdee_field_<fieldName>'
          }
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            minHeight: '160px',
            resize: 'vertical',
            lineHeight: 1.65,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
          <button
            type="button"
            onClick={handleSaveInstructions}
            disabled={updateCtx.isPending}
            style={{
              padding: '8px 18px',
              background: instructionsSaved
                ? 'linear-gradient(135deg, #059669, #047857)'
                : 'linear-gradient(135deg, #6c63ff, #4f46e5)',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 700,
              cursor: updateCtx.isPending ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-ui)',
              opacity: updateCtx.isPending ? 0.6 : 1,
              transition: 'background 0.3s',
            }}
          >
            {updateCtx.isPending ? 'Saving…' : instructionsSaved ? '✓ Saved' : '💾 Save Instructions'}
          </button>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            {context?.customInstructions
              ? 'Last saved: ' + (context.updatedAt ? new Date(context.updatedAt).toLocaleDateString() : 'previously')
              : 'Not set yet'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Environments tab ───────────────────────────────────────────────────────
function EnvironmentsTab() {
  const { activeProject } = useProjectStore();
  const { data: envs = [] } = useProjectEnvConfigs(activeProject?.id);
  const createEnv = useCreateEnvConfig(activeProject?.id ?? '');
  const deleteEnv = useDeleteEnvConfig(activeProject?.id ?? '');

  const [newName, setNewName]         = useState('');
  const [newUrl, setNewUrl]           = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPw, setShowNewPw]     = useState(false);
  const [deletingId, setDeletingId]   = useState<string | null>(null);

  async function handleAdd() {
    const name = newName.trim();
    const baseUrl = newUrl.trim();
    if (!name || !baseUrl) return;
    try {
      await createEnv.mutateAsync({
        name,
        baseUrl: baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`,
        username: newUsername.trim() || undefined,
        password: newPassword.trim() || undefined,
      });
      setNewName(''); setNewUrl(''); setNewUsername(''); setNewPassword('');
      toast.success(`Environment "${name}" added.`);
    } catch {
      toast.error('Failed to add environment.');
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteEnv.mutateAsync(id);
      setDeletingId(null);
      toast.success('Environment deleted.');
    } catch {
      toast.error('Failed to delete environment.');
    }
  }

  const ENV_BADGE = (name: string) => {
    const n = name.toLowerCase();
    if (n === 'qa' || n === 'qa env') return 'badge-cyan';
    if (n.includes('staging') || n.includes('stage')) return 'badge-skip';
    if (n.includes('prod')) return 'badge-fail';
    return 'badge-draft';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title">Configured Environments</div>
          <span className="badge badge-draft">{envs.length}</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Base URL</th>
              <th>Credentials</th>
              <th>Default</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {envs.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                  No environments configured yet. Add one below.
                </td>
              </tr>
            ) : (
              envs.map((env) => (
                <tr key={env.id}>
                  <td className="primary">
                    <span className={`badge ${ENV_BADGE(env.name)}`}>{env.name}</span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{env.baseUrl}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                    {env.username ? (
                      <span style={{ color: 'var(--text-mid)' }}>👤 {env.username} · ••••••</span>
                    ) : (
                      <span style={{ color: 'var(--text-dim)', fontSize: '10px' }}>—</span>
                    )}
                  </td>
                  <td>
                    {env.isDefault && <span className="badge badge-pass">Default</span>}
                  </td>
                  <td>
                    {deletingId === env.id ? (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span style={{ fontSize: '10px', color: 'var(--fail)' }}>Delete?</span>
                        <button
                          className="tb-btn tb-btn-ghost"
                          style={{ padding: '3px 8px', fontSize: '10px', color: 'var(--rose)', borderColor: 'rgba(220,38,38,0.3)' }}
                          onClick={() => handleDelete(env.id)}
                        >Yes</button>
                        <button
                          className="tb-btn tb-btn-ghost"
                          style={{ padding: '3px 8px', fontSize: '10px' }}
                          onClick={() => setDeletingId(null)}
                        >No</button>
                      </div>
                    ) : (
                      <button
                        className="tb-btn tb-btn-ghost"
                        style={{ padding: '4px 10px', fontSize: '11px', color: 'var(--rose)', borderColor: 'rgba(220,38,38,0.3)' }}
                        onClick={() => setDeletingId(env.id)}
                      >Delete</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add environment form */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Add Environment</div>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: '0 0 140px' }}>
              <label style={LABEL_STYLE}>Name</label>
              <input
                className="input-field"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="QA / Staging / Dev"
                style={{ fontFamily: 'var(--font-ui)' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={LABEL_STYLE}>Base URL</label>
              <input
                className="input-field"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                placeholder="https://qa.example.com"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={LABEL_STYLE}>Username <span style={{ color: 'var(--text-dim)', fontWeight: 400, letterSpacing: 0 }}>(optional)</span></label>
              <input
                className="input-field"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="login username"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={LABEL_STYLE}>Password <span style={{ color: 'var(--text-dim)', fontWeight: 400, letterSpacing: 0 }}>(optional)</span></label>
              <div style={{ position: 'relative' }}>
                <input
                  className="input-field"
                  type={showNewPw ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                  placeholder="••••••••"
                  style={{ fontFamily: 'var(--font-mono)', width: '100%', paddingRight: '32px', boxSizing: 'border-box' }}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPw((v) => !v)}
                  style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--text-dim)', padding: 0 }}
                >{showNewPw ? '🙈' : '👁'}</button>
              </div>
            </div>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!newName.trim() || !newUrl.trim() || createEnv.isPending}
              style={{
                padding: '8px 20px',
                background: newName.trim() && newUrl.trim() ? 'var(--cyan)' : 'var(--surface3)',
                border: 'none', borderRadius: '6px', color: newName.trim() && newUrl.trim() ? '#fff' : 'var(--text-dim)',
                fontSize: '12px', fontWeight: 600, cursor: newName.trim() && newUrl.trim() ? 'pointer' : 'default',
                fontFamily: 'var(--font-ui)', flexShrink: 0,
                opacity: createEnv.isPending ? 0.6 : 1,
              }}
            >
              {createEnv.isPending ? 'Adding…' : '+ Add'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Members tab ────────────────────────────────────────────────────────────
function MembersTab() {
  const { activeProject } = useProjectStore();
  const { data: members = [], isLoading } = useProjectMembers(activeProject?.id);
  const addMember        = useAddMember(activeProject?.id ?? '');
  const removeMember     = useRemoveMember(activeProject?.id ?? '');
  const updateRole       = useUpdateMemberRole(activeProject?.id ?? '');

  const [inviteEmail, setInviteEmail]   = useState('');
  const [inviteRole, setInviteRole]     = useState<'ADMIN' | 'SUPER_USER' | 'STANDARD_USER'>('SUPER_USER');
  const [removingId, setRemovingId]     = useState<string | null>(null);
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const { data: suggestions = [] } = useUserSearch(activeProject?.id ?? '', inviteEmail);

  function selectSuggestion(u: UserSearchResult) {
    setInviteEmail(u.email);
    setShowSuggestions(false);
  }

  async function handleAddMember() {
    const email = inviteEmail.trim();
    if (!email) return;
    try {
      await addMember.mutateAsync({ email, role: inviteRole });
      setInviteEmail('');
      setInviteRole('SUPER_USER');
      toast.success(`${email} added to project as ${inviteRole.replace('_', ' ')}.`);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast.error(axiosErr.response?.data?.error ?? 'Failed to add member.');
    }
  }

  async function handleRemove(userId: string) {
    try {
      await removeMember.mutateAsync(userId);
      setRemovingId(null);
      toast.success('Member removed from project.');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast.error(axiosErr.response?.data?.error ?? 'Failed to remove member.');
    }
  }

  async function handleRoleChange(userId: string, role: string) {
    try {
      await updateRole.mutateAsync({ userId, role });
      setChangingRole(null);
      toast.success('Role updated.');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast.error(axiosErr.response?.data?.error ?? 'Failed to update role.');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title">Project Members</div>
          <span className="badge badge-draft">{members.length} {members.length === 1 ? 'member' : 'members'}</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Email</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                  Loading members…
                </td>
              </tr>
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                  No members yet. Add your team below.
                </td>
              </tr>
            ) : (
              members.map((m) => (
                <tr key={`${m.projectId}-${m.userId}`}>
                  <td className="primary">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div
                        style={{
                          width: '28px', height: '28px', borderRadius: '50%',
                          background: 'linear-gradient(135deg, var(--violet), var(--cyan))',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '10px', fontWeight: 700, color: '#fff', flexShrink: 0,
                        }}
                      >
                        {getInitials(m.user.name)}
                      </div>
                      {m.user.name}
                    </div>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{m.user.email}</td>
                  <td>
                    {changingRole === m.userId ? (
                      <select
                        className="input-field"
                        defaultValue={m.role}
                        autoFocus
                        onChange={(e) => void handleRoleChange(m.userId, e.target.value)}
                        onBlur={() => setChangingRole(null)}
                        style={{ fontSize: '11px', padding: '3px 8px', width: '140px', fontFamily: 'var(--font-ui)' }}
                      >
                        {PROJECT_ROLES.map((r) => (
                          <option key={r.key} value={r.key}>{r.icon} {r.label}</option>
                        ))}
                      </select>
                    ) : (
                      <button
                        type="button"
                        className={`badge ${getRoleMeta(m.role)?.badge ?? 'badge-draft'}`}
                        title="Click to change role"
                        onClick={() => setChangingRole(m.userId)}
                        style={{ cursor: 'pointer', border: 'none', background: 'none' }}
                      >
                        {getRoleMeta(m.role)?.icon} {getRoleMeta(m.role)?.label ?? m.role} ✎
                      </button>
                    )}
                  </td>
                  <td>
                    {removingId === m.userId ? (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span style={{ fontSize: '10px', color: 'var(--fail)' }}>Remove?</span>
                        <button
                          className="tb-btn tb-btn-ghost"
                          style={{ padding: '3px 8px', fontSize: '10px', color: 'var(--rose)', borderColor: 'rgba(220,38,38,0.3)' }}
                          onClick={() => void handleRemove(m.userId)}
                          disabled={removeMember.isPending}
                        >Yes</button>
                        <button
                          className="tb-btn tb-btn-ghost"
                          style={{ padding: '3px 8px', fontSize: '10px' }}
                          onClick={() => setRemovingId(null)}
                        >No</button>
                      </div>
                    ) : (
                      <button
                        className="tb-btn tb-btn-ghost"
                        style={{ padding: '4px 10px', fontSize: '11px', color: 'var(--rose)', borderColor: 'rgba(220,38,38,0.3)' }}
                        onClick={() => setRemovingId(m.userId)}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add member form */}
      <div className="card" style={{ overflow: 'visible' }}>
        <div className="card-header">
          <div className="card-title">Add Member by Email</div>
        </div>
        <div className="card-body">
          <p style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: '12px', lineHeight: 1.5 }}>
            The user must have a registered account before they can be added to a project.
          </p>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={LABEL_STYLE}>Email Address</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="input-field"
                  value={inviteEmail}
                  onChange={(e) => { setInviteEmail(e.target.value); setShowSuggestions(true); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { setShowSuggestions(false); void handleAddMember(); }
                    if (e.key === 'Escape') setShowSuggestions(false);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  placeholder="colleague@company.com"
                  type="email"
                  autoComplete="off"
                  style={{ fontFamily: 'var(--font-ui)', width: '100%' }}
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                    background: 'var(--surface2)', border: '1px solid var(--border)',
                    borderRadius: '6px', marginTop: '4px', boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                    overflow: 'hidden',
                  }}>
                    {suggestions.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onMouseDown={() => selectSuggestion(u)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '10px',
                          width: '100%', padding: '8px 12px', background: 'none',
                          border: 'none', borderBottom: '1px solid var(--border)',
                          cursor: 'pointer', textAlign: 'left',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface3)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      >
                        <div style={{
                          width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
                          background: 'linear-gradient(135deg, var(--violet), var(--cyan))',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '10px', fontWeight: 700, color: '#fff',
                        }}>
                          {getInitials(u.name)}
                        </div>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>{u.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{u.email}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div style={{ width: '150px' }}>
              <label style={LABEL_STYLE}>Role</label>
              <select
                className="input-field"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}
                style={{ fontFamily: 'var(--font-ui)', fontSize: '13px' }}
              >
                {PROJECT_ROLES.map((r) => (
                  <option key={r.key} value={r.key}>{r.icon} {r.label}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => void handleAddMember()}
              disabled={!inviteEmail.trim() || addMember.isPending}
              style={{
                padding: '8px 16px',
                background: inviteEmail.trim() ? 'var(--cyan)' : 'var(--surface3)',
                border: 'none', borderRadius: '6px',
                color: inviteEmail.trim() ? '#fff' : 'var(--text-dim)',
                fontSize: '12px', fontWeight: 600,
                cursor: inviteEmail.trim() && !addMember.isPending ? 'pointer' : 'default',
                fontFamily: 'var(--font-ui)', flexShrink: 0,
                opacity: addMember.isPending ? 0.6 : 1,
              }}
            >
              {addMember.isPending ? 'Adding…' : '+ Add Member'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Req Library tab ────────────────────────────────────────────────────────
function ReqLibraryTab() {
  const { activeProject } = useProjectStore();
  const projectId = activeProject?.id ?? '';
  const { data: docs = [] } = useRequirementDocs(projectId);
  const uploadDoc  = useUploadReqDoc(projectId);
  const toggleDoc  = useToggleReqDoc(projectId);
  const deleteDoc  = useDeleteReqDoc(projectId);
  const [folderPath, setFolderPath] = useState(activeProject?.reqLibraryPath ?? '');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const TYPE_BADGE: Record<string, string> = {
    pdf: 'badge-fail',
    xlsx: 'badge-pass',
    docx: 'badge-cyan',
    md: 'badge-draft',
    txt: 'badge-draft',
  };

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await uploadDoc.mutateAsync(file);
      toast.success(`${file.name} uploaded.`);
    } catch {
      toast.error('Upload failed.');
    }
  }

  async function handleToggle(id: string, current: boolean) {
    try {
      await toggleDoc.mutateAsync({ id, isActive: !current });
    } catch {
      toast.error('Failed to update document.');
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteDoc.mutateAsync(id);
      setDeletingId(null);
      toast.success('Document deleted.');
    } catch {
      toast.error('Failed to delete document.');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.xlsx,.xls,.docx,.doc,.txt,.md"
        style={{ display: 'none' }}
        onChange={handleUpload}
      />

      {/* Info banner */}
      <div
        style={{
          padding: '12px 16px',
          background: 'var(--violet-dim)',
          border: '1px solid rgba(244,123,32,0.2)',
          borderRadius: 'var(--radius)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <span style={{ fontSize: '18px' }}>📁</span>
        <p style={{ fontSize: '12px', color: 'var(--text-mid)', lineHeight: 1.55 }}>
          <strong style={{ color: 'var(--violet)' }}>Auto-loaded by Writer Agent on every run.</strong>
          {' '}All active documents in this library are injected as background context whenever test cases are generated — you never need to re-upload the same document twice.
        </p>
      </div>

      {/* Source path */}
      <div className="card">
        <div className="card-header">
          <div className="card-title" style={{ color: 'var(--violet)' }}>📁 Source Path</div>
        </div>
        <div className="card-body">
          <label style={LABEL_STYLE}>Requirement Documents Folder Path</label>
          <input
            className="input-field"
            value={folderPath}
            onChange={(e) => setFolderPath(e.target.value)}
            placeholder="/requirements/airtel-ventas"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
          <p style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            Absolute path inside the qa-reqdocs volume where HLD, BRD, PRD, and API spec files are stored.
          </p>
        </div>
      </div>

      {/* Documents list */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Active Documents</div>
          <button
            type="button"
            className="tb-btn tb-btn-ghost"
            style={{ fontSize: '11px', padding: '4px 10px' }}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadDoc.isPending}
          >
            {uploadDoc.isPending ? 'Uploading…' : '+ Upload'}
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Filename</th>
              <th>Type</th>
              <th>Active</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{
                    textAlign: 'center',
                    padding: '24px',
                    color: 'var(--text-dim)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                  }}
                >
                  No requirement documents yet. Upload your HLD, BRD, PRD, or API specs.
                </td>
              </tr>
            ) : (
              docs.map((doc) => {
                const ext = doc.filename.split('.').pop()?.toLowerCase() ?? 'txt';
                return (
                  <tr key={doc.id}>
                    <td className="primary" style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                      {doc.filename}
                    </td>
                    <td>
                      <span className={`badge ${TYPE_BADGE[ext] ?? 'badge-draft'}`}>{ext.toUpperCase()}</span>
                    </td>
                    <td>
                      <div
                        onClick={() => void handleToggle(doc.id, doc.isActive)}
                        style={{
                          width: '36px',
                          height: '20px',
                          borderRadius: '100px',
                          background: doc.isActive ? 'var(--pass)' : 'var(--surface3)',
                          cursor: 'pointer',
                          transition: 'background 0.2s',
                          position: 'relative',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            top: '3px',
                            left: doc.isActive ? '18px' : '3px',
                            width: '14px',
                            height: '14px',
                            borderRadius: '50%',
                            background: '#fff',
                            transition: 'left 0.2s',
                          }}
                        />
                      </div>
                    </td>
                    <td>
                      {deletingId === doc.id ? (
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <span style={{ fontSize: '10px', color: 'var(--fail)' }}>Delete?</span>
                          <button
                            className="tb-btn tb-btn-ghost"
                            style={{ padding: '3px 8px', fontSize: '10px', color: 'var(--rose)', borderColor: 'rgba(220,38,38,0.3)' }}
                            onClick={() => void handleDelete(doc.id)}
                          >Yes</button>
                          <button
                            className="tb-btn tb-btn-ghost"
                            style={{ padding: '3px 8px', fontSize: '10px' }}
                            onClick={() => setDeletingId(null)}
                          >No</button>
                        </div>
                      ) : (
                        <button
                          className="tb-btn tb-btn-ghost"
                          style={{ padding: '4px 10px', fontSize: '11px', color: 'var(--rose)', borderColor: 'rgba(220,38,38,0.3)' }}
                          onClick={() => setDeletingId(doc.id)}
                        >
                          Delete
                        </button>
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
  );
}

// ── Danger zone tab ────────────────────────────────────────────────────────
function DangerZoneTab() {
  const { activeProject } = useProjectStore();
  const navigate = useNavigate();
  const deleteProject = useDeleteProject(activeProject?.id ?? '');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  function handleOpenChange(open: boolean) {
    setDeleteOpen(open);
    if (!open) setConfirmed(false);
  }

  async function handleDelete() {
    try {
      await deleteProject.mutateAsync(activeProject!.name);
      toast.success('Project deleted.');
      navigate('/projects', { replace: true });
    } catch {
      toast.error('Failed to delete project.');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '560px' }}>
      {/* Archive */}
      <div
        style={{
          padding: '20px',
          border: '1px solid rgba(244,123,32,0.3)',
          borderRadius: 'var(--radius-lg)',
          background: 'rgba(244,123,32,0.03)',
        }}
      >
        <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--amber)', marginBottom: '6px' }}>
          Archive Project
        </h3>
        <p style={{ fontSize: '12px', color: 'var(--text-mid)', marginBottom: '14px', lineHeight: 1.55 }}>
          Archiving makes this project read-only. All test cases, scripts, and run history are preserved. You can unarchive at any time.
        </p>
        <button
          type="button"
          style={{
            padding: '8px 18px',
            border: '1px solid rgba(244,123,32,0.4)',
            borderRadius: '6px',
            background: 'transparent',
            color: 'var(--amber)',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'var(--font-ui)',
          }}
        >
          Archive Project
        </button>
      </div>

      {/* Delete */}
      <div
        style={{
          padding: '20px',
          border: '1px solid rgba(220,38,38,0.3)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--rose-dim)',
        }}
      >
        <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--rose)', marginBottom: '6px' }}>
          Delete Project
        </h3>
        <p style={{ fontSize: '12px', color: 'var(--text-mid)', marginBottom: '14px', lineHeight: 1.55 }}>
          Permanently deletes the project and all associated test cases, scripts, run history, and files.{' '}
          <strong style={{ color: 'var(--rose)' }}>This cannot be undone.</strong>
        </p>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          style={{
            padding: '8px 18px',
            border: '1px solid rgba(220,38,38,0.4)',
            borderRadius: '6px',
            background: 'transparent',
            color: 'var(--rose)',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'var(--font-ui)',
          }}
        >
          🗑 Delete Project
        </button>
      </div>

      {/* Confirm delete dialog */}
      <Dialog.Root open={deleteOpen} onOpenChange={handleOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(6,34,74,0.6)',
              backdropFilter: 'blur(4px)',
              zIndex: 9998,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Dialog.Content
              style={{
                background: 'var(--surface)',
                border: '1px solid rgba(220,38,38,0.3)',
                borderRadius: 'var(--radius-lg)',
                padding: '28px',
                width: '400px',
                maxWidth: '96vw',
                zIndex: 9999,
                fontFamily: 'var(--font-ui)',
              }}
            >
              <Dialog.Title
                style={{ fontSize: '16px', fontWeight: 800, color: 'var(--rose)', marginBottom: '8px' }}
              >
                Delete "{activeProject?.name}"?
              </Dialog.Title>

              {!confirmed ? (
                <>
                  <Dialog.Description
                    style={{ fontSize: '13px', color: 'var(--text-mid)', marginBottom: '24px', lineHeight: 1.6 }}
                  >
                    This will permanently delete all test cases, scripts, run history, heals, and reports.{' '}
                    <strong style={{ color: 'var(--rose)' }}>This cannot be undone.</strong>
                  </Dialog.Description>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <Dialog.Close asChild>
                      <button type="button" className="tb-btn tb-btn-ghost">No, keep it</button>
                    </Dialog.Close>
                    <button
                      type="button"
                      onClick={() => setConfirmed(true)}
                      style={{
                        padding: '8px 18px', background: 'transparent',
                        border: '1px solid rgba(220,38,38,0.5)', borderRadius: '6px',
                        color: 'var(--rose)', fontSize: '13px', fontWeight: 700,
                        cursor: 'pointer', fontFamily: 'var(--font-ui)',
                      }}
                    >
                      Yes, delete it
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <Dialog.Description
                    style={{ fontSize: '13px', color: 'var(--text-mid)', marginBottom: '24px', lineHeight: 1.6 }}
                  >
                    Are you absolutely sure? There is no going back.
                  </Dialog.Description>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="tb-btn tb-btn-ghost"
                      onClick={() => setConfirmed(false)}
                    >
                      Go back
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleteProject.isPending}
                      style={{
                        padding: '8px 18px', background: 'var(--rose)',
                        border: 'none', borderRadius: '6px',
                        color: '#fff', fontSize: '13px', fontWeight: 700,
                        cursor: deleteProject.isPending ? 'not-allowed' : 'pointer',
                        fontFamily: 'var(--font-ui)',
                        opacity: deleteProject.isPending ? 0.7 : 1,
                      }}
                    >
                      {deleteProject.isPending ? 'Deleting…' : 'Delete Forever'}
                    </button>
                  </div>
                </>
              )}
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

// ── Login Verifier card (shared between idle and complete scanner states) ──

interface LoginVerifierCardProps {
  selectedEnv: { name?: string; baseUrl?: string } | undefined;
  testLoginLoading: boolean;
  loginVerified: boolean;
  testLoginResult: { success: boolean; finalUrl?: string; errorMessage?: string; screenshotBase64?: string } | null;
  screenshotExpanded: boolean;
  onVerify: () => void;
  onExpandScreenshot: (v: boolean) => void;
  disabled: boolean;
}

function LoginVerifierCard({
  selectedEnv,
  testLoginLoading,
  loginVerified,
  testLoginResult,
  screenshotExpanded,
  onVerify,
  onExpandScreenshot,
  disabled,
}: LoginVerifierCardProps) {
  return (
    <div className="card" style={{ position: 'relative', overflow: 'visible' }}>
      <div
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '4px',
          background: loginVerified
            ? 'linear-gradient(90deg, var(--pass), #059669)'
            : 'linear-gradient(90deg, #2563AB, #0A2A57)',
          borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
        }}
      />
      <div className="card-header" style={{ paddingTop: '18px' }}>
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>🔐</span>
          <span>Step 1 — Verify Login</span>
          {loginVerified && (
            <span style={{
              fontSize: '10px', fontWeight: 600, color: 'var(--pass)',
              background: 'var(--emerald-dim)', border: '1px solid rgba(42,157,143,0.3)',
              padding: '2px 8px', borderRadius: '10px', fontFamily: 'var(--font-mono)',
            }}>
              ✓ Verified
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onVerify}
          disabled={testLoginLoading || disabled}
          style={{
            padding: '6px 14px', fontSize: '12px', fontWeight: 700,
            background: testLoginLoading
              ? 'var(--surface3)'
              : loginVerified
              ? 'linear-gradient(135deg, #059669, #047857)'
              : 'linear-gradient(135deg, #2563AB, #0A2A57)',
            border: 'none', borderRadius: '6px', color: '#fff',
            cursor: testLoginLoading || disabled ? 'not-allowed' : 'pointer',
            opacity: testLoginLoading || disabled ? 0.6 : 1,
          }}
        >
          {testLoginLoading ? 'Verifying…' : loginVerified ? '↺ Re-verify' : '▶ Verify Login'}
        </button>
      </div>
      <div className="card-body">
        {!testLoginResult && !testLoginLoading && (
          <p style={{ fontSize: '12px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontStyle: 'italic' }}>
            {selectedEnv
              ? <>Testing credentials for <strong style={{ color: 'var(--text-mid)' }}>{selectedEnv.name}</strong> ({selectedEnv.baseUrl}). Click "Verify Login" to confirm the login flow works before scanning.</>
              : 'Select an environment in Scan Configuration, then click Verify Login.'}
          </p>
        )}
        {testLoginLoading && (
          <p style={{ fontSize: '12px', color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>
            Running Playwright login detection… this may take 15–30 seconds.
          </p>
        )}
        {testLoginResult && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{
              padding: '10px 14px', borderRadius: 'var(--radius)',
              background: testLoginResult.success ? 'var(--emerald-dim)' : 'var(--rose-dim)',
              border: `1px solid ${testLoginResult.success ? 'rgba(42,157,143,0.25)' : 'rgba(220,38,38,0.25)'}`,
              display: 'flex', alignItems: 'flex-start', gap: '10px',
            }}>
              <span style={{ fontSize: '20px' }}>{testLoginResult.success ? '✓' : '✕'}</span>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: testLoginResult.success ? 'var(--emerald)' : 'var(--rose)' }}>
                  {testLoginResult.success ? 'Login successful — instructions saved' : 'Login failed'}
                </div>
                {testLoginResult.success && testLoginResult.finalUrl && (
                  <div style={{ fontSize: '11px', color: 'var(--text-mid)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>
                    Landed at: {testLoginResult.finalUrl}
                  </div>
                )}
                {!testLoginResult.success && testLoginResult.errorMessage && (
                  <div style={{ fontSize: '11px', color: 'var(--rose)', fontFamily: 'var(--font-mono)', marginTop: 3, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {testLoginResult.errorMessage.slice(0, 300)}
                  </div>
                )}
              </div>
            </div>
            {testLoginResult.screenshotBase64 && (
              <>
                <div style={{ position: 'relative', cursor: 'zoom-in' }} onClick={() => onExpandScreenshot(true)}>
                  <img
                    src={`data:image/jpeg;base64,${testLoginResult.screenshotBase64}`}
                    alt="Post-login screenshot"
                    style={{
                      width: '100%', maxHeight: '260px', objectFit: 'contain', objectPosition: 'top',
                      borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'block',
                    }}
                  />
                  <div style={{
                    position: 'absolute', bottom: 6, right: 8,
                    fontSize: '10px', fontFamily: 'var(--font-mono)', color: '#fff',
                    background: 'rgba(0,0,0,0.55)', padding: '2px 6px', borderRadius: 4,
                  }}>
                    click to expand
                  </div>
                </div>
                {screenshotExpanded && (
                  <div
                    onClick={() => onExpandScreenshot(false)}
                    style={{
                      position: 'fixed', inset: 0, zIndex: 9999,
                      background: 'rgba(0,0,0,0.85)',
                      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                      overflowY: 'auto', padding: '24px', cursor: 'zoom-out',
                    }}
                  >
                    <img
                      src={`data:image/jpeg;base64,${testLoginResult.screenshotBase64}`}
                      alt="Post-login screenshot (full)"
                      style={{ maxWidth: '100%', borderRadius: 8, boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── UI Scanner tab ─────────────────────────────────────────────────────────
function UIScannerTab() {
  const { activeProject } = useProjectStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectId = activeProject?.id ?? '';
  const projectSlug = activeProject?.slug ?? '';

  const { data: envConfigs = [] } = useProjectEnvConfigs(projectId);
  const { data: scans = [] } = useScans(projectId);
  const { data: context } = useProjectContext(projectId);

  const latestScan = scans[0] ?? null;
  const isRunning = latestScan?.status === 'RUNNING' || latestScan?.status === 'PENDING';
  const isComplete = latestScan?.status === 'COMPLETED';
  const latestScanId = latestScan?.id;

  // When a scan completes, the project-context query may be stuck in a 404
  // error state from before the scan ran. Force a refetch so the complete
  // view gets data without requiring a page reload.
  useEffect(() => {
    if (isComplete) {
      void queryClient.invalidateQueries({ queryKey: ['project-context', projectId] });
    }
  }, [isComplete, projectId, queryClient]);

  // Poll the active scan
  const { data: liveScan } = useScan(projectId, isRunning ? latestScanId : undefined);
  const activeScan = isRunning && liveScan ? liveScan : latestScan;

  const startScan = useStartScan(projectId);
  const updateCtx = useUpdateContext(projectId);
  const updateLogin = useUpdateLoginInstructions(projectId);
  const deleteScan = useDeleteScan(projectId);
  const quickLoginTestMutation = useQuickLoginTest(projectId);

  const [selectedEnvId, setSelectedEnvId] = useState<string>('');
  const [scanDepth, setScanDepth] = useState<'full' | 'top-level' | 'login-only'>('full');
  const [generateTCs, setGenerateTCs] = useState(true);
  const [customInstructions, setCustomInstructions] = useState('');
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testLoginResult, setTestLoginResult] = useState<{
    success: boolean;
    finalUrl?: string;
    errorMessage?: string;
    screenshotBase64?: string;
  } | null>(null);
  const [testLoginLoading, setTestLoginLoading] = useState(false);
  const [loginVerified, setLoginVerified] = useState(false);
  const [screenshotExpanded, setScreenshotExpanded] = useState(false);

  async function handleTestLogin() {
    if (!projectId || !selectedEnvId) return;
    setTestLoginLoading(true);
    setTestLoginResult(null);
    try {
      const data = await quickLoginTestMutation.mutateAsync(selectedEnvId);
      setTestLoginResult(data);
      if (data.success) {
        setLoginVerified(true);
        toast.success('Login verified — instructions saved. Ready to scan.');
      } else {
        setLoginVerified(false);
        toast.error('Login failed — check the result below');
      }
    } catch (err: unknown) {
      const axiosErr = err as { code?: string; response?: { data?: { error?: string } }; message?: string };
      const msg = axiosErr.response?.data?.error
        ?? (axiosErr.code === 'ECONNABORTED' ? 'Request timed out — Playwright took too long. Try again.' : null)
        ?? axiosErr.message
        ?? 'Login verification failed';
      toast.error(msg);
      setTestLoginResult({ success: false, errorMessage: msg });
      setLoginVerified(false);
    } finally {
      setTestLoginLoading(false);
    }
  }

  // Pre-fill the textarea from stored context on first load
  useEffect(() => {
    if (context?.customInstructions && !customInstructions) {
      setCustomInstructions(context.customInstructions);
    }
  }, [context?.customInstructions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedEnvId && envConfigs.length > 0) {
      setSelectedEnvId(envConfigs.find((e) => e.isDefault)?.id ?? envConfigs[0].id);
    }
  }, [envConfigs, selectedEnvId]);

  const selectedEnv = envConfigs.find((e) => e.id === selectedEnvId)
    ?? envConfigs.find((e) => e.isDefault)
    ?? envConfigs[0];

  async function handleStartScan() {
    if (!selectedEnvId) { toast.error('Please select an environment'); return; }
    try {
      const result = await startScan.mutateAsync({
        envConfigId: selectedEnvId,
        scanDepth,
        generateTCs,
        customInstructions: customInstructions.trim() || undefined,
      });
      toast.success(`Scan started (ID: ${result.scanId.slice(0, 8)}…)`);
    } catch {
      toast.error('Failed to start scan.');
    }
  }

  async function handleDeleteScan(id: string) {
    try {
      await deleteScan.mutateAsync(id);
      setDeletingId(null);
      toast.success('Scan deleted.');
    } catch {
      toast.error('Failed to delete scan.');
    }
  }

  function formatDuration(scan: typeof latestScan) {
    if (!scan?.startedAt || !scan?.completedAt) return '—';
    const ms = new Date(scan.completedAt).getTime() - new Date(scan.startedAt).getTime();
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }

  function statusDot(status: string) {
    const colors: Record<string, string> = {
      COMPLETED: 'var(--pass)',
      FAILED: 'var(--fail)',
      RUNNING: 'var(--6d-orange)',
      PENDING: 'var(--text-dim)',
    };
    return (
      <span
        style={{
          display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
          background: colors[status] ?? 'var(--text-dim)', marginRight: '6px', flexShrink: 0,
        }}
      />
    );
  }

  const useCaseSummary = context?.useCaseSummary ?? [];

  // ── Running state ────────────────────────────────────────────────────────
  if (isRunning && activeScan) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <ScanProgress scan={activeScan} />
      </div>
    );
  }

  // ── Complete state ───────────────────────────────────────────────────────
  if (isComplete && !context) {
    return (
      <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
        Loading scan results…
      </div>
    );
  }

  if (isComplete && context) {
    const scanDate = context.updatedAt ? new Date(context.updatedAt).toLocaleDateString() : '';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Login Verifier — Step 1 at top */}
        <LoginVerifierCard
          selectedEnv={selectedEnv}
          testLoginLoading={testLoginLoading}
          loginVerified={loginVerified}
          testLoginResult={testLoginResult}
          screenshotExpanded={screenshotExpanded}
          onVerify={handleTestLogin}
          onExpandScreenshot={setScreenshotExpanded}
          disabled={!selectedEnvId}
        />

        {/* Success banner */}
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--emerald-dim)',
            border: '1px solid rgba(42,157,143,0.2)',
            borderRadius: 'var(--radius)',
            display: 'flex', alignItems: 'center', gap: '10px',
          }}
        >
          <span style={{ fontSize: '18px' }}>✓</span>
          <p style={{ fontSize: '12px', color: 'var(--text-mid)', lineHeight: 1.55 }}>
            Scan completed in{' '}
            <strong style={{ color: 'var(--text)' }}>{formatDuration(latestScan)}</strong>.
            {' '}{latestScan?.pagesScanned ?? 0} pages · {useCaseSummary.length} use cases
          </p>
        </div>

        {/* Stat tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px' }}>
          {[
            { label: 'Pages Scanned',     value: latestScan?.pagesScanned ?? 0, color: 'var(--cyan)' },
            { label: 'Menus Mapped',       value: context.navigationMap?.length ?? 0, color: 'var(--6d-orange)' },
            { label: 'Locators',           value: Object.keys(context.pageLocators ?? {}).length, color: 'var(--emerald)' },
            { label: 'Use Cases Found',    value: useCaseSummary.length, color: 'var(--violet)' },
          ].map((tile) => (
            <div key={tile.label} className="stat-card" style={{ padding: '14px' }}>
              <div className="stat-label">{tile.label}</div>
              <div className="stat-value" style={{ fontSize: '24px', color: tile.color }}>{tile.value}</div>
            </div>
          ))}
        </div>

        {/* Two-column: login + nav map */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <LoginInstructions
            instructions={context.loginInstructions}
            onSave={(updated) => { void updateLogin.mutateAsync(updated).then(() => toast.success('Login instructions saved.')).catch(() => toast.error('Failed to save.')); }}
            isSaving={updateLogin.isPending}
            scanDate={scanDate}
            envConfigName={selectedEnv?.name}
          />
          <NavigationMap navMap={context.navigationMap} pagesScanned={latestScan?.pagesScanned ?? 0} />
        </div>

        {/* Custom instructions card */}
        <div className="card" style={{ position: 'relative', overflow: 'visible' }}>
          <div
            style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: '4px',
              background: 'linear-gradient(90deg, #FFB347, #F47B20)',
              borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
            }}
          />
          <div className="card-header" style={{ paddingTop: '18px' }}>
            <div className="card-title">
              <ScanLine size={14} color="var(--6d-orange)" />
              Custom Instructions
            </div>
            {!editingInstructions && (
              <button
                type="button"
                className="tb-btn tb-btn-ghost"
                style={{ fontSize: '11px', padding: '4px 10px' }}
                onClick={() => { setInstructionsDraft(context.customInstructions ?? ''); setEditingInstructions(true); }}
              >
                Edit
              </button>
            )}
          </div>
          <div className="card-body">
            {editingInstructions ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <textarea
                  className="input-field"
                  value={instructionsDraft}
                  onChange={(e) => setInstructionsDraft(e.target.value)}
                  style={{ fontFamily: 'var(--font-ui)', fontSize: '13px', minHeight: '100px', resize: 'vertical', lineHeight: 1.6 }}
                  placeholder="Describe how to reach the main navigation after login…"
                />
                <p style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
                  Used by the scanner on next run to navigate to the correct context, and injected into every AI agent as project knowledge.
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      void updateCtx.mutateAsync({ customInstructions: instructionsDraft.trim() || null })
                        .then(() => { toast.success('Instructions saved.'); setEditingInstructions(false); setCustomInstructions(instructionsDraft); })
                        .catch(() => toast.error('Failed to save.'));
                    }}
                    disabled={updateCtx.isPending}
                    style={{
                      padding: '6px 16px', fontSize: '12px', fontWeight: 700,
                      background: 'linear-gradient(135deg, #F47B20, #D9601A)',
                      border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer',
                      opacity: updateCtx.isPending ? 0.6 : 1,
                    }}
                  >
                    {updateCtx.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className="tb-btn tb-btn-ghost"
                    style={{ fontSize: '12px', padding: '6px 14px' }}
                    onClick={() => setEditingInstructions(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : context.customInstructions ? (
              <p style={{ fontSize: '13px', color: 'var(--text)', lineHeight: 1.65, fontFamily: 'var(--font-ui)', whiteSpace: 'pre-wrap' }}>
                {context.customInstructions}
              </p>
            ) : (
              <p style={{ fontSize: '12px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontStyle: 'italic' }}>
                No custom instructions set. Click Edit to add guidance for the scanner and AI agents.
              </p>
            )}
          </div>
        </div>

        {/* Use cases card */}
        {useCaseSummary.length > 0 && (
          <div className="card">
            <div
              style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: '4px',
                background: 'linear-gradient(90deg, #2563AB, #0A2A57)',
                borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
              }}
            />
            <div className="card-header" style={{ position: 'relative', overflow: 'visible', paddingTop: '18px' }}>
              <div className="card-title">Use Cases Discovered</div>
              <button
                type="button"
                onClick={() => navigate(`/projects/${projectSlug}/tc-library`)}
                style={{
                  padding: '5px 12px', fontSize: '12px', fontWeight: 600,
                  border: '1px solid var(--border)', borderRadius: '6px',
                  background: 'transparent', color: 'var(--text-mid)', cursor: 'pointer',
                }}
              >
                View in TC Library →
              </button>
            </div>
            <div className="card-body" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {context?.pendingTCDraft && context.pendingTCDraft.length > 0 && (
                <div
                  style={{
                    width: '100%', marginBottom: '4px',
                    padding: '8px 12px', borderRadius: '8px', fontSize: '12px',
                    background: 'var(--violet-dim)', border: '1px solid rgba(37,99,171,0.25)',
                    display: 'flex', alignItems: 'center', gap: '8px',
                  }}
                >
                  <span>🔍</span>
                  <span style={{ flex: 1, color: 'var(--text-mid)' }}>
                    <strong style={{ color: 'var(--cyan)' }}>{context.pendingTCDraft.length} TCs</strong>
                    {' '}drafted by the writer agent — pending your review.
                  </span>
                  <button
                    type="button"
                    onClick={() => navigate(`/projects/${projectSlug}/writer`)}
                    style={{
                      padding: '4px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                      border: '1px solid var(--cyan)', borderRadius: '6px',
                      background: 'transparent', color: 'var(--cyan)',
                    }}
                  >
                    Review in Test Writer →
                  </button>
                </div>
              )}
              {useCaseSummary.map((uc) => (
                <div
                  key={uc.name}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '5px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 600,
                    border: `1px solid ${uc.color}22`,
                    background: `${uc.color}11`,
                  }}
                >
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: uc.color, flexShrink: 0 }} />
                  <span style={{ color: 'var(--text)' }}>{uc.name}</span>
                  <span
                    style={{
                      padding: '1px 6px', borderRadius: '10px', fontSize: '10px',
                      background: 'var(--surface2)', color: 'var(--text-dim)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {uc.tcCount > 0 ? `${uc.tcCount} TCs` : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Scan history */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Scan History</div>
            <button
              type="button"
              onClick={handleStartScan}
              disabled={startScan.isPending || !selectedEnv}
              style={{
                padding: '6px 14px', fontSize: '12px', fontWeight: 700,
                background: 'linear-gradient(135deg, #F47B20, #D9601A)',
                border: 'none', borderRadius: '6px', color: '#fff',
                cursor: 'pointer', opacity: startScan.isPending ? 0.6 : 1,
              }}
            >
              {startScan.isPending ? 'Starting…' : 'Run New Scan'}
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Date</th>
                <th>Pages</th>
                <th>Duration</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((scan) => (
                <tr key={scan.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      {statusDot(scan.status)}
                      <span style={{ fontSize: '12px', color: 'var(--text-mid)' }}>{scan.status}</span>
                    </div>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                    {new Date(scan.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                    {scan.pagesScanned}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                    {formatDuration(scan)}
                  </td>
                  <td>
                    {deletingId === scan.id ? (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span style={{ fontSize: '10px', color: 'var(--fail)' }}>Delete?</span>
                        <button className="tb-btn tb-btn-ghost" style={{ padding: '3px 8px', fontSize: '10px', color: 'var(--rose)', borderColor: 'rgba(220,38,38,0.3)' }} onClick={() => void handleDeleteScan(scan.id)}>Yes</button>
                        <button className="tb-btn tb-btn-ghost" style={{ padding: '3px 8px', fontSize: '10px' }} onClick={() => setDeletingId(null)}>No</button>
                      </div>
                    ) : (
                      <button
                        className="tb-btn tb-btn-ghost"
                        style={{ padding: '4px 10px', fontSize: '11px', color: 'var(--rose)', borderColor: 'rgba(220,38,38,0.3)' }}
                        onClick={() => setDeletingId(scan.id)}
                        disabled={scan.status === 'RUNNING'}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Idle state (no scan yet) ─────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Info banner */}
      <div
        style={{
          padding: '12px 16px',
          background: 'var(--cyan-dim)',
          border: '1px solid rgba(37,99,171,0.2)',
          borderRadius: 'var(--radius)',
          display: 'flex', alignItems: 'flex-start', gap: '10px',
        }}
      >
        <ScanLine size={18} color="var(--cyan)" style={{ marginTop: '1px', flexShrink: 0 }} />
        <p style={{ fontSize: '12px', color: 'var(--text-mid)', lineHeight: 1.55 }}>
          No UI scan has been run yet for this project. Running a scan lets QA Infinity learn the real
          navigation, login flow, and page locators of your application.
        </p>
      </div>

      {/* Step 1: Login Verifier */}
      <LoginVerifierCard
        selectedEnv={selectedEnv}
        testLoginLoading={testLoginLoading}
        loginVerified={loginVerified}
        testLoginResult={testLoginResult}
        screenshotExpanded={screenshotExpanded}
        onVerify={handleTestLogin}
        onExpandScreenshot={setScreenshotExpanded}
        disabled={!selectedEnvId}
      />

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', alignItems: 'start' }}>
        {/* Left: feature bullets card */}
        <div className="card" style={{ position: 'relative', overflow: 'visible' }}>
          <div
            style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: '4px',
              background: 'linear-gradient(90deg, #FFB347, #F47B20)',
              borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
            }}
          />
          <div className="card-header" style={{ paddingTop: '18px' }}>
            <div className="card-title">
              <ScanLine size={14} color="var(--6d-orange)" />
              UI Scanner
            </div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {[
              { icon: Lock,          label: 'Login Flow Discovery', desc: 'Detects form type, SSO, two-step' },
              { icon: Map,           label: 'Navigation Map',        desc: 'Walks every menu, records URLs and hierarchy' },
              { icon: Target,        label: 'Locator Library',       desc: 'Real CSS/ARIA selectors per page' },
              { icon: ClipboardList, label: 'Auto TC Suggestions',   desc: 'Draft TCs auto-sent to TC Library' },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <div
                  style={{
                    width: '32px', height: '32px', borderRadius: '8px', flexShrink: 0,
                    background: 'var(--violet-dim)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Icon size={14} color="var(--6d-orange)" />
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>{label}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>{desc}</div>
                </div>
              </div>
            ))}

            {!loginVerified && (
              <p style={{ fontSize: '11px', color: 'var(--amber)', fontFamily: 'var(--font-mono)', lineHeight: 1.5, marginTop: '4px' }}>
                Tip: Verify login (Step 1 above) before scanning so the scanner knows your login flow.
              </p>
            )}
            <button
              type="button"
              onClick={handleStartScan}
              disabled={startScan.isPending || !selectedEnv}
              style={{
                marginTop: '4px',
                padding: '10px 20px', fontSize: '13px', fontWeight: 700,
                background: selectedEnv ? 'linear-gradient(135deg, #F47B20, #D9601A)' : 'var(--surface3)',
                border: loginVerified ? '2px solid var(--pass)' : 'none',
                borderRadius: '8px',
                color: selectedEnv ? '#fff' : 'var(--text-dim)',
                cursor: selectedEnv && !startScan.isPending ? 'pointer' : 'not-allowed',
                width: '100%',
                opacity: startScan.isPending ? 0.6 : 1,
              }}
            >
              {startScan.isPending ? 'Starting Scan…' : loginVerified ? '✓ Start UI Scan' : 'Start UI Scan'}
            </button>
          </div>
        </div>

        {/* Right column: config + history */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Scan configuration */}
          <div className="card" style={{ position: 'relative', overflow: 'visible' }}>
            <div
              style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: '4px',
                background: 'linear-gradient(90deg, #2563AB, #0A2A57)',
                borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
              }}
            />
            <div className="card-header" style={{ paddingTop: '18px' }}>
              <div className="card-title">Scan Configuration</div>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={LABEL_STYLE}>Environment</label>
                <select
                  className="input-field"
                  value={selectedEnvId}
                  onChange={(e) => setSelectedEnvId(e.target.value)}
                  style={{ fontFamily: 'var(--font-ui)', fontSize: '13px' }}
                >
                  {envConfigs.length === 0 && (
                    <option value="">No environments configured</option>
                  )}
                  {envConfigs.map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.name}{env.isDefault ? ' ★' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Environment preview */}
              {selectedEnv && (
                <div
                  style={{
                    padding: '10px 12px',
                    background: 'var(--surface2)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    display: 'flex', flexDirection: 'column', gap: '5px',
                  }}
                >
                  {[
                    { label: 'Base URL',  value: selectedEnv.baseUrl, mono: true, color: 'var(--cyan)' },
                    { label: 'Username',  value: selectedEnv.username ?? '—', mono: true, color: 'var(--text)' },
                    { label: 'Password',  value: selectedEnv.username ? '••••••••••' : '—', mono: true, color: 'var(--text-dim)' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                        {label}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label style={LABEL_STYLE}>Scan Depth</label>
                <select
                  className="input-field"
                  value={scanDepth}
                  onChange={(e) => setScanDepth(e.target.value as typeof scanDepth)}
                  style={{ fontFamily: 'var(--font-ui)', fontSize: '13px' }}
                >
                  <option value="full">Full — all pages</option>
                  <option value="top-level">Top-level menus only</option>
                  <option value="login-only">Login + dashboard only</option>
                </select>
              </div>

              <div>
                <label style={LABEL_STYLE}>Auto-generate Test Cases</label>
                <select
                  className="input-field"
                  value={generateTCs ? 'yes' : 'no'}
                  onChange={(e) => setGenerateTCs(e.target.value === 'yes')}
                  style={{ fontFamily: 'var(--font-ui)', fontSize: '13px' }}
                >
                  <option value="yes">Yes — send to TC Library</option>
                  <option value="no">No — context only</option>
                </select>
              </div>

              <div>
                <label style={LABEL_STYLE}>
                  Custom Instructions
                  <span style={{ color: 'var(--text-dim)', fontWeight: 400, letterSpacing: 0, marginLeft: '4px' }}>(optional)</span>
                </label>
                <textarea
                  className="input-field"
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder={`e.g. After login you land on an "All Projects" page — click the first project to reach the main navigation.`}
                  style={{ fontFamily: 'var(--font-ui)', fontSize: '12px', minHeight: '80px', resize: 'vertical', lineHeight: 1.5 }}
                />
                <p style={{ marginTop: '5px', fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
                  The scanner uses these instructions to navigate to the correct app context before capturing pages. Also injected into all AI agents as project knowledge.
                </p>
              </div>
            </div>
          </div>

          {/* Scan history */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Scan History</div>
            </div>
            <div
              className="card-body"
              style={{
                textAlign: 'center', padding: '20px',
                color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '11px',
              }}
            >
              No scans yet
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
const TABS = [
  { value: 'details',     label: '🏗 Details' },
  { value: 'environments',label: '🌐 Environments' },
  { value: 'members',     label: '👥 Members' },
  { value: 'req-library', label: '📁 Req Library' },
  { value: 'scanner',     label: '🔍 UI Scanner' },
  { value: 'danger',      label: '⚠ Danger Zone' },
];

export default function ProjectSettings() {
  const { slug } = useParams<{ slug: string }>();
  const { activeProject } = useProjectStore();
  const navigate = useNavigate();
  const { canManageMembers, canDeleteProject } = useRBAC();
  const [activeTab, setActiveTab] = useState('details');

  // Filter tabs: Members and Danger Zone are Admin-only
  const visibleTabs = TABS.filter((t) => {
    if (t.value === 'members') return canManageMembers;
    if (t.value === 'danger')  return canDeleteProject;
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: activeProject?.name ?? slug ?? 'Project', href: `/projects/${slug}/dashboard` },
          { label: '⚙ Settings' },
        ]}
        actions={
          <>
            <TbBtn variant="ghost" onClick={() => navigate(`/projects/${slug}/copy-export`)}>
              📋 Copy / Export
            </TbBtn>
            <TbBtn variant="primary">💾 Save Changes</TbBtn>
          </>
        }
      />

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        {/* Page header */}
        <div>
          <div className="page-eyebrow">Project configuration</div>
          <h1 className="page-title">Project Settings</h1>
          {activeProject && (
            <p className="page-sub">{activeProject.description ?? activeProject.slug}</p>
          )}
        </div>

        {/* Tabs */}
        <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
          {/* Tab list */}
          <Tabs.List
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--border)',
              overflowX: 'auto',
              marginBottom: '24px',
            }}
          >
            {visibleTabs.map((t) => (
              <Tabs.Trigger
                key={t.value}
                value={t.value}
                style={TAB_TRIGGER_STYLE(activeTab === t.value)}
              >
                {t.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <Tabs.Content value="details">
            <DetailsTab />
          </Tabs.Content>
          <Tabs.Content value="environments">
            <EnvironmentsTab />
          </Tabs.Content>
          <Tabs.Content value="members">
            <MembersTab />
          </Tabs.Content>
          <Tabs.Content value="req-library">
            <ReqLibraryTab />
          </Tabs.Content>
          <Tabs.Content value="scanner">
            <UIScannerTab />
          </Tabs.Content>
          <Tabs.Content value="danger">
            <DangerZoneTab />
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </div>
  );
}
