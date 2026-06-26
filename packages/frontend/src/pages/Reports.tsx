import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useRBAC } from '../hooks/useRBAC';
import { useProject } from '../hooks/useProjects';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import toast from 'react-hot-toast';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import RunHistoryTable from '../components/reports/RunHistoryTable';
import EmailConfig from '../components/reports/EmailConfig';
import FlakyTestTable from '../components/reports/FlakyTestTable';
import {
  useProjectStats,
  useRunTrend,
  useReportRuns,
} from '../hooks/useReports';
import { api } from '../lib/api';

// ── Stat tile (same shape as Dashboard) ───────────────────────────────────

function StatTile({
  label,
  value,
  suffix = '',
  accent,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  accent: string;
}) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        position: 'relative',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-card)',
        flex: 1,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: accent,
          borderRadius: '10px 10px 0 0',
        }}
      />
      <div
        style={{
          fontSize: 28,
          fontWeight: 800,
          color: '#F47B20',
          lineHeight: 1,
          marginTop: 4,
        }}
      >
        {value}
        {suffix}
      </div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-dim)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          marginTop: 3,
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ── Range tab ──────────────────────────────────────────────────────────────

function RangeTab({
  days,
  active,
  onClick,
}: {
  days: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 12px',
        borderRadius: 6,
        border: active ? '1px solid rgba(37,99,171,0.4)' : '1px solid var(--border)',
        background: active ? 'rgba(37,99,171,0.15)' : 'transparent',
        color: active ? 'var(--cyan)' : 'var(--text-dim)',
        fontSize: 11,
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
      }}
    >
      {days}d
    </button>
  );
}

// ── Chart tooltip ──────────────────────────────────────────────────────────

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ color: string; name: string; value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 12,
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: {p.value}
        </div>
      ))}
    </div>
  );
}

// ── Main Reports page ──────────────────────────────────────────────────────

export default function Reports() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const { data: project } = useProject(slug);
  const projectId = project?.id;

  // When navigated from TC Library run-history block, auto-open that run.
  const deepLinkedRunId = searchParams.get('run') ?? undefined;

  const [days, setDays] = useState(30);
  const [page, setPage] = useState(1);

  const { canAccessHealing } = useRBAC();
  const { data: stats } = useProjectStats(projectId);
  const { data: trend = [] } = useRunTrend(projectId, days);
  const { data: runsData } = useReportRuns(projectId, page);

  const runs = runsData?.runs ?? [];
  const totalPages = runsData?.pages ?? 1;

  const chartData = trend.map((p) => ({ ...p, date: p.date.slice(5) }));

  async function handleExport(runId: string) {
    try {
      const response = await api.get(`/projects/${projectId}/reports/runs/${runId}/export`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `run-report-${runId.slice(0, 8)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Export failed: ' + (e as Error).message);
    }
  }

  const avgRunTime = stats ? '—' : '—'; // placeholder for now

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: project?.name ?? slug ?? '' },
          { label: '📈 Reports' },
        ]}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <TbBtn
              variant="ghost"
              style={{ background: 'rgba(164,123,250,0.12)', color: 'var(--violet)', border: '1px solid rgba(164,123,250,0.3)' }}
              onClick={() => runs[0] && handleExport(runs[0].id)}
            >
              📥 Export Excel
            </TbBtn>
          </div>
        }
      />

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* ── 5-up stat tiles ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 12 }}>
          <StatTile
            label={`Total Runs (${days}d)`}
            value={runsData?.total ?? 0}
            accent="linear-gradient(90deg, var(--cyan), #2563AB)"
          />
          <StatTile
            label="Avg Pass Rate"
            value={stats?.avgPassRate ?? 0}
            suffix="%"
            accent="linear-gradient(90deg, var(--pass), #1a7a6e)"
          />
          <StatTile
            label="Flaky Tests"
            value={stats?.flakyTests.length ?? 0}
            accent="linear-gradient(90deg, var(--amber), var(--skip))"
          />
          {canAccessHealing && (
            <StatTile
              label="Pending Heals"
              value={stats?.pendingHeals ?? 0}
              accent="linear-gradient(90deg, var(--fail), #b91c1c)"
            />
          )}
          <StatTile
            label="Avg Run Time"
            value={avgRunTime}
            accent="linear-gradient(90deg, var(--violet), #7c3aed)"
          />
        </div>

        {/* ── 2-column main layout ──────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: 16, alignItems: 'start' }}>

          {/* LEFT column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Chart card */}
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                overflow: 'hidden',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div style={{ height: 3, background: 'var(--cool-accent)' }} />
              <div style={{ padding: '12px 16px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 14,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                    Run History — {days}-Day Trend
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[7, 30, 90].map((d) => (
                      <RangeTab
                        key={d}
                        days={d}
                        active={days === d}
                        onClick={() => { setDays(d); setPage(1); }}
                      />
                    ))}
                  </div>
                </div>
                {chartData.length === 0 ? (
                  <div
                    style={{
                      height: 200,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-dim)',
                      fontSize: 12,
                    }}
                  >
                    No run data in this period.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                      <Bar dataKey="passed" name="Pass" stackId="a" fill="var(--pass)" />
                      <Bar dataKey="failed" name="Fail" stackId="a" fill="var(--fail)" />
                      <Bar dataKey="skipped" name="Skip" stackId="a" fill="var(--skip)" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Run history table */}
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                overflow: 'hidden',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div style={{ height: 3, background: 'var(--warm-accent)' }} />
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                  Run History
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  {runsData?.total ?? 0} total
                </span>
              </div>
              <div style={{ padding: '12px 16px' }}>
                <RunHistoryTable
                  projectId={projectId}
                  runs={runs}
                  onExport={handleExport}
                  initialExpandedRunId={deepLinkedRunId}
                />
              </div>
              {/* Pagination */}
              {totalPages > 1 && (
                <div
                  style={{
                    padding: '10px 16px',
                    borderTop: '1px solid var(--border)',
                    display: 'flex',
                    gap: 8,
                    justifyContent: 'center',
                  }}
                >
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--surface2)',
                      color: 'var(--text-dim)',
                      cursor: page <= 1 ? 'not-allowed' : 'pointer',
                      fontSize: 11,
                    }}
                  >
                    ← Prev
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: '26px' }}>
                    Page {page} / {totalPages}
                  </span>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--surface2)',
                      color: 'var(--text-dim)',
                      cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                      fontSize: 11,
                    }}
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Flaky tests */}
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                overflow: 'hidden',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div
                style={{
                  height: 3,
                  background: 'linear-gradient(90deg, var(--amber), var(--skip))',
                }}
              />
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                  Flaky Tests
                </span>
                {(stats?.flakyTests.length ?? 0) > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: 'var(--amber)',
                      background: 'rgba(251,191,36,0.12)',
                      padding: '1px 7px',
                      borderRadius: 100,
                    }}
                  >
                    {stats!.flakyTests.length}
                  </span>
                )}
              </div>
              <div style={{ padding: '8px 0' }}>
                <FlakyTestTable tests={stats?.flakyTests ?? []} />
              </div>
            </div>

            {/* Email config */}
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                overflow: 'hidden',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div style={{ height: 3, background: 'var(--cool-accent)' }} />
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--text)',
                }}
              >
                📧 Email Reports
              </div>
              <div style={{ padding: '14px 16px' }}>
                <EmailConfig projectId={projectId ?? ''} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
