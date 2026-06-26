import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import type { ReportRun } from '../../types';
import { useReportRun } from '../../hooks/useReports';
import { useTriggerHeal } from '../../hooks/useHeals';
import { useRetryRun, useCreateIndividualRun } from '../../hooks/useRuns';
import { useRBAC } from '../../hooks/useRBAC';
import { api } from '../../lib/api';

interface RunHistoryTableProps {
  projectId: string | undefined;
  runs: ReportRun[];
  onExport?: (runId: string) => void;
  /** When set, this run card is expanded on mount and scrolled into view (deep-link from TC Library). */
  initialExpandedRunId?: string;
}

const STATUS_COLOR: Record<string, string> = {
  PASSED: 'var(--pass)',
  FAILED: 'var(--fail)',
  RUNNING: 'var(--cyan)',
  PENDING: 'var(--amber)',
  CANCELLED: 'var(--text-dim)',
  SKIPPED: 'var(--amber)',
};

const TRIGGER_LABEL: Record<string, string> = {
  MANUAL: 'Manual',
  SCHEDULED: 'Scheduled',
  INDIVIDUAL: 'Individual',
  GROUP: 'Group',
};

function formatDuration(startedAt?: string | null, completedAt?: string | null): string {
  if (!startedAt || !completedAt) return '—';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// ── Error cell with hover-reveal copy button ───────────────────────────────

function ErrorCell({ errorMessage }: { errorMessage: string | null }) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    if (!errorMessage) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(errorMessage);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = errorMessage;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!ok) throw new Error('execCommand failed');
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }

  if (!errorMessage) {
    return (
      <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)' }}>
        —
      </td>
    );
  }

  // Show the most informative line — skip "Test: …" label lines, prefer the actual error line
  const lines = errorMessage.split('\n').map(l => l.trim()).filter(Boolean);
  const summaryLine = lines.find(l => !l.startsWith('Test:') && !l.startsWith('Failed at:')) ?? lines[0] ?? errorMessage;
  const isMultiLine = lines.length > 1;

  return (
    <td
      style={{ padding: '7px 12px', overflow: 'hidden' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            title={errorMessage}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fail)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
            }}
          >
            {summaryLine.slice(0, 120)}
          </span>
          {isMultiLine && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(x => !x); }}
              title={expanded ? 'Collapse' : 'Show full error'}
              style={{
                flexShrink: 0,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'rgba(220,38,38,0.08)',
                color: 'var(--fail)',
                border: '1px solid rgba(220,38,38,0.25)',
                cursor: 'pointer',
                fontSize: 9,
                fontWeight: 700,
                fontFamily: 'var(--font-sans, sans-serif)',
                lineHeight: 1,
              }}
            >
              {expanded ? '▲' : '▼'}
            </button>
          )}
          <button
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy full error'}
            style={{
              flexShrink: 0,
              opacity: hovered ? 1 : 0,
              transition: 'opacity 0.15s',
              padding: '2px 6px',
              borderRadius: 4,
              background: copied ? 'rgba(42,157,143,0.15)' : 'rgba(220,38,38,0.12)',
              color: copied ? 'var(--pass)' : 'var(--fail)',
              border: `1px solid ${copied ? 'rgba(42,157,143,0.35)' : 'rgba(220,38,38,0.3)'}`,
              cursor: 'pointer',
              fontSize: 9,
              fontWeight: 700,
              fontFamily: 'var(--font-sans, sans-serif)',
              lineHeight: 1,
              pointerEvents: hovered ? 'auto' : 'none',
            }}
          >
            {copied ? '✓ Copied' : '⎘ Copy'}
          </button>
        </div>
        {expanded && isMultiLine && (
          <pre style={{
            margin: 0,
            padding: '6px 8px',
            borderRadius: 4,
            background: 'rgba(220,38,38,0.07)',
            border: '1px solid rgba(220,38,38,0.2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--fail)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 200,
            overflowY: 'auto',
          }}>
            {errorMessage}
          </pre>
        )}
      </div>
    </td>
  );
}

// ── Expanded run detail (lazy-fetched) ─────────────────────────────────────

function ExpandedRunDetail({
  projectId,
  runId,
  onExport,
  onHeal,
  isHealing,
  runStatus,
}: {
  projectId: string | undefined;
  runId: string;
  onExport?: (id: string) => void;
  onHeal?: () => void;
  isHealing?: boolean;
  runStatus: string;
}) {
  const { data: run, isLoading } = useReportRun(projectId, runId);
  const [query, setQuery] = useState('');
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const individualRun = useCreateIndividualRun(projectId ?? '');

  async function handleRerunTC(testCaseId: string) {
    if (!run) return;
    setRetryingIds((prev) => new Set(prev).add(testCaseId));
    try {
      await individualRun.mutateAsync({ testCaseId, environment: run.environment });
      toast.success('Test case queued for re-run');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to re-run test case';
      toast.error(msg);
    } finally {
      setRetryingIds((prev) => { const next = new Set(prev); next.delete(testCaseId); return next; });
    }
  }

  async function openRfHtml(resultId: string, type: 'rf-report' | 'rf-log', filename: string) {
    try {
      const response = await api.get(
        `/projects/${projectId}/reports/runs/${runId}/results/${resultId}/${type}`,
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(response.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      const axErr = err as { response?: { data?: unknown; status?: number }; message?: string };
      let msg = axErr?.message ?? 'Download failed';
      if (axErr?.response?.data instanceof Blob) {
        try {
          const text = await (axErr.response.data as Blob).text();
          const json = JSON.parse(text) as { error?: string };
          if (json.error) msg = json.error;
        } catch { /* keep default msg */ }
      }
      toast.error(`RF report download failed: ${msg}`);
    }
  }

  async function downloadAsset(resultId: string, type: 'screenshot' | 'trace' | 'video', filename: string, videoIndex?: number) {
    try {
      const requestUrl = type === 'video' && videoIndex !== undefined
        ? `/projects/${projectId}/reports/runs/${runId}/results/${resultId}/${type}?index=${videoIndex}`
        : `/projects/${projectId}/reports/runs/${runId}/results/${resultId}/${type}`;
      const response = await api.get(requestUrl, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      const axErr = err as { response?: { data?: unknown; status?: number }; message?: string };
      let msg = axErr?.message ?? 'Download failed';
      // When responseType:'blob', the error response body is a Blob — read it to extract the server message
      if (axErr?.response?.data instanceof Blob) {
        try {
          const text = await (axErr.response.data as Blob).text();
          const json = JSON.parse(text) as { error?: string };
          if (json.error) msg = json.error;
        } catch { /* keep default msg */ }
      }
      toast.error(`${type} download failed: ${msg}`);
    }
  }

  if (isLoading || !run) {
    return (
      <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
        {isLoading ? 'Loading results…' : 'No detail available.'}
      </div>
    );
  }

  const q = query.toLowerCase();
  const visibleResults = (run.results ?? []).filter(
    (r) => !q || r.testCase.title.toLowerCase().includes(q) || r.testCase.tcId.toLowerCase().includes(q),
  );

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      {/* Filter + summary row */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          type="text"
          placeholder="Filter test cases…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: 1,
            padding: '5px 10px',
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
            fontSize: 12,
            outline: 'none',
          }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
          {visibleResults.length} result{visibleResults.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Results table */}
      <div style={{ overflow: 'auto', maxHeight: 300 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '35%' }} />  {/* TC ID + Title */}
            <col style={{ width: '12%' }} />  {/* Suite */}
            <col style={{ width: 72 }} />  {/* Duration */}
            <col style={{ width: 80 }} />  {/* Status */}
            <col style={{ width: 44 }} />   {/* Re-run */}
            <col style={{ width: 150 }} />  {/* Assets */}
            <col />                          {/* Error — takes remaining space */}
          </colgroup>
          <thead>
            <tr>
              {['Title', 'Suite', 'Duration', 'Status', '', 'Assets', 'Error'].map((h, i) => (
                <th key={i} style={{
                  padding: '6px 12px',
                  textAlign: 'left',
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--text-dim)',
                  borderBottom: '1px solid var(--border)',
                  position: 'sticky',
                  top: 0,
                  background: 'var(--surface)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleResults.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
                  No results found.
                </td>
              </tr>
            ) : visibleResults.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--border)', background: r.status === 'FAILED' ? 'rgba(220,38,38,0.04)' : r.status === 'SKIPPED' ? 'rgba(251,191,36,0.04)' : 'transparent' }}>
                <td style={{ padding: '7px 12px', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                      {r.testCase.tcId}
                    </span>
                    <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.testCase.title}
                    </span>
                  </div>
                </td>
                <td style={{ padding: '7px 12px', color: 'var(--text-dim)', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.testCase.useCaseTag ?? '—'}
                </td>
                <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                  {r.duration ? `${(r.duration / 1000).toFixed(1)}s` : '—'}
                </td>
                <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: STATUS_COLOR[r.status] ?? 'var(--text-dim)' }}>
                    {r.status}
                  </span>
                </td>
                {/* Re-run button */}
                <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>
                  <button
                    onClick={() => handleRerunTC(r.testCase.id)}
                    disabled={retryingIds.has(r.testCase.id)}
                    title="Re-run this test case"
                    style={{
                      padding: '2px 7px',
                      borderRadius: 5,
                      background: retryingIds.has(r.testCase.id) ? 'rgba(37,99,171,0.06)' : 'rgba(37,99,171,0.12)',
                      color: retryingIds.has(r.testCase.id) ? 'rgba(37,99,171,0.4)' : 'var(--cyan)',
                      border: '1px solid rgba(37,99,171,0.25)',
                      cursor: retryingIds.has(r.testCase.id) ? 'not-allowed' : 'pointer',
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  >
                    {retryingIds.has(r.testCase.id) ? '⏳' : '↻'}
                  </button>
                </td>
                <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {r.screenshotPath && (
                      <button
                        onClick={() => downloadAsset(r.id, 'screenshot', `screenshot-${r.testCase.tcId}.png`)}
                        title="Download screenshot"
                        style={{
                          padding: '2px 7px',
                          borderRadius: 5,
                          background: 'rgba(37,99,171,0.12)',
                          color: 'var(--cyan)',
                          border: '1px solid rgba(37,99,171,0.25)',
                          cursor: 'pointer',
                          fontSize: 10,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        📷 PNG
                      </button>
                    )}
                    {r.videoPath && (
                      <button
                        onClick={() => {
                          const isMultiple = r.videoPath!.startsWith('[');
                          const filename = isMultiple
                            ? `videos-${r.testCase.tcId}.zip`
                            : `video-${r.testCase.tcId}.webm`;
                          downloadAsset(r.id, 'video', filename);
                        }}
                        title="Download video recording"
                        style={{
                          padding: '2px 7px',
                          borderRadius: 5,
                          background: 'rgba(42,157,143,0.12)',
                          color: 'var(--pass)',
                          border: '1px solid rgba(42,157,143,0.25)',
                          cursor: 'pointer',
                          fontSize: 10,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        🎬 Video
                      </button>
                    )}
                    {r.tracePath && (
                      <button
                        onClick={() => downloadAsset(r.id, 'trace', `trace-${r.testCase.tcId}.zip`)}
                        title="Download Playwright trace"
                        style={{
                          padding: '2px 7px',
                          borderRadius: 5,
                          background: 'rgba(164,123,250,0.12)',
                          color: 'var(--violet)',
                          border: '1px solid rgba(164,123,250,0.25)',
                          cursor: 'pointer',
                          fontSize: 10,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        🔍 Trace
                      </button>
                    )}
                    {r.rfLogPath && (
                      <button
                        onClick={() => openRfHtml(r.id, 'rf-log', `rf-log-${r.testCase.tcId}.html`)}
                        title="Download RF log"
                        style={{
                          padding: '2px 7px',
                          borderRadius: 5,
                          background: 'rgba(234,179,8,0.08)',
                          color: '#ca8a04',
                          border: '1px solid rgba(234,179,8,0.2)',
                          cursor: 'pointer',
                          fontSize: 10,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        Log
                      </button>
                    )}
                    {!r.screenshotPath && !r.videoPath && !r.tracePath && !r.rfLogPath && (
                      <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>—</span>
                    )}
                  </div>
                </td>
                <ErrorCell errorMessage={r.errorMessage ?? null} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer actions */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface2)' }}>
        {onExport && (
          <button
            onClick={() => onExport(runId)}
            style={{
              padding: '5px 14px',
              borderRadius: 6,
              background: 'rgba(164,123,250,0.12)',
              color: 'var(--violet)',
              border: '1px solid rgba(164,123,250,0.25)',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            📥 Download Excel Report
          </button>
        )}
        {onHeal && runStatus === 'FAILED' && (
          <button
            onClick={onHeal}
            disabled={isHealing}
            style={{
              padding: '5px 14px',
              borderRadius: 6,
              background: isHealing ? 'rgba(244,123,32,0.06)' : 'rgba(244,123,32,0.12)',
              color: isHealing ? 'rgba(244,123,32,0.5)' : '#F47B20',
              border: '1px solid rgba(244,123,32,0.25)',
              cursor: isHealing ? 'not-allowed' : 'pointer',
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {isHealing ? '⏳ Sending…' : '🔧 Heal Failed'}
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          {runId.slice(0, 20)}…
        </span>
      </div>
    </div>
  );
}

// ── Main table ─────────────────────────────────────────────────────────────

export default function RunHistoryTable({ projectId, runs, onExport, initialExpandedRunId }: RunHistoryTableProps) {
  // Seed the expanded set with the deep-linked run so it opens on mount.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => initialExpandedRunId ? new Set([initialExpandedRunId]) : new Set(),
  );

  // Scroll the deep-linked run card into view once the list has rendered.
  useEffect(() => {
    if (!initialExpandedRunId) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`run-card-${initialExpandedRunId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120); // wait one paint so the expanded card has rendered
    return () => clearTimeout(timer);
  }, [initialExpandedRunId]);

  const { canAccessHealing } = useRBAC();
  const triggerHeal = useTriggerHeal(projectId ?? '', () => {
    toast('No failed tests found in this run', { icon: '⚠️' });
  });
  const retryRun = useRetryRun(projectId ?? '');

  async function handleRetryRun(runId: string) {
    try {
      await retryRun.mutateAsync(runId);
      toast.success('Run queued for retry');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to retry run';
      toast.error(msg);
    }
  }

  async function handleHeal(runId: string) {
    try {
      const result = await triggerHeal.mutateAsync({ runId });
      if (result.count > 0) {
        toast.success(`${result.count} failed test${result.count !== 1 ? 's' : ''} sent to Healing Agent`);
      }
    } catch {
      toast.error('Failed to trigger heal — check logs');
    }
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (runs.length === 0) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
        No runs found.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {runs.map((run) => {
        const isOpen = expanded.has(run.id);
        const passed = run.results.filter((r) => r.status === 'PASSED').length;
        const failed = run.results.filter((r) => r.status === 'FAILED').length;
        const skipped = run.results.filter((r) => r.status === 'SKIPPED').length;
        const total = run._count.results;
        const ran = total - skipped;
        const passRate = ran > 0 ? Math.round((passed / ran) * 100) : (skipped > 0 ? 100 : 0);

        return (
          <div key={run.id} id={`run-card-${run.id}`} style={{ background: 'var(--surface)', border: `1px solid ${initialExpandedRunId === run.id ? 'rgba(37,99,171,0.5)' : 'var(--border)'}`, borderRadius: 10, overflow: 'hidden', boxShadow: initialExpandedRunId === run.id ? '0 0 0 2px rgba(37,99,171,0.18)' : 'none', transition: 'box-shadow 0.3s, border-color 0.3s' }}>
            {/* Header row */}
            <div
              style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 12, cursor: 'pointer' }}
              onClick={() => toggle(run.id)}
            >
              <span style={{ fontSize: 10, color: 'var(--text-dim)', transition: 'transform 0.15s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block', flexShrink: 0 }}>
                ▶
              </span>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[run.status] ?? 'var(--text-dim)', flexShrink: 0, display: 'inline-block' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{
                    flexShrink: 0,
                    fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)',
                    padding: '2px 7px', borderRadius: 5,
                    background: 'rgba(37,99,171,0.12)',
                    color: 'var(--cyan)',
                    border: '1px solid rgba(37,99,171,0.25)',
                    whiteSpace: 'nowrap',
                  }}>
                    #{String(run.runSeq).padStart(4, '0')}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {run.name}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  {new Date(run.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  {' · '}{run.environment}
                  {' · '}{TRIGGER_LABEL[run.triggerType] ?? run.triggerType}
                  {' · '}{formatDuration(run.startedAt, run.completedAt)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--pass)' }}>✓ {passed}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fail)' }}>✗ {failed}</span>
                {skipped > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)' }}>⊙ {skipped}</span>}
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 100,
                  background: passRate >= 90 ? 'rgba(42,157,143,0.15)' : passRate >= 70 ? 'rgba(251,191,36,0.15)' : 'rgba(220,38,38,0.15)',
                  color: passRate >= 90 ? 'var(--pass)' : passRate >= 70 ? 'var(--amber)' : 'var(--fail)',
                }}>
                  {passRate}%
                </span>
              </div>
              {/* Quick action buttons — stop propagation so they don't toggle the row */}
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                {(run.status === 'PASSED' || run.status === 'FAILED' || run.status === 'CANCELLED') && (
                  <button
                    onClick={() => handleRetryRun(run.id)}
                    disabled={retryRun.isPending}
                    title="Re-run all test cases from this run"
                    style={{
                      padding: '3px 10px', borderRadius: 6,
                      background: retryRun.isPending ? 'rgba(37,99,171,0.06)' : 'rgba(37,99,171,0.12)',
                      color: retryRun.isPending ? 'rgba(37,99,171,0.4)' : 'var(--cyan)',
                      border: '1px solid rgba(37,99,171,0.25)',
                      cursor: retryRun.isPending ? 'not-allowed' : 'pointer',
                      fontSize: 11, fontWeight: 600,
                    }}
                  >
                    {retryRun.isPending ? '⏳' : '↻'} Retry
                  </button>
                )}
                {canAccessHealing && failed > 0 && (run.status === 'FAILED') && (
                  <button
                    onClick={() => handleHeal(run.id)}
                    disabled={triggerHeal.isPending}
                    title="Send failed tests to Healing Agent"
                    style={{
                      padding: '3px 10px', borderRadius: 6,
                      background: triggerHeal.isPending ? 'rgba(244,123,32,0.06)' : 'rgba(244,123,32,0.12)',
                      color: triggerHeal.isPending ? 'rgba(244,123,32,0.45)' : '#F47B20',
                      border: '1px solid rgba(244,123,32,0.25)',
                      cursor: triggerHeal.isPending ? 'not-allowed' : 'pointer',
                      fontSize: 11, fontWeight: 600,
                    }}
                  >
                    🔧 Heal
                  </button>
                )}
                {onExport && (
                  <button
                    onClick={() => onExport(run.id)}
                    style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(164,123,250,0.12)', color: 'var(--violet)', border: '1px solid rgba(164,123,250,0.25)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
                  >
                    Export
                  </button>
                )}
              </div>
            </div>

            {/* Expanded detail — lazily fetched */}
            {isOpen && (
              <ExpandedRunDetail
                projectId={projectId}
                runId={run.id}
                onExport={onExport}
                onHeal={() => handleHeal(run.id)}
                isHealing={triggerHeal.isPending}
                runStatus={run.status}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
