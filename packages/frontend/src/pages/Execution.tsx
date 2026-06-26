import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import LiveLog from '../components/execution/LiveLog';
import TCListPanel from '../components/execution/TCListPanel';
import { getCurrentUser } from '../lib/auth';
import { useProject } from '../hooks/useProjects';
import { useProjectEnvConfigs } from '../hooks/useProjects';
import { useTestCases, useUseCases, useDuplicateTestCase, useReorderTestCases } from '../hooks/useTestCases';
import { useScripts } from '../hooks/useScripts';
import { useRuns, useCreateRun, useCreateGroupRun, useCreateIndividualRun, useCancelRun, type RunListItem } from '../hooks/useRuns';
import { useRunSocket } from '../hooks/useRunSocket';
import { useExecutionStore } from '../stores/executionStore';
import { useRBAC } from '../hooks/useRBAC';
import type { TestCase } from '../types';


// ── Stepper ────────────────────────────────────────────────────────────────
function Stepper({ value, onChange, min = 1, max = 8 }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        style={{
          width: 26, height: 26, borderRadius: '5px 0 0 5px',
          background: 'var(--surface3)', border: '1px solid var(--border)',
          color: 'var(--text)', fontSize: 14, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >−</button>
      <div style={{
        width: 36, height: 26, borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--text)',
        background: 'var(--surface2)',
      }}>
        {value}
      </div>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        style={{
          width: 26, height: 26, borderRadius: '0 5px 5px 0',
          background: 'var(--surface3)', border: '1px solid var(--border)',
          color: 'var(--text)', fontSize: 14, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >+</button>
    </div>
  );
}

// ── Run progress bar ───────────────────────────────────────────────────────
function RunProgressBar({ passed, failed, total }: { passed: number; failed: number; total: number }) {
  if (total === 0) return null;
  const pct = Math.round(((passed + failed) / total) * 100);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{
        height: 6, background: 'var(--surface3)', borderRadius: 3, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', borderRadius: 3,
          background: failed > 0
            ? `linear-gradient(90deg, #2A9D8F ${(passed / (passed + failed)) * 100}%, #DC2626 100%)`
            : 'linear-gradient(90deg, #2A9D8F, #22d3ee)',
          width: `${pct}%`,
          transition: 'width 0.5s ease',
        }} />
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', marginTop: 3,
        fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)',
      }}>
        <span>{pct}% complete</span>
        <span>{passed + failed}/{total}</span>
      </div>
    </div>
  );
}

// ── Trigger type badge meta ────────────────────────────────────────────────

const TRIGGER_META: Record<string, { label: string; color: string; bg: string }> = {
  SCHEDULED:  { label: 'Scheduled',  color: 'var(--cyan)',  bg: 'rgba(37,99,171,0.12)' },
  MANUAL:     { label: 'Manual',     color: 'var(--pass)',  bg: 'rgba(42,157,143,0.10)' },
  GROUP:      { label: 'Group',      color: '#8b5cf6',      bg: 'rgba(139,92,246,0.10)' },
  INDIVIDUAL: { label: 'Individual', color: 'var(--amber)', bg: 'rgba(251,191,36,0.10)' },
  HEAL_RERUN: { label: 'Heal',       color: 'var(--fail)',  bg: 'rgba(220,38,38,0.10)'  },
};

// ── Job queue panel (shown above live log when runs are active) ────────────

function JobQueuePanel({ runs, watchedRunId, onSelect }: {
  runs: RunListItem[];
  watchedRunId: string | null;
  onSelect: (runId: string) => void;
}) {
  return (
    <div style={{
      background: '#04183a',
      borderBottom: '1px solid rgba(255,255,255,0.07)',
      flexShrink: 0,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 12px 5px',
      }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--cyan)', display: 'inline-block', flexShrink: 0 }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(226,232,240,0.7)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Running Jobs
        </span>
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 100,
          background: 'rgba(37,99,171,0.2)', color: 'var(--cyan)',
        }}>{runs.length}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: 'rgba(226,232,240,0.3)', fontStyle: 'italic' }}>auto-attached to latest · click another to switch</span>
      </div>

      {/* Horizontally scrollable cards */}
      <div style={{
        display: 'flex', gap: 8, overflowX: 'auto', padding: '0 12px 10px',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(37,99,171,0.4) transparent',
      }}>
        {runs.map(run => {
          const watched = watchedRunId === run.id;
          const trigMeta = TRIGGER_META[run.triggerType] ?? TRIGGER_META.MANUAL;
          const passed  = run.results.filter(r => r.status === 'PASSED').length;
          const failed  = run.results.filter(r => r.status === 'FAILED').length;
          const skipped = run.results.filter(r => r.status === 'SKIPPED').length;
          const total   = run._count.results;
          const done    = passed + failed + skipped;
          const pct     = total > 0 ? Math.round((done / total) * 100) : 0;

          return (
            <div
              key={run.id}
              onClick={() => onSelect(run.id)}
              title={`${run.name} · ${run.environment}`}
              style={{
                flexShrink: 0, width: 220, padding: '9px 11px',
                borderRadius: 8, cursor: 'pointer',
                background: watched ? 'rgba(37,99,171,0.14)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${watched ? 'rgba(37,99,171,0.5)' : 'rgba(255,255,255,0.08)'}`,
                boxShadow: watched ? '0 0 0 1px rgba(37,99,171,0.3)' : 'none',
                transition: 'all 0.15s',
                display: 'flex', flexDirection: 'column', gap: 5,
              }}
            >
              {/* Name + badges */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                {watched && (
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--cyan)', flexShrink: 0, display: 'inline-block' }} />
                )}
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  color: watched ? 'rgba(226,232,240,0.95)' : 'rgba(226,232,240,0.65)',
                  flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{run.name}</span>
              </div>

              {/* Badges row */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 8, fontWeight: 700, padding: '1px 6px', borderRadius: 100, textTransform: 'uppercase',
                  background: trigMeta.bg, color: trigMeta.color,
                }}>{trigMeta.label}</span>
                <span style={{
                  fontSize: 8, fontWeight: 700, padding: '1px 6px', borderRadius: 100, textTransform: 'uppercase',
                  background: 'rgba(255,255,255,0.06)', color: 'rgba(226,232,240,0.45)',
                }}>{run.environment}</span>
                <span style={{
                  fontSize: 8, fontWeight: 700, padding: '1px 6px', borderRadius: 100, textTransform: 'uppercase',
                  background: run.status === 'RUNNING' ? 'rgba(37,99,171,0.12)' : 'rgba(255,179,71,0.1)',
                  color: run.status === 'RUNNING' ? 'var(--cyan)' : 'rgba(255,179,71,0.8)',
                }}>{run.status === 'RUNNING' ? '● Running' : '⏳ Pending'}</span>
              </div>

              {/* Progress bar + counts */}
              {total > 0 ? (
                <div>
                  <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 2,
                      width: `${pct}%`,
                      background: failed > 0 ? 'linear-gradient(90deg,#2A9D8F,#DC2626)' : '#2A9D8F',
                      transition: 'width 0.4s ease',
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 9, fontFamily: 'var(--font-mono)' }}>
                    <span style={{ color: 'rgba(226,232,240,0.35)' }}>{done}/{total}</span>
                    <span>
                      {passed > 0 && <span style={{ color: '#2A9D8F', marginRight: 5 }}>✓{passed}</span>}
                      {failed > 0 && <span style={{ color: '#DC2626' }}>✗{failed}</span>}
                      {skipped > 0 && <span style={{ color: 'rgba(226,232,240,0.3)', marginLeft: 4 }}>⊙{skipped}</span>}
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 9, color: 'rgba(226,232,240,0.3)', fontFamily: 'var(--font-mono)' }}>waiting to start…</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function Execution() {
  const { slug } = useParams<{ slug: string }>();
  const { canWrite } = useRBAC();
  const navigate = useNavigate();

  const { data: project } = useProject(slug);
  const projectId = project?.id;

  const { data: envConfigs = [] } = useProjectEnvConfigs(projectId);
  const { data: tcData } = useTestCases(projectId, { limit: 500 });
  const { data: useCaseTags = [] } = useUseCases(projectId);
  const { data: scripts = [] } = useScripts(projectId);
  const { data: runsData } = useRuns(projectId);
  const activeRuns: RunListItem[] = (runsData?.runs ?? []).filter(
    r => r.status === 'PENDING' || r.status === 'RUNNING',
  );

  const createRun = useCreateRun(projectId ?? '');
  const createGroupRun = useCreateGroupRun(projectId ?? '');
  const createIndividualRun = useCreateIndividualRun(projectId ?? '');
  const cancelRun = useCancelRun(projectId ?? '');
  const duplicateTc = useDuplicateTestCase(projectId ?? '');
  const reorderTcs = useReorderTestCases(projectId ?? '');

  const { logs, stats, status: socketStatus, clearLogs, joinRun, leaveRun } = useRunSocket();

  const { selectedTestCaseIds, clearSelected } = useExecutionStore();

  // ── Run config state ──────────────────────────────────────────────────────
  const [environment, setEnvironment] = useState('');
  const [parallelWorkers, setParallelWorkers] = useState<number>(() => {
    const saved = localStorage.getItem('qa:parallelWorkers');
    const n = saved ? parseInt(saved, 10) : 2;
    return Number.isFinite(n) && n >= 1 && n <= 16 ? n : 2;
  });

  const updateWorkers = useCallback((n: number) => {
    setParallelWorkers(n);
    localStorage.setItem('qa:parallelWorkers', String(n));
  }, []);

  // ── TC selection ──────────────────────────────────────────────────────────
  const [selectedTcIds, setSelectedTcIds] = useState<Set<string>>(
    () => new Set(selectedTestCaseIds),
  );

  // ── Active run tracking ───────────────────────────────────────────────────
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [watchedRunId, setWatchedRunId] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [runningTcIds, setRunningTcIds] = useState<Set<string>>(new Set());
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // ── Resizable log panel ───────────────────────────────────────────────────
  const [logPanelWidth, setLogPanelWidth] = useState(() => Math.round(window.innerWidth / 3));
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(Math.round(window.innerWidth / 3));
  const logPanelWidthRef = useRef(Math.round(window.innerWidth / 3));

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = logPanelWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useLayoutEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = dragStartXRef.current - e.clientX;
      const next = Math.max(280, Math.min(700, dragStartWidthRef.current + delta));
      logPanelWidthRef.current = next;
      // Direct DOM update — no React re-render during drag
      const panel = document.getElementById('qa-log-panel');
      if (panel) panel.style.width = `${next}px`;
    };
    const onMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setLogPanelWidth(logPanelWidthRef.current);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const isRunning = socketStatus === 'running' || socketStatus === 'connecting';

  // ── Derived data ──────────────────────────────────────────────────────────
  const allTCs: TestCase[] = tcData?.testCases ?? [];
  const scriptedTcIds = useMemo(() => {
    const s = new Set<string>();
    for (const sc of scripts) { if (sc.testCaseId) s.add(sc.testCaseId); }
    return s;
  }, [scripts]);

  const envBaseUrl = useMemo(() => {
    const cfg = envConfigs.find((e) => e.name === environment);
    return cfg?.baseUrl ?? project?.baseUrl ?? '';
  }, [envConfigs, environment, project]);

  // Auto-select default (or first) env when configs load
  useEffect(() => {
    if (envConfigs.length === 0) return;
    setEnvironment((cur) => {
      if (cur && envConfigs.some((e) => e.name === cur)) return cur;
      return (envConfigs.find((e) => e.isDefault) ?? envConfigs[0]).name;
    });
  }, [envConfigs]);

  // ── Sync store → local selection on mount ─────────────────────────────────
  useEffect(() => {
    if (selectedTestCaseIds.length > 0) {
      setSelectedTcIds(new Set(selectedTestCaseIds));
      clearSelected();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Leave watched run room on unmount ─────────────────────────────────────
  const watchedRunIdRef = useRef<string | null>(null);
  watchedRunIdRef.current = watchedRunId;
  useEffect(() => {
    return () => {
      if (watchedRunIdRef.current) leaveRun(watchedRunIdRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Elapsed timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (isRunning) {
      setElapsedMs(0);
      elapsedRef.current = setInterval(() => setElapsedMs((p) => p + 1000), 1000);
    } else {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    }
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current); };
  }, [isRunning]);

  // ── Socket progress → runningTcIds ────────────────────────────────────────
  useEffect(() => {
    if (socketStatus === 'complete' || socketStatus === 'error' || socketStatus === 'cancelled') {
      setRunningTcIds(new Set());
    }
  }, [socketStatus]);

  // Auto-heal is handled server-side by runWorker — no frontend trigger needed.

  // ── Auto-attach: join the latest run started by THIS user when the page opens ──
  // Fires when navigated from TC Library (run already queued but watchedRunId is null).
  // Scoped to the current user so other users' concurrent runs don't bleed into this session.
  useEffect(() => {
    if (watchedRunId !== null || activeRuns.length === 0) return;
    const currentUserId = getCurrentUser()?.id;
    const myLatest = activeRuns.find(
      (r) => !currentUserId || r.createdByUserId === currentUserId,
    );
    if (!myLatest) return;
    setActiveRunId(myLatest.id);
    setWatchedRunId(myLatest.id);
    clearLogs();
    joinRun(myLatest.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRuns, watchedRunId]);

  // ── TC selection handlers ─────────────────────────────────────────────────
  const handleToggleTc = useCallback((id: string) => {
    setSelectedTcIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);

  const handleToggleGroup = useCallback((ids: string[]) => {
    setSelectedTcIds((prev) => {
      const n = new Set(prev);
      const allSel = ids.every((id) => n.has(id));
      if (allSel) ids.forEach((id) => n.delete(id));
      else ids.forEach((id) => n.add(id));
      return n;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedTcIds(new Set(allTCs.map((tc) => tc.id)));
  }, [allTCs]);

  const handleClearSelection = useCallback(() => {
    setSelectedTcIds(new Set());
  }, []);

  // ── Switch watched run (job queue selector) ───────────────────────────────
  const switchToRun = useCallback((runId: string) => {
    if (watchedRunId && watchedRunId !== runId) leaveRun(watchedRunId);
    clearLogs();
    setWatchedRunId(runId);
    joinRun(runId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedRunId]);

  // ── Run handlers ──────────────────────────────────────────────────────────
  async function handleRunNow() {
    if (!projectId) return;
    const tcIds = Array.from(selectedTcIds);
    if (tcIds.length === 0) {
      toast.error('Select at least one test case first');
      return;
    }

    if (watchedRunId) leaveRun(watchedRunId);
    clearLogs();
    setRunningTcIds(new Set(tcIds));

    try {
      const run = await createRun.mutateAsync({
        testCaseIds: tcIds,
        environment,
        parallelWorkers,
        headless: false,
        browser: 'chrome',
        record: true,
      });
      setActiveRunId(run.id);
      setWatchedRunId(run.id);
      joinRun(run.id);
      toast.success(`Run started · ${tcIds.length} test${tcIds.length !== 1 ? 's' : ''}`);
    } catch (err) {
      const msg = (err as Error)?.message ?? 'Failed to start run';
      toast.error(msg);
      setRunningTcIds(new Set());
    }
  }

  async function handleRunGroup(useCaseTag: string) {
    if (!projectId) return;
    if (watchedRunId) leaveRun(watchedRunId);
    clearLogs();

    try {
      const run = await createGroupRun.mutateAsync({
        useCaseTag,
        environment,
        parallelWorkers,
        headless: false,
        browser: 'chrome',
        record: true,
      });
      setActiveRunId(run.id);
      setWatchedRunId(run.id);
      joinRun(run.id);
      toast.success(`Running group: ${useCaseTag}`);
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to start group run');
    }
  }

  async function handleRunIndividual(tc: TestCase) {
    if (!projectId) return;
    if (watchedRunId) leaveRun(watchedRunId);
    clearLogs();
    setRunningTcIds(new Set([tc.id]));

    try {
      const run = await createIndividualRun.mutateAsync({
        testCaseId: tc.id,
        environment,
        browser: 'chrome',
        headless: false,
      });
      setActiveRunId(run.id);
      setWatchedRunId(run.id);
      joinRun(run.id);
      toast.success(`Running: ${tc.tcId}`);
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to start individual run');
      setRunningTcIds(new Set());
    }
  }

  async function handleStopRun() {
    if (!activeRunId || isStopping) return;
    setIsStopping(true);
    try {
      await cancelRun.mutateAsync(activeRunId);
      toast('Run cancelled');
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to cancel run');
    } finally {
      setIsStopping(false);
    }
  }

  function handleViewTc(_tc: TestCase) {
    navigate(`/projects/${slug}/tc-library`);
  }

  async function handleDuplicateTc(tc: TestCase) {
    try {
      await duplicateTc.mutateAsync(tc);
      toast.success(`Duplicated "${tc.title}"`);
    } catch {
      toast.error('Failed to duplicate test case');
    }
  }

  async function handleReorderTcs(_useCaseTag: string, orderedIds: string[]) {
    try {
      await reorderTcs.mutateAsync(orderedIds);
    } catch {
      toast.error('Failed to save order');
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Topbar */}
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: project?.name ?? slug ?? '', href: `/projects/${slug}/settings` },
          { label: '▶ Execution' },
        ]}
        actions={
          <>
            <TbBtn variant="ghost" onClick={() => navigate(`/projects/${slug}/tc-library`)}>
              📚 TC Library
            </TbBtn>
            <TbBtn variant="ghost" onClick={() => navigate(`/projects/${slug}/reports`)}>
              📊 Reports
            </TbBtn>
          </>
        }
      />

      {/* 2-column layout */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
        minHeight: 0,
      }}>

        {/* ── LEFT COLUMN ─────────────────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* ── Compact config bar ────────────────────────────────────── */}
          <div style={{
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
            background: 'var(--surface2)',
          }}>
            <div style={{ height: 3, background: 'linear-gradient(90deg, #2563AB, #0A2A57)' }} />

            {/* Config row: Env · URL · Workers · Run */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 10px',
              overflow: 'hidden',
            }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', flexShrink: 0 }}>W</span>
              <Stepper value={parallelWorkers} onChange={updateWorkers} max={16} />
              {canWrite && <button
                onClick={handleRunNow}
                disabled={isRunning || createRun.isPending || selectedTcIds.size === 0}
                style={{
                  padding: '5px 12px', borderRadius: 6, flexShrink: 0,
                  background: (isRunning || createRun.isPending)
                    ? 'rgba(42,157,143,0.3)'
                    : selectedTcIds.size === 0
                    ? 'rgba(42,157,143,0.15)'
                    : 'linear-gradient(135deg, #2A9D8F, #22d3ee)',
                  border: 'none',
                  color: selectedTcIds.size === 0 ? 'rgba(255,255,255,0.4)' : 'white',
                  fontSize: 11, fontWeight: 800,
                  cursor: (isRunning || createRun.isPending || selectedTcIds.size === 0) ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-ui)', whiteSpace: 'nowrap', transition: 'all 0.2s',
                }}
              >
                {isRunning ? '⏳ Running…' : createRun.isPending ? '⏳ Starting…' : `▶ Run ${selectedTcIds.size}`}
              </button>}
            </div>

            {/* Progress bar while running */}
            {isRunning && (
              <div style={{ padding: '0 10px 5px' }}>
                <RunProgressBar passed={stats.passed} failed={stats.failed} total={stats.total} />
              </div>
            )}
          </div>

          {/* TC List Panel */}
          <TCListPanel
            allTCs={allTCs}
            useCases={useCaseTags}
            selectedIds={selectedTcIds}
            runningTcIds={runningTcIds}
            scriptedTcIds={scriptedTcIds}
            onToggleTc={handleToggleTc}
            onToggleGroup={handleToggleGroup}
            onSelectAll={handleSelectAll}
            onClearSelection={handleClearSelection}
            onRunSelected={handleRunNow}
            onRunGroup={handleRunGroup}
            onRunIndividual={handleRunIndividual}
            onViewTc={handleViewTc}
            onDuplicateTc={handleDuplicateTc}
            onReorderTcs={handleReorderTcs}
            isRunning={isRunning}
          />
        </div>

        {/* ── Drag divider ─────────────────────────────────────────────────── */}
        <div
          onMouseDown={handleDividerMouseDown}
          style={{
            width: 5,
            flexShrink: 0,
            cursor: 'col-resize',
            background: 'var(--border)',
            position: 'relative',
            transition: 'background 0.15s',
            zIndex: 10,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cyan)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--border)')}
        >
          {/* Grip dots */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex', flexDirection: 'column', gap: 3,
            pointerEvents: 'none',
          }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--text-dim)', opacity: 0.6 }} />
            ))}
          </div>
        </div>

        {/* ── RIGHT COLUMN — Job Queue + Live Log ─────────────────────────── */}
        <div id="qa-log-panel" style={{ width: logPanelWidth, flexShrink: 0, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Job queue panel — shown whenever there are active runs */}
          {activeRuns.length > 0 && (
            <JobQueuePanel
              runs={activeRuns}
              watchedRunId={watchedRunId}
              onSelect={switchToRun}
            />
          )}
          <LiveLog
            logs={logs}
            stats={stats}
            status={socketStatus}
            elapsedMs={elapsedMs}
            onStop={handleStopRun}
            isStopping={isStopping}
          />
        </div>
      </div>
    </div>
  );
}
