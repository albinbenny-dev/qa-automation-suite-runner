import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useProjects, useCreateProject, useCloneProject } from '../hooks/useProjects';
import { useProjectStore } from '../stores/projectStore';
import { formatRelativeTime, passRateBadgeClass, slugify, PROJECT_GRADIENTS } from '../lib/utils';
import type { Project } from '../types';

// ── Stat tile ──────────────────────────────────────────────────────────────
function StatTile({
  label,
  value,
  delta,
  colorClass,
}: {
  label: string;
  value: string | number;
  delta?: string;
  colorClass: string;
}) {
  return (
    <div className={`stat-card ${colorClass}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {delta && <div className="stat-delta">{delta}</div>}
    </div>
  );
}

// ── Project card ───────────────────────────────────────────────────────────
function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const [hovered, setHovered] = useState(false);
  const gradientIdx = project.id.charCodeAt(0) % PROJECT_GRADIENTS.length;
  const projectColor = project.color ?? PROJECT_GRADIENTS[gradientIdx];

  const totalTests  = project._count?.testCases ?? 0;
  const passing     = 0; // populated in later stages
  const failing     = 0;
  const heals       = 0;
  const passRate    = totalTests > 0 ? Math.round((passing / totalTests) * 100) : null;

  return (
    <div
      data-testid="project-card"
      data-project-slug={project.slug}
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--surface)',
        border: `1px solid ${hovered ? 'rgba(37,99,171,0.45)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg)',
        padding: '24px',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        boxShadow: hovered ? '0 4px 16px rgba(15,25,50,0.08)' : 'var(--shadow-card)',
      }}
    >
      {/* Glow decoration */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: '160px',
          height: '160px',
          background: 'radial-gradient(circle at 80% 20%, rgba(37,99,171,0.06), transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '9px',
              background: projectColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
              flexShrink: 0,
              color: '#fff',
              fontWeight: 800,
            }}
          >
            {project.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div data-testid="project-name" style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text)' }}>
              {project.name}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                color: 'var(--text-dim)',
                letterSpacing: '1px',
                marginTop: '2px',
              }}
            >
              {project.slug}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span className="badge badge-cyan">Active</span>
          {passRate !== null && (
            <span className={`badge ${passRateBadgeClass(passRate)}`}>{passRate}%</span>
          )}
        </div>
      </div>

      {/* Description */}
      {project.description && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--text-mid)',
            marginBottom: '14px',
            fontWeight: 300,
            lineHeight: 1.55,
          }}
        >
          {project.description}
        </div>
      )}

      {/* Mini stats */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '8px',
          marginBottom: '14px',
        }}
      >
        {[
          { label: 'Tests',   value: totalTests, color: 'var(--cyan)' },
          { label: 'Passing', value: passing,    color: 'var(--pass)' },
          { label: 'Failing', value: failing,    color: 'var(--fail)' },
          { label: 'Heals',   value: heals,      color: 'var(--amber)' },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              textAlign: 'center',
              background: 'var(--surface2)',
              borderRadius: '6px',
              padding: '8px 4px',
            }}
          >
            <div style={{ fontSize: '16px', fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', color: 'var(--text-dim)' }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          <span className="tag tag-ui">ui</span>
          <span className="tag tag-api">api</span>
          <span className="tag tag-sit">sit</span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)' }}>
          Created {formatRelativeTime(project.createdAt)}
        </div>
      </div>
    </div>
  );
}

// ── Create project modal ───────────────────────────────────────────────────
function CreateProjectModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [name, setName]         = useState('');
  const [slug, setSlug]         = useState('');
  const [desc, setDesc]         = useState('');
  const [baseUrl, setBaseUrl]   = useState('');
  const [colorIdx, setColorIdx] = useState(0);

  // Clone mode
  const [cloneMode, setCloneMode]       = useState(false);
  const [sourceId, setSourceId]         = useState('');
  const [projSearch, setProjSearch]     = useState('');
  const [showProjDrop, setShowProjDrop] = useState(false);

  const createProject = useCreateProject();
  const cloneProject  = useCloneProject();
  const { data: allProjects = [] } = useProjects();
  const navigate = useNavigate();

  const sourceProject = allProjects.find((p) => p.id === sourceId) ?? null;
  const filteredProjects = allProjects.filter((p) =>
    !projSearch || p.name.toLowerCase().includes(projSearch.toLowerCase()),
  );

  function handleNameChange(v: string) {
    setName(v);
    setSlug(slugify(v));
  }

  function switchMode(toClone: boolean) {
    setCloneMode(toClone);
    setSourceId('');
    setProjSearch('');
    setName('');
    setSlug('');
  }

  const isPending = createProject.isPending || cloneProject.isPending;

  async function handleSave() {
    if (!name.trim()) { toast.error('Project name is required.'); return; }

    if (cloneMode) {
      if (!sourceId) { toast.error('Select a project to clone from.'); return; }
      try {
        const proj = await cloneProject.mutateAsync({
          sourceId,
          name: name.trim(),
          slug: slug.trim() || undefined,
          color: PROJECT_GRADIENTS[colorIdx],
        });
        toast.success('Project cloned!');
        onOpenChange(false);
        navigate(`/projects/${proj.slug}/dashboard`);
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Clone failed.';
        toast.error(msg);
      }
      return;
    }

    try {
      const proj = await createProject.mutateAsync({
        name: name.trim(),
        description: desc.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        color: PROJECT_GRADIENTS[colorIdx],
      });
      toast.success('Project created!');
      onOpenChange(false);
      navigate(`/projects/${proj.slug}/dashboard`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to create project.';
      toast.error(msg);
    }
  }

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(6,34,74,0.6)',
    backdropFilter: 'blur(4px)',
    zIndex: 9998,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const contentStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '28px',
    width: '480px',
    maxWidth: '96vw',
    boxShadow: '0 16px 48px rgba(6,34,74,0.2)',
    position: 'relative',
    zIndex: 9999,
    fontFamily: 'var(--font-ui)',
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={overlayStyle}>
          <Dialog.Content style={contentStyle}>
            <Dialog.Title
              style={{
                fontSize: '18px',
                fontWeight: 800,
                color: 'var(--text)',
                marginBottom: '4px',
              }}
            >
              {cloneMode ? 'Clone Project' : 'Create New Project'}
            </Dialog.Title>
            <Dialog.Description
              style={{ fontSize: '12px', color: 'var(--text-mid)', marginBottom: '16px' }}
            >
              {cloneMode
                ? 'Copy an existing project — scripts, TCs, and resources. Run history and reports are excluded.'
                : 'Set up a new workspace for a deployment, product, or team.'}
            </Dialog.Description>

            {/* ── Mode toggle ── */}
            <div style={{ display: 'flex', gap: '0', marginBottom: '20px', background: 'var(--surface2)', borderRadius: '7px', padding: '3px', border: '1px solid var(--border)' }}>
              {(['fresh', 'clone'] as const).map((mode) => {
                const active = cloneMode ? mode === 'clone' : mode === 'fresh';
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => switchMode(mode === 'clone')}
                    style={{ flex: 1, padding: '6px 0', fontSize: '11px', fontWeight: 700, borderRadius: '5px', border: 'none', cursor: 'pointer', background: active ? 'var(--surface)' : 'transparent', color: active ? 'var(--text)' : 'var(--text-dim)', boxShadow: active ? '0 1px 4px rgba(0,0,0,0.15)' : 'none', transition: 'all 0.15s' }}
                  >
                    {mode === 'fresh' ? '✦ Fresh Project' : '⎘ Clone Existing'}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* ── Source project picker (clone mode only) ── */}
            {cloneMode && (
              <div>
                <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: '6px' }}>
                  Clone From *
                </label>
                <div style={{ position: 'relative' }}>
                  <div
                    onClick={() => setShowProjDrop((v) => !v)}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', background: 'var(--surface)', border: `1px solid ${sourceProject ? 'rgba(37,99,171,0.4)' : 'var(--border2)'}`, borderRadius: '6px', cursor: 'pointer', minHeight: '38px' }}
                  >
                    {sourceProject ? (
                      <>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: sourceProject.color ?? 'var(--cyan)', flexShrink: 0 }} />
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', flex: 1 }}>{sourceProject.name}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>{sourceProject.slug}</span>
                      </>
                    ) : (
                      <span style={{ fontSize: '13px', color: 'var(--text-dim)', flex: 1 }}>Select a project…</span>
                    )}
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>▾</span>
                  </div>
                  {showProjDrop && (
                    <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.3)', zIndex: 100, overflow: 'hidden' }}>
                      <div style={{ padding: '8px' }}>
                        <input
                          autoFocus
                          value={projSearch}
                          onChange={(e) => setProjSearch(e.target.value)}
                          placeholder="Search projects…"
                          style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text)', fontSize: '12px', padding: '6px 8px', outline: 'none', boxSizing: 'border-box' }}
                          onKeyDown={(e) => { if (e.key === 'Escape') setShowProjDrop(false); }}
                        />
                      </div>
                      <div style={{ maxHeight: '200px', overflowY: 'auto', borderTop: '1px solid var(--border)' }}>
                        {filteredProjects.length === 0 && (
                          <div style={{ padding: '12px', textAlign: 'center', fontSize: '11px', color: 'var(--text-dim)' }}>No projects found</div>
                        )}
                        {filteredProjects.map((p) => (
                          <div
                            key={p.id}
                            onClick={() => { setSourceId(p.id); setShowProjDrop(false); setProjSearch(''); if (!name) { setName(`${p.name} (Copy)`); setSlug(slugify(`${p.name} copy`)); } }}
                            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: p.id === sourceId ? 'var(--cyan-dim)' : 'transparent' }}
                            onMouseEnter={(e) => { if (p.id !== sourceId) (e.currentTarget as HTMLDivElement).style.background = 'var(--surface2)'; }}
                            onMouseLeave={(e) => { if (p.id !== sourceId) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                          >
                            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: p.color ?? 'var(--cyan)', flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)' }}>{p.slug}</div>
                            </div>
                            {p.id === sourceId && <span style={{ color: 'var(--cyan)', fontSize: '11px' }}>✓</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {sourceProject && (
                  <div style={{ marginTop: '8px', padding: '8px 12px', background: 'var(--surface2)', borderRadius: '6px', border: '1px solid var(--border)', display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                    {[
                      { icon: '📂', label: 'Script Library', val: sourceProject._count?.testCases },
                      { icon: '📋', label: 'TC Library', val: sourceProject._count?.tcItems },
                    ].map(({ icon, label, val }) => (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: 'var(--text-dim)' }}>
                        <span>{icon}</span><span style={{ fontWeight: 700, color: 'var(--text)' }}>{val ?? 0}</span><span>{label}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: 'var(--text-dim)' }}>
                      <span style={{ color: 'var(--pass)' }}>✓</span><span>Scripts &amp; Resources</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: 'var(--text-dim)' }}>
                      <span style={{ color: 'var(--fail)' }}>✗</span><span>Run History &amp; Reports</span>
                    </div>
                  </div>
                )}
              </div>
            )}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    fontWeight: 700,
                    letterSpacing: '1.2px',
                    textTransform: 'uppercase',
                    color: 'var(--text-mid)',
                    marginBottom: '6px',
                  }}
                >
                  Project Name *
                </label>
                <input
                  className="input-field"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. Airtel Ventas Local Lab"
                  style={{ fontFamily: 'var(--font-ui)', fontSize: '14px', fontWeight: 600 }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    fontWeight: 700,
                    letterSpacing: '1.2px',
                    textTransform: 'uppercase',
                    color: 'var(--text-mid)',
                    marginBottom: '6px',
                  }}
                >
                  Slug{' '}
                  <span style={{ color: 'var(--text-dim)', fontSize: '9px', fontWeight: 400, letterSpacing: 0 }}>
                    (auto-generated, URL-safe)
                  </span>
                </label>
                <input
                  className="input-field"
                  value={slug}
                  onChange={(e) => setSlug(slugify(e.target.value))}
                  placeholder="airtel-ventas-local-lab"
                  style={{ color: 'var(--cyan)' }}
                />
              </div>

              {!cloneMode && (
              <div>
                <label
                  style={{
                    display: 'block',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    fontWeight: 700,
                    letterSpacing: '1.2px',
                    textTransform: 'uppercase',
                    color: 'var(--text-mid)',
                    marginBottom: '6px',
                  }}
                >
                  Description
                </label>
                <textarea
                  className="input-field"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="Brief description of what this project covers…"
                  style={{ minHeight: '72px', fontFamily: 'var(--font-ui)', fontSize: '13px' }}
                />
              </div>
              )}

              {!cloneMode && (
              <div>
                <label
                  style={{
                    display: 'block',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    fontWeight: 700,
                    letterSpacing: '1.2px',
                    textTransform: 'uppercase',
                    color: 'var(--text-mid)',
                    marginBottom: '6px',
                  }}
                >
                  Base URL
                </label>
                <input
                  className="input-field"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://app.example.com"
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
              )}

              <div>
                <label
                  style={{
                    display: 'block',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    fontWeight: 700,
                    letterSpacing: '1.2px',
                    textTransform: 'uppercase',
                    color: 'var(--text-mid)',
                    marginBottom: '8px',
                  }}
                >
                  Project Color
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {PROJECT_GRADIENTS.map((g, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setColorIdx(i)}
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        background: g,
                        border: colorIdx === i ? '2px solid var(--cyan)' : '2px solid transparent',
                        cursor: 'pointer',
                        outline: colorIdx === i ? '1px solid rgba(37,99,171,0.4)' : 'none',
                        transition: 'border 0.15s',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>{/* end fields */}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '28px' }}>
              <Dialog.Close asChild>
                <button className="tb-btn tb-btn-ghost" type="button">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                style={{
                  padding: '8px 20px',
                  background: cloneMode ? 'linear-gradient(135deg, #2563AB, #1d4ed8)' : 'linear-gradient(135deg, #F47B20, #D9601A)',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: isPending ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-ui)',
                  opacity: isPending ? 0.6 : 1,
                }}
              >
                {isPending ? (cloneMode ? 'Cloning…' : 'Creating…') : (cloneMode ? '⎘ Clone Project' : 'Create Project')}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function GlobalProjects() {
  const [modalOpen, setModalOpen] = useState(false);
  const { data: projects = [], isLoading } = useProjects();
  const { setActiveProject } = useProjectStore();

  function openProject(project: Project) {
    setActiveProject(project);
    // navigation is handled by the <Link> wrapper on each card
  }

  const totalProjects = projects.length;
  const openFailures  = 0; // requires run data — populated in Stage 5
  const pendingHeals  = 0; // requires heal data — populated in Stage 6
  const scheduledRuns = 0; // requires schedule data — populated in Stage 5
  const passRate      = '--'; // requires run data

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar
        breadcrumbs={[{ label: '🌐 All Projects' }]}
        actions={
          <>
            <TbBtn variant="ghost">🔍 Search</TbBtn>
            <TbBtn variant="primary" onClick={() => setModalOpen(true)}>
              + New Project
            </TbBtn>
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
          <div className="page-eyebrow">Global overview</div>
          <h1 className="page-title">All Projects</h1>
          <p className="page-sub">Manage and monitor all QA automation projects across your organization.</p>
        </div>

        {/* Stats row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: '12px',
          }}
        >
          <StatTile label="Total Projects"  value={totalProjects} delta="Across all teams"    colorClass="sc-cyan"   />
          <StatTile label="Avg Pass Rate"   value={passRate}      delta="↑ target ≥90%"       colorClass="sc-pass"   />
          <StatTile label="Open Failures"   value={openFailures}  delta="Across all projects"  colorClass="sc-fail"   />
          <StatTile label="Pending Heals"   value={pendingHeals}  delta="Awaiting approval"    colorClass="sc-skip"   />
          <StatTile label="Scheduled Runs"  value={scheduledRuns} delta="Active schedules"     colorClass="sc-violet" />
        </div>

        {/* Project grid */}
        {isLoading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px',
              color: 'var(--text-dim)',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
            }}
          >
            Loading projects…
          </div>
        ) : (
          <div data-testid="projects-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
            {projects.length === 0 && (
              <div
                data-testid="projects-empty-state"
                style={{
                  gridColumn: '1 / -1',
                  textAlign: 'center',
                  padding: '48px 24px',
                  color: 'var(--text-dim)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                }}
              >
                No projects yet. Create your first project to get started.
              </div>
            )}
            {projects.map((p) => (
              <Link
                key={p.id}
                to={`/projects/${p.slug}/dashboard`}
                style={{ textDecoration: 'none', display: 'block' }}
              >
                <ProjectCard project={p} onOpen={() => openProject(p)} />
              </Link>
            ))}

            {/* Create new project card */}
            <div
              onClick={() => setModalOpen(true)}
              style={{
                border: '2px dashed var(--border2)',
                borderRadius: 'var(--radius-lg)',
                padding: '32px 24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                background: 'transparent',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--cyan)';
                (e.currentTarget as HTMLElement).style.background = 'var(--cyan-dim)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border2)';
                (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              <span
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #F47B20, #D9601A)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '22px',
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                +
              </span>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>
                  Create New Project
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    color: 'var(--text-dim)',
                    marginTop: '3px',
                  }}
                >
                  Set up a new deployment, product, or team workspace
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <CreateProjectModal open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
