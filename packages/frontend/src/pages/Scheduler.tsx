import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useRBAC } from '../hooks/useRBAC';
import {
  useSchedules,
  useCreateSchedule,
  useUpdateSchedule,
  useDeleteSchedule,
  useRunNow,
  useRuns,
  useCreateRun,
} from '../hooks/useRuns';
import { useSuites, useCreateSuite, useUpdateSuite, useDeleteSuite, useRunSuite } from '../hooks/useSuites';
import { useScripts } from '../hooks/useScripts';
import { useProjectStore } from '../stores/projectStore';
import type { Schedule, Suite, SuiteStage, TestCase, EnvConfig } from '../types';
import { api } from '../lib/api';
import type { RunListItem } from '../hooks/useRuns';

// ── Stepper ────────────────────────────────────────────────────────────────
function Stepper({ value, onChange, min = 1, max = 8 }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      <button onClick={() => onChange(Math.max(min, value - 1))} style={{ width: 26, height: 26, borderRadius: '5px 0 0 5px', background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
      <div style={{ width: 36, height: 26, borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--text)', background: 'var(--surface2)' }}>{value}</div>
      <button onClick={() => onChange(Math.min(max, value + 1))} style={{ width: 26, height: 26, borderRadius: '0 5px 5px 0', background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
    </div>
  );
}

// ── Frequency config ───────────────────────────────────────────────────────

type FreqMode = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'hourly' | 'custom';

interface FreqConfig {
  mode: FreqMode;
  hour12: number;
  minute: number;
  ampm: 'AM' | 'PM';
  weekday: number;
  monthDay: number;
  intervalHours: number;
  customCron: string;
}

const DEFAULT_FREQ: FreqConfig = {
  mode: 'daily',
  hour12: 9,
  minute: 0,
  ampm: 'AM',
  weekday: 1,
  monthDay: 1,
  intervalHours: 1,
  customCron: '0 9 * * *',
};

function to24h(h12: number, ampm: 'AM' | 'PM'): number {
  if (ampm === 'AM') return h12 === 12 ? 0 : h12;
  return h12 === 12 ? 12 : h12 + 12;
}

function to12h(h24: number): { hour12: number; ampm: 'AM' | 'PM' } {
  return {
    ampm: h24 >= 12 ? 'PM' : 'AM',
    hour12: h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24,
  };
}

function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

function buildCron(f: FreqConfig): string {
  if (f.mode === 'custom') return f.customCron.trim();
  const h = to24h(f.hour12, f.ampm);
  const m = f.minute;
  switch (f.mode) {
    case 'hourly':   return f.intervalHours === 1 ? '0 * * * *' : `0 */${f.intervalHours} * * *`;
    case 'daily':    return `${m} ${h} * * *`;
    case 'weekdays': return `${m} ${h} * * 1-5`;
    case 'weekly':   return `${m} ${h} * * ${f.weekday}`;
    case 'monthly':  return `${m} ${h} ${f.monthDay} * *`;
  }
}

function freqToHuman(f: FreqConfig): string {
  if (f.mode === 'custom') return f.customCron || '—';
  const m = f.minute.toString().padStart(2, '0');
  const time = `${f.hour12}:${m} ${f.ampm}`;
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  switch (f.mode) {
    case 'hourly':   return f.intervalHours === 1 ? 'Every hour' : `Every ${f.intervalHours} hours`;
    case 'daily':    return `Every day at ${time}`;
    case 'weekdays': return `Every weekday (Mon–Fri) at ${time}`;
    case 'weekly':   return `Every ${DAYS[f.weekday]} at ${time}`;
    case 'monthly':  return `${f.monthDay}${ordinal(f.monthDay)} of every month at ${time}`;
  }
}

function parseCronToFreq(cron: string): FreqConfig {
  const t = cron.trim();
  const p = t.split(/\s+/);
  if (p.length !== 5) return { ...DEFAULT_FREQ, mode: 'custom', customCron: cron };
  const [min, hour, day, month, weekday] = p;
  if (hour === '*' && min === '0') return { ...DEFAULT_FREQ, mode: 'hourly', intervalHours: 1 };
  const ih = hour.match(/^\*\/(\d+)$/);
  if (ih && min === '0') return { ...DEFAULT_FREQ, mode: 'hourly', intervalHours: parseInt(ih[1]) };
  const mn = parseInt(min, 10);
  const hn = parseInt(hour, 10);
  if (!isNaN(mn) && !isNaN(hn)) {
    const { hour12, ampm } = to12h(hn);
    const base = { ...DEFAULT_FREQ, hour12, minute: mn, ampm };
    if (weekday === '1-5' && day === '*' && month === '*') return { ...base, mode: 'weekdays' };
    if (weekday === '*' && day === '*' && month === '*') return { ...base, mode: 'daily' };
    if (/^\d$/.test(weekday) && day === '*' && month === '*') return { ...base, mode: 'weekly', weekday: parseInt(weekday) };
    if (/^\d+$/.test(day) && month === '*' && weekday === '*') return { ...base, mode: 'monthly', monthDay: parseInt(day) };
  }
  return { ...DEFAULT_FREQ, mode: 'custom', customCron: cron };
}

// ── Quick-pick suite definitions (tag-based) ───────────────────────────────

const QUICK_SUITES = [
  { id: 'smoke',      emoji: '🔥', label: 'Smoke' },
  { id: 'regression', emoji: '🔄', label: 'Regression' },
  { id: 'api',        emoji: '🔌', label: 'API' },
  { id: 'sit',        emoji: '🔗', label: 'SIT' },
] as const;

// ── Helpers ────────────────────────────────────────────────────────────────

function parseStages(raw: string): SuiteStage[] {
  try { return JSON.parse(raw) as SuiteStage[]; } catch { return []; }
}

function parseTcIds(raw: string): string[] {
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

// ── TC library visual constants ────────────────────────────────────────────

const UC_COLORS: Record<string, string> = {
  'Primary Sales':           'var(--violet)',
  'Stock Management':        'var(--amber)',
  'Dealer Onboarding & KYC': 'var(--emerald)',
  'Sales API':               'var(--cyan)',
  'Secondary Sales':         'var(--rose)',
  'Distributor API':         'var(--sky)',
};
const UC_FALLBACKS = ['--violet', '--cyan', '--emerald', '--amber', '--rose', '--sky'];
function ucColor(name: string, idx: number) {
  return UC_COLORS[name] ?? `var(${UC_FALLBACKS[idx % UC_FALLBACKS.length]})`;
}

const TYPE_META: Record<string, { label: string; bg: string; color: string }> = {
  UI:  { label: 'UI',  bg: 'rgba(34,211,238,0.12)',  color: 'var(--cyan)' },
  API: { label: 'API', bg: 'rgba(42,157,143,0.12)',  color: 'var(--pass)' },
  SIT: { label: 'SIT', bg: 'rgba(244,123,32,0.12)',  color: 'var(--skip)' },
};


// ── Stat tile ──────────────────────────────────────────────────────────────

function StatTile({ label, value, color, accent, suffix = '' }: {
  label: string; value: number; color: string; accent: string; suffix?: string;
}) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 3,
      position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow-card)', flex: 1,
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accent, borderRadius: '10px 10px 0 0' }} />
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1, marginTop: 4 }}>{value}{suffix}</div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 3 }}>{label}</div>
    </div>
  );
}

// ── Trigger type meta ──────────────────────────────────────────────────────

const TRIGGER_META: Record<string, { label: string; color: string; bg: string }> = {
  SCHEDULED:  { label: 'Scheduled',  color: 'var(--cyan)',  bg: 'rgba(37,99,171,0.12)' },
  MANUAL:     { label: 'Manual',     color: 'var(--pass)',  bg: 'rgba(42,157,143,0.10)' },
  GROUP:      { label: 'Group',      color: '#8b5cf6',      bg: 'rgba(139,92,246,0.10)' },
  INDIVIDUAL: { label: 'Individual', color: 'var(--amber)', bg: 'rgba(251,191,36,0.10)' },
  HEAL_RERUN: { label: 'Heal',       color: 'var(--fail)',  bg: 'rgba(220,38,38,0.10)'  },
};

// ── Active run progress card ───────────────────────────────────────────────

function ActiveRunCard({ run }: { run: RunListItem }) {
  const passed  = run.results.filter(r => r.status === 'PASSED').length;
  const failed  = run.results.filter(r => r.status === 'FAILED').length;
  const skipped = run.results.filter(r => r.status === 'SKIPPED').length;
  const total   = run._count.results;
  const done    = passed + failed + skipped;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;
  const isRunning = run.status === 'RUNNING';
  const trigMeta = TRIGGER_META[run.triggerType] ?? TRIGGER_META.MANUAL;

  return (
    <div style={{
      background: 'var(--surface2)',
      border: `1px solid ${isRunning ? 'rgba(37,99,171,0.35)' : 'rgba(255,179,71,0.3)'}`,
      borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* left accent stripe */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: trigMeta.color, borderRadius: '10px 0 0 10px' }} />
      <div style={{ paddingLeft: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{run.name}</div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{run.environment} · {total} test{total !== 1 ? 's' : ''}</div>
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
            <span style={{
              fontSize: 9, fontWeight: 700, textTransform: 'uppercase', padding: '2px 7px', borderRadius: 100,
              background: trigMeta.bg, color: trigMeta.color,
            }}>{trigMeta.label}</span>
            <span style={{
              fontSize: 9, fontWeight: 700, textTransform: 'uppercase', padding: '2px 7px', borderRadius: 100,
              background: isRunning ? 'rgba(37,99,171,0.12)' : 'rgba(255,179,71,0.12)',
              color: isRunning ? 'var(--cyan)' : 'var(--skip)',
            }}>{isRunning ? '● Running' : '⏳ Pending'}</span>
          </div>
        </div>
        {total > 0 ? (
          <div style={{ marginTop: 4 }}>
            <div style={{ height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 3, transition: 'width 0.4s ease',
                width: `${progress}%`,
                background: failed > 0 ? 'linear-gradient(90deg,#2A9D8F,#DC2626)' : '#2A9D8F',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: 'var(--text-dim)' }}>
              <span>{done} / {total} done · {progress}%</span>
              <span>
                {passed > 0 && <span style={{ color: 'var(--pass)', marginRight: 6 }}>✓ {passed}</span>}
                {failed > 0 && <span style={{ color: 'var(--fail)' }}>✗ {failed}</span>}
                {skipped > 0 && <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>⊙ {skipped}</span>}
              </span>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-dim)' }}>Waiting to start…</div>
        )}
      </div>
    </div>
  );
}

// ── Time picker ────────────────────────────────────────────────────────────

function TimePicker({ value, onChange }: { value: FreqConfig; onChange: (p: Partial<FreqConfig>) => void }) {
  const sel: React.CSSProperties = {
    padding: '6px 8px', background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text)', fontSize: 12, outline: 'none', cursor: 'pointer',
  };
  return (
    <>
      <select value={value.hour12} onChange={e => onChange({ hour12: parseInt(e.target.value) })} style={sel}>
        {[1,2,3,4,5,6,7,8,9,10,11,12].map(h => <option key={h} value={h}>{h}</option>)}
      </select>
      <span style={{ fontSize: 13, color: 'var(--text-dim)', fontWeight: 700 }}>:</span>
      <select value={value.minute} onChange={e => onChange({ minute: parseInt(e.target.value) })} style={sel}>
        {[0,15,30,45].map(m => <option key={m} value={m}>{m.toString().padStart(2,'0')}</option>)}
      </select>
      <select value={value.ampm} onChange={e => onChange({ ampm: e.target.value as 'AM' | 'PM' })} style={sel}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </>
  );
}

// ── Frequency picker ───────────────────────────────────────────────────────

const FREQ_MODES: { id: FreqMode; label: string }[] = [
  { id: 'daily',    label: 'Daily' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly',   label: 'Weekly' },
  { id: 'monthly',  label: 'Monthly' },
  { id: 'hourly',   label: 'Hourly' },
  { id: 'custom',   label: 'Custom cron' },
];

const DAYS_OF_WEEK = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const HOUR_INTERVALS = [1,2,3,4,6,8,12];

function FrequencyPicker({ value, onChange }: { value: FreqConfig; onChange: (v: FreqConfig) => void }) {
  const set = (p: Partial<FreqConfig>) => onChange({ ...value, ...p });
  const sel: React.CSSProperties = {
    padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text)', fontSize: 12, outline: 'none', cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {FREQ_MODES.map(m => (
          <button key={m.id} type="button" onClick={() => set({ mode: m.id })} style={{
            padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            background: value.mode === m.id ? 'rgba(34,211,238,0.12)' : 'var(--bg)',
            border: value.mode === m.id ? '1px solid var(--cyan)' : '1px solid var(--border)',
            color: value.mode === m.id ? 'var(--cyan)' : 'var(--text-mid)',
            transition: 'all 0.15s',
          }}>{m.label}</button>
        ))}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        padding: '12px 14px', background: 'var(--bg)',
        border: '1px solid var(--border)', borderRadius: 8, minHeight: 46,
      }}>
        {value.mode === 'hourly' && (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>Every</span>
            <select value={value.intervalHours} onChange={e => set({ intervalHours: parseInt(e.target.value) })} style={sel}>
              {HOUR_INTERVALS.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>hour{value.intervalHours !== 1 ? 's' : ''}</span>
          </>
        )}
        {value.mode === 'daily' && (
          <><span style={{ fontSize: 12, color: 'var(--text-mid)' }}>Every day at</span><TimePicker value={value} onChange={set} /></>
        )}
        {value.mode === 'weekdays' && (
          <><span style={{ fontSize: 12, color: 'var(--text-mid)' }}>Mon – Fri at</span><TimePicker value={value} onChange={set} /></>
        )}
        {value.mode === 'weekly' && (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>Every</span>
            <select value={value.weekday} onChange={e => set({ weekday: parseInt(e.target.value) })} style={sel}>
              {DAYS_OF_WEEK.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
            <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>at</span>
            <TimePicker value={value} onChange={set} />
          </>
        )}
        {value.mode === 'monthly' && (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>On the</span>
            <select value={value.monthDay} onChange={e => set({ monthDay: parseInt(e.target.value) })} style={sel}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                <option key={d} value={d}>{d}{ordinal(d)}</option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>at</span>
            <TimePicker value={value} onChange={set} />
          </>
        )}
        {value.mode === 'custom' && (
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              {['MIN','HOUR','DAY','MONTH','WEEKDAY'].map((label, i) => {
                const parts = value.customCron.trim().split(/\s+/);
                return (
                  <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', textAlign: 'center' }}>{label}</div>
                    <input
                      value={parts[i] ?? '*'}
                      onChange={e => {
                        const arr = [...Array(5).fill('*').map((v, idx) => parts[idx] ?? v)];
                        arr[i] = e.target.value || '*';
                        set({ customCron: arr.join(' ') });
                      }}
                      style={{
                        width: '100%', padding: '5px 4px', textAlign: 'center', boxSizing: 'border-box',
                        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5,
                        color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)', outline: 'none',
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'center' }}>
              Standard cron · <a href="https://crontab.guru" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cyan)', textDecoration: 'none' }}>crontab.guru ↗</a>
            </div>
          </div>
        )}
      </div>

      <div style={{
        padding: '6px 12px', background: 'rgba(34,211,238,0.06)',
        border: '1px solid rgba(34,211,238,0.15)', borderRadius: 6,
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 11,
      }}>
        <span>⏰</span>
        <span style={{ fontWeight: 600, color: 'var(--text-mid)' }}>{freqToHuman(value)}</span>
        <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>({buildCron(value)})</span>
      </div>
    </div>
  );
}

// ── TC library selector (use-case grouped, type badges, status dots) ────────

function TcLibrarySelector({ testCases, selected, onChange, maxHeight = 340, scriptedTcIds = new Set() }: {
  testCases: TestCase[];
  selected: string[];
  onChange: (ids: string[]) => void;
  maxHeight?: number;
  scriptedTcIds?: Set<string>;
}) {
  const [search, setSearch] = useState('');
  const [autoFilter, setAutoFilter] = useState<'' | 'automated' | 'manual'>('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    let tcs = testCases;
    if (autoFilter === 'automated') tcs = tcs.filter(tc => scriptedTcIds.has(tc.id));
    if (autoFilter === 'manual') tcs = tcs.filter(tc => !scriptedTcIds.has(tc.id));
    if (search) {
      const q = search.toLowerCase();
      tcs = tcs.filter(tc =>
        tc.title.toLowerCase().includes(q) ||
        tc.tcId.toLowerCase().includes(q) ||
        (tc.useCaseTag ?? '').toLowerCase().includes(q),
      );
    }
    return tcs;
  }, [testCases, search, autoFilter, scriptedTcIds]);

  const groups = useMemo(() => {
    const order = [
      'Primary Sales', 'Stock Management', 'Dealer Onboarding & KYC',
      'Sales API', 'Secondary Sales', 'Distributor API',
    ];
    const map = new Map<string, TestCase[]>();
    order.forEach(uc => map.set(uc, []));
    for (const tc of filtered) {
      const k = tc.useCaseTag ?? 'Ungrouped';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(tc);
    }
    return Array.from(map.entries())
      .filter(([, tcs]) => tcs.length > 0)
      .map(([name, tcs], i) => ({
        name,
        tcs: [...tcs].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
        color: ucColor(name, i),
      }));
  }, [filtered]);

  useEffect(() => {
    if (search || autoFilter) setExpanded(new Set(groups.map(g => g.name)));
  }, [search, autoFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleGroup(name: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }

  function selectGroup(tcs: TestCase[]) {
    const ids = tcs.map(t => t.id);
    const all = ids.every(id => selected.includes(id));
    onChange(all ? selected.filter(id => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
  }

  function selectTc(id: string) {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  }

  const automatedCount = testCases.filter(tc => scriptedTcIds.has(tc.id)).length;
  const manualCount = testCases.length - automatedCount;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>
          Test Cases
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, color: 'var(--text-dim)' }}>
          <span style={{ fontWeight: 600 }}>{selected.length} / {testCases.length} selected</span>
          {testCases.length > 0 && (
            <button type="button"
              onClick={() => onChange(selected.length === filtered.length ? [] : [...new Set([...selected, ...filtered.map(t => t.id)])])}
              style={{ fontSize: 10, fontWeight: 600, color: 'var(--cyan)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              {filtered.every(t => selected.includes(t.id)) ? 'Deselect all' : 'Select all'}
            </button>
          )}
        </div>
      </div>

      {/* Automation filter tabs */}
      <div style={{ display: 'flex', gap: 4 }}>
        {([
          ['', 'All', testCases.length, undefined],
          ['automated', 'Automated', automatedCount, 'var(--pass)'],
          ['manual', 'Manual', manualCount, 'var(--amber)'],
        ] as [string, string, number, string | undefined][]).map(([val, label, count, dot]) => (
          <button key={val} type="button"
            onClick={() => setAutoFilter(val as '' | 'automated' | 'manual')}
            style={{
              padding: '3px 10px', borderRadius: 5, fontSize: 10, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              background: autoFilter === val ? 'rgba(34,211,238,0.12)' : 'var(--bg)',
              border: autoFilter === val ? '1px solid var(--cyan)' : '1px solid var(--border)',
              color: autoFilter === val ? 'var(--cyan)' : 'var(--text-mid)',
            }}>
            {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, display: 'inline-block' }} />}
            {label}
            <span style={{
              fontSize: 9, padding: '0px 5px', borderRadius: 100,
              background: autoFilter === val ? 'rgba(34,211,238,0.2)' : 'rgba(100,116,139,0.12)',
              color: autoFilter === val ? 'var(--cyan)' : 'var(--text-dim)', fontWeight: 700,
            }}>{count}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <input type="text" value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search by title, TC ID, or use case…"
        style={{
          width: '100%', padding: '7px 10px', boxSizing: 'border-box',
          background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 6, color: 'var(--text)', fontSize: 12, outline: 'none', fontFamily: 'var(--font-ui)',
        }}
      />

      {/* TC list */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight, overflowY: 'auto', background: 'var(--bg)' }}>
        {groups.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
            {testCases.length === 0
              ? 'No test cases in this project yet.'
              : search || autoFilter ? 'No matches.' : 'No test cases found.'}
          </div>
        ) : groups.map(({ name, tcs, color }) => {
          const sel = tcs.filter(tc => selected.includes(tc.id)).length;
          const isOpen = expanded.has(name);
          const allSel = sel === tcs.length;
          const someSel = sel > 0 && !allSel;
          return (
            <div key={name}>
              {/* Group header */}
              <div
                onClick={() => toggleGroup(name)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px 8px 0', background: 'var(--surface)',
                  borderBottom: '1px solid var(--border)', cursor: 'pointer',
                  userSelect: 'none', position: 'relative',
                }}
              >
                {/* Color strip */}
                <div style={{ width: 3, alignSelf: 'stretch', background: color, borderRadius: '0 2px 2px 0', flexShrink: 0 }} />

                <input type="checkbox"
                  ref={el => { if (el) el.indeterminate = someSel; }}
                  checked={allSel}
                  onChange={() => selectGroup(tcs)}
                  onClick={e => e.stopPropagation()}
                  style={{ accentColor: 'var(--cyan)', cursor: 'pointer', flexShrink: 0 }}
                />

                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', flex: 1 }}>{name}</span>

                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 100,
                  background: sel > 0 ? 'rgba(34,211,238,0.14)' : 'rgba(100,116,139,0.1)',
                  color: sel > 0 ? 'var(--cyan)' : 'var(--text-dim)',
                }}>{sel}/{tcs.length}</span>

                <span style={{ fontSize: 9, color: 'var(--text-dim)', width: 12, textAlign: 'center' }}>
                  {isOpen ? '▼' : '▶'}
                </span>
              </div>

              {/* TC rows */}
              {isOpen && tcs.map((tc, idx) => {
                const isSelected = selected.includes(tc.id);
                const typeMeta = TYPE_META[tc.type] ?? TYPE_META.UI;
                const isAutomated = scriptedTcIds.has(tc.id);
                return (
                  <label key={tc.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px 8px 14px', cursor: 'pointer',
                    borderBottom: idx < tcs.length - 1 ? '1px solid var(--border)' : undefined,
                    background: isSelected ? 'rgba(34,211,238,0.04)' : 'transparent',
                    transition: 'background 0.1s',
                  }}>
                    {/* Left color accent */}
                    <div style={{ width: 2, alignSelf: 'stretch', background: isSelected ? color : 'transparent', borderRadius: 2, flexShrink: 0, transition: 'background 0.15s' }} />

                    <input type="checkbox" checked={isSelected} onChange={() => selectTc(tc.id)}
                      style={{ accentColor: 'var(--cyan)', flexShrink: 0 }} />

                    {/* Type badge */}
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                      background: typeMeta.bg, color: typeMeta.color, flexShrink: 0,
                    }}>{typeMeta.label}</span>

                    {/* Title + tcId */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 11, fontWeight: isSelected ? 600 : 500,
                        color: isSelected ? 'var(--text)' : 'var(--text-mid)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{tc.title}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', marginTop: 1 }}>
                        {tc.tcId}
                      </div>
                    </div>

                    {/* Automation status */}
                    <span title={isAutomated ? 'Automated' : 'No script'} style={{
                      fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                      background: isAutomated ? 'rgba(42,157,143,0.12)' : 'rgba(251,191,36,0.10)',
                      color: isAutomated ? 'var(--pass)' : 'var(--amber)',
                      border: `1px solid ${isAutomated ? 'rgba(42,157,143,0.25)' : 'rgba(251,191,36,0.25)'}`,
                    }}>{isAutomated ? '⚡' : '—'}</span>
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Suite selector (dropdown + quick-pick chips) ───────────────────────────

function SuiteSelector({ suites, testCases, selectedIds, onChange }: {
  suites: Suite[];
  testCases: TestCase[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  // Derive which quick-pick suite is active (all its TCs selected)
  function quickSuiteTcs(suiteId: string): string[] {
    return testCases.filter(tc => tc.tags.includes(`suite:${suiteId}`)).map(tc => tc.id);
  }

  function isQuickSelected(suiteId: string): boolean {
    const ids = quickSuiteTcs(suiteId);
    return ids.length > 0 && ids.every(id => selectedIds.includes(id));
  }

  function isQuickPartial(suiteId: string): boolean {
    const ids = quickSuiteTcs(suiteId);
    return ids.some(id => selectedIds.includes(id)) && !isQuickSelected(suiteId);
  }

  function toggleQuickSuite(suiteId: string) {
    const ids = quickSuiteTcs(suiteId);
    if (ids.length === 0) return;
    if (isQuickSelected(suiteId)) {
      onChange(selectedIds.filter(id => !ids.includes(id)));
    } else {
      onChange([...new Set([...selectedIds, ...ids])]);
    }
  }

  function handleDropdownChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const suiteId = e.target.value;
    if (!suiteId) return;
    const suite = suites.find(s => s.id === suiteId);
    if (!suite) return;
    // Derive TC IDs from stages (by useCaseTag)
    const stages = parseStages(suite.stages ?? '[]');
    const ucTags = new Set(stages.map(s => s.useCaseTag));
    const ids = testCases.filter(tc => tc.useCaseTag && ucTags.has(tc.useCaseTag)).map(tc => tc.id);
    onChange([...new Set([...selectedIds, ...ids])]);
  }

  const hasQuickSuites = QUICK_SUITES.some(qs => quickSuiteTcs(qs.id).length > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>
        Suite
      </label>

      {/* Saved suites dropdown */}
      {suites.length > 0 && (
        <select
          onChange={handleDropdownChange}
          defaultValue=""
          style={{
            width: '100%', padding: '7px 10px', boxSizing: 'border-box',
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 6, color: 'var(--text)', fontSize: 12, outline: 'none', fontFamily: 'var(--font-ui)',
          }}
        >
          <option value="">Select a saved suite to load its tests…</option>
          {suites.map(s => {
            const count = parseStages(s.stages ?? '[]').length;
            return <option key={s.id} value={s.id}>{s.name} ({count} stage{count !== 1 ? 's' : ''})</option>;
          })}
        </select>
      )}

      {/* Quick-pick chips (tag-based) */}
      {hasQuickSuites && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Quick pick:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {QUICK_SUITES.map(qs => {
              const ids = quickSuiteTcs(qs.id);
              const selected = isQuickSelected(qs.id);
              const partial = isQuickPartial(qs.id);
              const disabled = ids.length === 0;
              return (
                <button
                  key={qs.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleQuickSuite(qs.id)}
                  style={{
                    padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.35 : 1,
                    background: selected ? 'rgba(34,211,238,0.12)' : partial ? 'rgba(34,211,238,0.06)' : 'var(--bg)',
                    border: selected
                      ? '1px solid var(--cyan)'
                      : partial
                        ? '1px dashed rgba(34,211,238,0.5)'
                        : '1px solid var(--border)',
                    color: selected || partial ? 'var(--cyan)' : 'var(--text-mid)',
                    transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  <span>{qs.emoji}</span>
                  <span>{qs.label}</span>
                  {ids.length > 0 && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 100,
                      background: selected ? 'rgba(34,211,238,0.2)' : 'rgba(100,116,139,0.15)',
                      color: selected ? 'var(--cyan)' : 'var(--text-dim)',
                    }}>{ids.length}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {suites.length === 0 && !hasQuickSuites && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
          No suites yet — create one in the Suites panel to quickly load test sets.
        </div>
      )}
    </div>
  );
}

// ── Suite form (create / edit) ─────────────────────────────────────────────

function SuiteForm({ mode, initial, testCases, onSave, onCancel: _onCancel, isSaving }: {
  mode: 'create' | 'edit';
  initial?: { name: string; stages: SuiteStage[] };
  testCases: TestCase[];
  scriptedTcIds: Set<string>;
  onSave: (data: { name: string; stages: SuiteStage[] }) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [stages, setStages] = useState<SuiteStage[]>(initial?.stages ?? []);
  const [expandedStages, setExpandedStages] = useState<Set<number>>(new Set());
  const dragFromRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Derive unique use cases with their TCs
  const useCaseMap = useMemo(() => {
    const map = new Map<string, TestCase[]>();
    for (const tc of testCases) {
      if (tc.useCaseTag) {
        if (!map.has(tc.useCaseTag)) map.set(tc.useCaseTag, []);
        map.get(tc.useCaseTag)!.push(tc);
      }
    }
    return map;
  }, [testCases]);

  const useCaseInfo = useMemo(() =>
    Array.from(useCaseMap.entries()).map(([tag, tcs]) => ({ tag, count: tcs.length, tcs })),
  [useCaseMap]);

  const stageTagSet = useMemo(() => new Set(stages.map(s => s.useCaseTag)), [stages]);

  function addStage(tag: string) {
    if (stageTagSet.has(tag)) return;
    const allIds = (useCaseMap.get(tag) ?? []).map(tc => tc.id);
    setStages(prev => [...prev, { useCaseTag: tag, mode: 'sequential', testCaseIds: allIds }]);
  }

  function toggleTcInStage(stageIdx: number, tcId: string) {
    setStages(prev => prev.map((s, i) => {
      if (i !== stageIdx) return s;
      const current = s.testCaseIds ?? (useCaseMap.get(s.useCaseTag) ?? []).map(tc => tc.id);
      const next = current.includes(tcId) ? current.filter(id => id !== tcId) : [...current, tcId];
      return { ...s, testCaseIds: next };
    }));
  }

  function toggleAllTcsInStage(stageIdx: number, allTcIds: string[]) {
    setStages(prev => prev.map((s, i) => {
      if (i !== stageIdx) return s;
      const current = s.testCaseIds ?? allTcIds;
      const allSelected = allTcIds.every(id => current.includes(id));
      return { ...s, testCaseIds: allSelected ? [] : [...allTcIds] };
    }));
  }

  function removeStage(idx: number) {
    setStages(prev => prev.filter((_, i) => i !== idx));
  }

  function toggleMode(idx: number) {
    setStages(prev => prev.map((s, i) =>
      i === idx ? { ...s, mode: s.mode === 'sequential' ? 'parallel' : 'sequential' } : s,
    ));
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    setStages(prev => {
      const n = [...prev];
      [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]];
      return n;
    });
  }

  function moveDown(idx: number) {
    if (idx === stages.length - 1) return;
    setStages(prev => {
      const n = [...prev];
      [n[idx], n[idx + 1]] = [n[idx + 1], n[idx]];
      return n;
    });
  }

  function handleDragStart(idx: number) { dragFromRef.current = idx; }
  function handleDragOver(e: React.DragEvent, idx: number) { e.preventDefault(); setDragOverIdx(idx); }
  function handleDrop(toIdx: number) {
    const fromIdx = dragFromRef.current;
    setDragOverIdx(null);
    dragFromRef.current = null;
    if (fromIdx === null || fromIdx === toIdx) return;
    setStages(prev => {
      const n = [...prev];
      const [moved] = n.splice(fromIdx, 1);
      n.splice(toIdx, 0, moved);
      return n;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error('Suite name is required'); return; }
    if (stages.length === 0) { toast.error('Add at least one use case to the suite'); return; }
    onSave({ name: name.trim(), stages });
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', boxSizing: 'border-box',
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text)', fontSize: 12, outline: 'none', fontFamily: 'var(--font-ui)',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
    color: 'var(--text-dim)', marginBottom: 5, display: 'block',
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={labelStyle}>Suite Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Smoke Suite" style={inputStyle} />
      </div>

      {/* Available use cases */}
      <div>
        <label style={labelStyle}>Available Use Cases</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {useCaseInfo.length === 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>No use cases found.</span>
          )}
          {useCaseInfo.map(({ tag, count }) => {
            const added = stageTagSet.has(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => !added && addStage(tag)}
                style={{
                  padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  cursor: added ? 'default' : 'pointer',
                  background: added ? 'rgba(42,157,143,0.15)' : 'var(--surface3)',
                  border: `1px solid ${added ? 'rgba(42,157,143,0.4)' : 'var(--border)'}`,
                  color: added ? 'var(--pass)' : 'var(--text-dim)',
                  opacity: added ? 0.7 : 1,
                }}
              >
                {added ? '✓ ' : '+ '}{tag}
                <span style={{ marginLeft: 5, opacity: 0.6, fontSize: 10 }}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Stage builder */}
      <div>
        <label style={labelStyle}>
          Execution Stages
          <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--text-dim)', textTransform: 'none', letterSpacing: 0, fontSize: 10 }}>
            — drag to reorder · stages run in sequence, TCs within a stage run seq or parallel
          </span>
        </label>
        {stages.length === 0 ? (
          <div style={{
            border: '2px dashed var(--border)', borderRadius: 8, padding: '20px',
            textAlign: 'center', color: 'var(--text-dim)', fontSize: 12,
          }}>
            Click a use case above to add it as a stage
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {stages.map((stage, idx) => {
              const ucTcs = useCaseMap.get(stage.useCaseTag) ?? [];
              const allUcIds = ucTcs.map(tc => tc.id);
              const selectedIds = stage.testCaseIds ?? allUcIds;
              const selectedCount = selectedIds.length;
              const isExpanded = expandedStages.has(idx);
              const allChecked = allUcIds.every(id => selectedIds.includes(id));
              return (
                <div
                  key={stage.useCaseTag}
                  style={{
                    background: 'var(--surface3)', borderRadius: 7,
                    border: `1px solid ${dragOverIdx === idx ? 'var(--cyan)' : 'var(--border)'}`,
                    borderLeft: `3px solid ${stage.mode === 'parallel' ? 'var(--violet)' : 'var(--emerald)'}`,
                    overflow: 'hidden',
                  }}
                >
                  {/* Stage header row */}
                  <div
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDrop={() => handleDrop(idx)}
                    onDragEnd={() => { setDragOverIdx(null); dragFromRef.current = null; }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px' }}
                  >
                    <span style={{ color: 'var(--text-dim)', opacity: 0.5, cursor: 'grab', fontSize: 14, userSelect: 'none' }}>⠿</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)', minWidth: 18, flexShrink: 0 }}>{idx + 1}.</span>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {stage.useCaseTag}
                    </span>
                    {/* TC count / selection */}
                    <button
                      type="button"
                      onClick={() => setExpandedStages(prev => {
                        const n = new Set(prev);
                        if (n.has(idx)) n.delete(idx); else n.add(idx);
                        return n;
                      })}
                      style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                        background: selectedCount < allUcIds.length ? 'rgba(245,158,11,0.1)' : 'transparent',
                        border: `1px solid ${selectedCount < allUcIds.length ? 'rgba(245,158,11,0.3)' : 'var(--border)'}`,
                        color: selectedCount < allUcIds.length ? 'var(--amber)' : 'var(--text-dim)',
                        flexShrink: 0, whiteSpace: 'nowrap',
                      }}
                    >
                      {selectedCount}/{allUcIds.length} TCs {isExpanded ? '▲' : '▼'}
                    </button>
                    <button type="button" onClick={() => toggleMode(idx)} style={{
                      padding: '3px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                      background: stage.mode === 'parallel' ? 'rgba(139,92,246,0.12)' : 'rgba(42,157,143,0.1)',
                      border: `1px solid ${stage.mode === 'parallel' ? 'rgba(139,92,246,0.3)' : 'rgba(42,157,143,0.25)'}`,
                      color: stage.mode === 'parallel' ? 'var(--violet)' : 'var(--pass)',
                      flexShrink: 0, whiteSpace: 'nowrap',
                    }}>
                      {stage.mode === 'parallel' ? '⚡ Parallel' : '→ Sequential'}
                    </button>
                    <button type="button" onClick={() => moveUp(idx)} disabled={idx === 0}
                      style={{ background: 'none', border: 'none', color: idx === 0 ? 'var(--border)' : 'var(--text-dim)', cursor: idx === 0 ? 'default' : 'pointer', padding: '2px 4px', fontSize: 12 }}>▲</button>
                    <button type="button" onClick={() => moveDown(idx)} disabled={idx === stages.length - 1}
                      style={{ background: 'none', border: 'none', color: idx === stages.length - 1 ? 'var(--border)' : 'var(--text-dim)', cursor: idx === stages.length - 1 ? 'default' : 'pointer', padding: '2px 4px', fontSize: 12 }}>▼</button>
                    <button type="button" onClick={() => removeStage(idx)}
                      style={{ background: 'none', border: 'none', color: 'var(--fail)', cursor: 'pointer', padding: '2px 4px', fontSize: 13, opacity: 0.7 }}>✕</button>
                  </div>

                  {/* Expanded TC list */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '6px 10px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {/* Select all / none */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <input
                          type="checkbox"
                          checked={allChecked}
                          onChange={() => toggleAllTcsInStage(idx, allUcIds)}
                          style={{ cursor: 'pointer', accentColor: 'var(--cyan)' }}
                        />
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {allChecked ? 'Deselect all' : 'Select all'}
                        </span>
                      </div>
                      {ucTcs.map(tc => {
                        const checked = selectedIds.includes(tc.id);
                        return (
                          <label key={tc.id} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', padding: '3px 4px', borderRadius: 4, background: checked ? 'rgba(37,99,171,0.06)' : 'transparent' }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleTcInStage(idx, tc.id)}
                              style={{ cursor: 'pointer', accentColor: 'var(--cyan)', flexShrink: 0 }}
                            />
                            <span style={{ fontSize: 11, color: checked ? 'var(--text)' : 'var(--text-dim)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {tc.title}
                            </span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', flexShrink: 0 }}>{tc.tcId}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <button type="submit" disabled={isSaving} style={{
        width: '100%', padding: '8px 0', borderRadius: 7,
        background: 'linear-gradient(90deg,#2A9D8F,#1d7a6c)', border: 'none',
        color: '#fff', cursor: isSaving ? 'not-allowed' : 'pointer',
        fontSize: 13, fontWeight: 700, opacity: isSaving ? 0.7 : 1,
      }}>
        {isSaving ? 'Saving…' : mode === 'create' ? '💾 Save Suite' : '💾 Update Suite'}
      </button>
    </form>
  );
}

// ── Suite card (left column) ───────────────────────────────────────────────

function SuiteCard({ suite, isSelected, onEdit, onDelete, onRunNow, runNowPending, canWrite = true }: {
  suite: Suite;
  isSelected: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRunNow: () => void;
  runNowPending: boolean;
  canWrite?: boolean;
  existingTcIds?: Set<string>;
}) {
  const stages = useMemo(() => parseStages(suite.stages ?? '[]'), [suite.stages]);
  const stageCount = stages.length;

  return (
    <div onClick={canWrite ? onEdit : undefined} style={{
      background: 'var(--surface)',
      border: `1px solid ${isSelected ? 'var(--cyan)' : 'var(--border)'}`,
      borderRadius: 8, padding: '0 12px', height: 44,
      display: 'flex', alignItems: 'center', gap: 10,
      cursor: canWrite ? 'pointer' : 'default',
      boxShadow: isSelected ? '0 0 0 2px rgba(34,211,238,0.1)' : 'var(--shadow-card)',
      borderLeft: `3px solid ${isSelected ? 'var(--cyan)' : '#2A9D8F'}`,
      transition: 'border-color 0.15s',
    }}>
      <span style={{ fontSize: 13, lineHeight: 1, flexShrink: 0 }}>📦</span>
      <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{suite.name}</span>
      </div>
      <span style={{ fontSize: 10, color: 'var(--text-dim)', flexShrink: 0, whiteSpace: 'nowrap' }}>{stageCount} stage{stageCount !== 1 ? 's' : ''}</span>
      {canWrite && (
        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <button disabled={runNowPending} onClick={onRunNow} style={{
            padding: '4px 10px', borderRadius: 5,
            background: 'rgba(42,157,143,0.1)', border: '1px solid rgba(42,157,143,0.25)',
            color: 'var(--pass)', cursor: runNowPending ? 'not-allowed' : 'pointer',
            fontSize: 10, fontWeight: 700, opacity: runNowPending ? 0.6 : 1, whiteSpace: 'nowrap',
          }}>{runNowPending ? '⏳…' : '▶ Run'}</button>
          <button onClick={onEdit} style={{ padding: '4px 10px', borderRadius: 5, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>Edit</button>
          <button onClick={onDelete} style={{ padding: '4px 10px', borderRadius: 5, background: 'transparent', border: '1px solid rgba(220,38,38,0.2)', color: 'var(--fail)', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>Delete</button>
        </div>
      )}
    </div>
  );
}

// ── Quick Run Now panel ────────────────────────────────────────────────────

function RunNowPanel({ suites, testCases, scriptedTcIds, envConfigs, projectId, onClose }: {
  suites: Suite[];
  testCases: TestCase[];
  scriptedTcIds: Set<string>;
  envConfigs: EnvConfig[];
  projectId: string;
  onClose: () => void;
}) {
  const defaultEnv = envConfigs.find(e => e.isDefault)?.name ?? envConfigs[0]?.name ?? 'Dev';
  const [selectedTcIds, setSelectedTcIds] = useState<string[]>([]);
  const [environment, setEnvironment] = useState(defaultEnv);
  const { mutateAsync: createRun, isPending } = useCreateRun(projectId);

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', boxSizing: 'border-box',
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text)', fontSize: 12, outline: 'none',
  };

  async function handleRun() {
    if (selectedTcIds.length === 0) { toast.error('Select at least one test case'); return; }
    try {
      await createRun({ testCaseIds: selectedTcIds, environment, name: `Quick Run — ${environment}` });
      toast.success('Run queued! Check the Execution screen for live logs.');
      onClose();
    } catch (e) {
      toast.error((e as Error).message ?? 'Failed to start run');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', display: 'block', marginBottom: 5 }}>
          Environment
        </label>
        {envConfigs.length > 0 ? (
          <select value={environment} onChange={e => setEnvironment(e.target.value)} style={inputStyle}>
            {envConfigs.map(env => <option key={env.id} value={env.name}>{env.name}</option>)}
          </select>
        ) : (
          <input value={environment} onChange={e => setEnvironment(e.target.value)} placeholder="Dev / QA / Staging / Prod" style={inputStyle} />
        )}
      </div>

      <SuiteSelector suites={suites} testCases={testCases} selectedIds={selectedTcIds} onChange={setSelectedTcIds} />

      <TcLibrarySelector testCases={testCases} selected={selectedTcIds} onChange={setSelectedTcIds} scriptedTcIds={scriptedTcIds} />

      <button
        disabled={isPending || selectedTcIds.length === 0}
        onClick={handleRun}
        style={{
          width: '100%', padding: '9px 0', borderRadius: 7,
          background: selectedTcIds.length === 0 ? 'var(--border)' : 'linear-gradient(90deg,#2A9D8F,#1d7a6c)',
          border: 'none', color: selectedTcIds.length === 0 ? 'var(--text-dim)' : '#fff',
          cursor: isPending || selectedTcIds.length === 0 ? 'not-allowed' : 'pointer',
          fontSize: 13, fontWeight: 700, opacity: isPending ? 0.7 : 1,
        }}>
        {isPending ? '⏳ Queuing…' : `▶ Run ${selectedTcIds.length > 0 ? selectedTcIds.length + ' ' : ''}Test${selectedTcIds.length !== 1 ? 's' : ''} Now`}
      </button>
    </div>
  );
}

// ── Schedule card ──────────────────────────────────────────────────────────

function ScheduleCard({ schedule, isSelected, onEdit, onRunNow, onDelete, onToggle, runNowPending, canWrite = true }: {
  schedule: Schedule; isSelected: boolean;
  onEdit: () => void; onRunNow: () => void; onDelete: () => void; onToggle: () => void;
  runNowPending: boolean; canWrite?: boolean;
}) {
  const tcIds = useMemo(() => parseTcIds(schedule.testCaseIds), [schedule.testCaseIds]);
  const emails = useMemo(() => { try { return JSON.parse(schedule.emailRecipients) as string[]; } catch { return []; } }, [schedule.emailRecipients]);
  const freq = useMemo(() => parseCronToFreq(schedule.cronExpression), [schedule.cronExpression]);

  return (
    <div onClick={canWrite ? onEdit : undefined} style={{
      background: 'var(--surface)',
      border: `1px solid ${isSelected ? 'var(--cyan)' : 'var(--border)'}`,
      borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
      cursor: canWrite ? 'pointer' : 'default',
      boxShadow: isSelected ? '0 0 0 2px rgba(34,211,238,0.1)' : 'var(--shadow-card)',
      position: 'relative', overflow: 'hidden', transition: 'border-color 0.15s',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '10px 10px 0 0', background: schedule.isActive ? 'linear-gradient(90deg,#2563AB,#0A2A57)' : 'var(--border)' }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{schedule.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>⏰</span><span>{freqToHuman(freq)}</span>
          </div>
        </div>
        {/* Active/Pause toggle — Viewers see read-only state indicator */}
        {canWrite ? (
          <button onClick={e => { e.stopPropagation(); onToggle(); }} title={schedule.isActive ? 'Pause' : 'Activate'}
            style={{ width: 38, height: 21, borderRadius: 100, border: 'none', cursor: 'pointer', background: schedule.isActive ? 'var(--cyan)' : 'var(--border)', position: 'relative', flexShrink: 0, transition: 'background 0.2s' }}>
            <div style={{ position: 'absolute', top: 2.5, left: schedule.isActive ? 19 : 2.5, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
          </button>
        ) : (
          <div style={{ width: 38, height: 21, borderRadius: 100, background: schedule.isActive ? 'var(--cyan)' : 'var(--border)', position: 'relative', flexShrink: 0, opacity: 0.6 }}>
            <div style={{ position: 'absolute', top: 2.5, left: schedule.isActive ? 19 : 2.5, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 100, background: 'rgba(37,99,171,0.12)', color: 'var(--cyan)' }}>{schedule.environment}</span>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 100, background: 'rgba(244,123,32,0.1)', color: 'var(--skip)' }}>{tcIds.length} test{tcIds.length !== 1 ? 's' : ''}</span>
        {emails.length > 0 && <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 100, background: 'rgba(42,157,143,0.1)', color: 'var(--pass)' }}>📧 {emails.length}</span>}
        {!schedule.isActive && <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 100, background: 'rgba(100,116,139,0.12)', color: 'var(--text-dim)' }}>PAUSED</span>}
      </div>

      {canWrite && (
        <div style={{ display: 'flex', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10 }} onClick={e => e.stopPropagation()}>
          <button disabled={runNowPending} onClick={onRunNow} style={{
            flex: 1, padding: '5px 0', borderRadius: 6,
            background: 'rgba(42,157,143,0.1)', border: '1px solid rgba(42,157,143,0.25)',
            color: 'var(--pass)', cursor: runNowPending ? 'not-allowed' : 'pointer',
            fontSize: 11, fontWeight: 700, opacity: runNowPending ? 0.6 : 1,
          }}>{runNowPending ? '⏳ Queuing…' : '▶ Run Now'}</button>
          <button onClick={onEdit} style={{ padding: '5px 12px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Edit</button>
          <button onClick={onDelete} style={{ padding: '5px 12px', borderRadius: 6, background: 'transparent', border: '1px solid rgba(220,38,38,0.2)', color: 'var(--fail)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Delete</button>
        </div>
      )}
    </div>
  );
}

// ── Schedule form ──────────────────────────────────────────────────────────

interface ScheduleFormState {
  name: string;
  freq: FreqConfig;
  environment: string;
  selectedTcIds: string[];
  emailRecipients: string;
  isActive: boolean;
  record: boolean;
}

function ScheduleForm({ mode, initial, envConfigs, testCases, suites, scriptedTcIds, onSave, onCancel: _onCancel, isSaving }: {
  mode: 'create' | 'edit';
  initial?: Partial<ScheduleFormState>;
  envConfigs: EnvConfig[];
  testCases: TestCase[];
  suites: Suite[];
  scriptedTcIds: Set<string>;
  onSave: (d: ScheduleFormState) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const defaultEnv = envConfigs.find(e => e.isDefault)?.name ?? envConfigs[0]?.name ?? 'Dev';
  const [form, setForm] = useState<ScheduleFormState>({
    name: initial?.name ?? '',
    freq: initial?.freq ?? DEFAULT_FREQ,
    environment: initial?.environment ?? defaultEnv,
    selectedTcIds: initial?.selectedTcIds ?? [],
    emailRecipients: initial?.emailRecipients ?? '',
    isActive: initial?.isActive ?? true,
    record: initial?.record ?? true,
  });

  const set = (p: Partial<ScheduleFormState>) => setForm(f => ({ ...f, ...p }));
  const inputStyle: React.CSSProperties = { width: '100%', padding: '7px 10px', boxSizing: 'border-box', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12, outline: 'none', fontFamily: 'var(--font-ui)' };
  const labelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 5, display: 'block' };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Schedule name is required'); return; }
    if (form.selectedTcIds.length === 0) { toast.error('Select at least one test case'); return; }
    if (!form.environment.trim()) { toast.error('Select an environment'); return; }
    onSave(form);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={labelStyle}>Name</label>
        <input value={form.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Nightly Regression" style={inputStyle} />
      </div>

      <div>
        <label style={labelStyle}>Schedule Frequency</label>
        <FrequencyPicker value={form.freq} onChange={freq => set({ freq })} />
      </div>

      <div>
        <label style={labelStyle}>Environment</label>
        {envConfigs.length > 0 ? (
          <select value={form.environment} onChange={e => set({ environment: e.target.value })} style={inputStyle}>
            {envConfigs.map(env => <option key={env.id} value={env.name}>{env.name}</option>)}
          </select>
        ) : (
          <input value={form.environment} onChange={e => set({ environment: e.target.value })} placeholder="Dev / QA / Staging / Prod" style={inputStyle} />
        )}
      </div>

      <SuiteSelector
        suites={suites}
        testCases={testCases}
        selectedIds={form.selectedTcIds}
        onChange={ids => set({ selectedTcIds: ids })}
      />

      <TcLibrarySelector
        testCases={testCases}
        selected={form.selectedTcIds}
        onChange={ids => set({ selectedTcIds: ids })}
        scriptedTcIds={scriptedTcIds}
      />

      <div>
        <label style={labelStyle}>Email Recipients</label>
        <input value={form.emailRecipients} onChange={e => set({ emailRecipients: e.target.value })} placeholder="user@example.com, team@example.com" style={inputStyle} />
        <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-dim)' }}>Comma-separated. Leave empty to skip.</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Active</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Schedule will {form.isActive ? '' : 'not '}fire automatically</div>
        </div>
        <button type="button" onClick={() => set({ isActive: !form.isActive })} style={{ width: 44, height: 24, borderRadius: 100, border: 'none', cursor: 'pointer', background: form.isActive ? 'var(--cyan)' : 'var(--border)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 3, left: form.isActive ? 22 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Video Recording</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{form.record ? 'Recording enabled for this schedule' : 'Recording disabled — runs will skip video'}</div>
        </div>
        <button type="button" onClick={() => set({ record: !form.record })} style={{ width: 44, height: 24, borderRadius: 100, border: 'none', cursor: 'pointer', background: form.record ? 'var(--cyan)' : 'var(--border)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 3, left: form.record ? 22 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
        </button>
      </div>

      <button type="submit" disabled={isSaving} style={{ width: '100%', padding: '8px 0', borderRadius: 7, background: 'linear-gradient(90deg,#2A9D8F,#1d7a6c)', border: 'none', color: '#fff', cursor: isSaving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, opacity: isSaving ? 0.7 : 1 }}>
        {isSaving ? 'Saving…' : mode === 'create' ? 'Create Schedule' : 'Save Changes'}
      </button>
    </form>
  );
}

// ── Recent runs table ──────────────────────────────────────────────────────

const STATUS_CLR: Record<string, string> = {
  PASSED: 'var(--pass)', FAILED: 'var(--fail)', RUNNING: 'var(--cyan)',
  PENDING: 'var(--skip)', CANCELLED: 'var(--text-dim)', SKIPPED: 'var(--amber)',
};

function RecentRunsTable({ runs, loading }: { runs: RunListItem[]; loading: boolean }) {
  if (loading) return <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>Loading…</div>;
  if (runs.length === 0) return (
    <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.7 }}>
      No scheduled runs yet.<br /><span style={{ color: 'var(--text-mid)' }}>Use ▶ Run Now on a schedule or the Quick Run button.</span>
    </div>
  );
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>{['Run', 'Env', 'Status', '✓', '✗', 'Started'].map(h => (
            <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {runs.map(run => {
            const passed = run.results.filter(r => r.status === 'PASSED').length;
            const failed = run.results.filter(r => r.status === 'FAILED').length;
            return (
              <tr key={run.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 10px', color: 'var(--text)', fontWeight: 500, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.name}</td>
                <td style={{ padding: '7px 10px' }}><span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', padding: '2px 7px', borderRadius: 100, background: 'rgba(37,99,171,0.12)', color: 'var(--cyan)' }}>{run.environment}</span></td>
                <td style={{ padding: '7px 10px' }}><span style={{ fontSize: 10, fontWeight: 700, color: STATUS_CLR[run.status] ?? 'var(--text-dim)' }}>{run.status}</span></td>
                <td style={{ padding: '7px 10px', color: 'var(--pass)', fontWeight: 700 }}>{passed > 0 ? passed : '—'}</td>
                <td style={{ padding: '7px 10px', color: 'var(--fail)', fontWeight: 700 }}>{failed > 0 ? failed : '—'}</td>
                <td style={{ padding: '7px 10px', color: 'var(--text-dim)', fontSize: 10, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                  {run.startedAt ? new Date(run.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : <span style={{ color: 'var(--skip)' }}>Pending</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

type PageMode = 'idle' | 'create' | 'edit' | 'run-now' | 'suite-create' | 'suite-edit';

export default function Scheduler() {
  const { slug } = useParams<{ slug: string }>();
  const projectId = slug!;
  const { canWrite } = useRBAC();
  const qc = useQueryClient();

  const [mode, setMode] = useState<PageMode>('idle');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSuiteId, setEditingSuiteId] = useState<string | null>(null);
  const [runNowId, setRunNowId] = useState<string | null>(null);
  const [suiteRunNowId, setSuiteRunNowId] = useState<string | null>(null);
  const [suiteDropdownOpen, setSuiteDropdownOpen] = useState(false);
  const [suiteWorkers, setSuiteWorkers] = useState<number>(() =>
    parseInt(localStorage.getItem('qa:parallelWorkers') ?? '2', 10)
  );
  const [suiteRecord, setSuiteRecord] = useState<boolean>(() =>
    localStorage.getItem('qa:suiteRecord') !== 'false'
  );
  function updateSuiteWorkers(n: number) {
    setSuiteWorkers(n);
    localStorage.setItem('qa:parallelWorkers', String(n));
  }
  function toggleSuiteRecord() {
    setSuiteRecord(v => {
      localStorage.setItem('qa:suiteRecord', String(!v));
      return !v;
    });
  }
  const suiteDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!suiteDropdownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (suiteDropdownRef.current && !suiteDropdownRef.current.contains(e.target as Node)) {
        setSuiteDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [suiteDropdownOpen]);

  const { data: schedules = [], isLoading: schedulesLoading } = useSchedules(projectId);
  const { data: suites = [], isLoading: suitesLoading } = useSuites(projectId);
  const { data: runsData, isLoading: runsLoading } = useRuns(projectId);
  const allRuns: RunListItem[] = runsData?.runs ?? [];
  const scheduledRuns = allRuns.filter(r => r.triggerType === 'SCHEDULED');
  const activeRuns = allRuns.filter(r => r.status === 'PENDING' || r.status === 'RUNNING');

  const { activeProject } = useProjectStore();
  const envConfigs: EnvConfig[] = activeProject?.envConfigs ?? [];
  const defaultEnv = envConfigs.find(e => e.isDefault)?.name ?? envConfigs[0]?.name ?? 'Dev';

  const { data: testCases = [] } = useQuery<TestCase[]>({
    queryKey: ['test-cases', projectId, 'scheduler-all'],
    queryFn: async () => {
      const res = await api.get<{ testCases: TestCase[] }>(`/projects/${projectId}/test-cases?limit=500`);
      return (res.data.testCases ?? []).filter(tc => tc.status !== 'DEPRECATED');
    },
    enabled: !!projectId,
  });

  const { data: scripts = [] } = useScripts(projectId);
  const scriptedTcIds = useMemo(() => new Set(scripts.filter(s => s.testCaseId).map(s => s.testCaseId!)), [scripts]);
  const existingTcIdSet = useMemo(() => new Set(testCases.map(tc => tc.id)), [testCases]);

  const { mutateAsync: createSchedule, isPending: creating } = useCreateSchedule(projectId);
  const { mutateAsync: updateSchedule, isPending: updating } = useUpdateSchedule(projectId);
  const { mutateAsync: deleteSchedule } = useDeleteSchedule(projectId);
  const { mutateAsync: runNow, isPending: runNowPending } = useRunNow(projectId);
  const { mutateAsync: createSuite, isPending: creatingSuite } = useCreateSuite(projectId);
  const { mutateAsync: updateSuite, isPending: updatingSuite } = useUpdateSuite(projectId);
  const { mutateAsync: deleteSuite } = useDeleteSuite(projectId);
  const { mutateAsync: runSuite } = useRunSuite(projectId);

  const activeCount = schedules.filter(s => s.isActive).length;
  const runs7d = scheduledRuns.filter(r => {
    const d = new Date(r.startedAt ?? '');
    return !isNaN(d.getTime()) && Date.now() - d.getTime() < 7 * 24 * 3600 * 1000;
  }).length;

  const editingSchedule = useMemo(() => schedules.find(s => s.id === editingId), [schedules, editingId]);
  const editingSuite = useMemo(() => suites.find(s => s.id === editingSuiteId), [suites, editingSuiteId]);

  const editInitial: Partial<ScheduleFormState> | undefined = useMemo(() => {
    if (!editingSchedule) return undefined;
    let tcIds: string[] = [];
    let emails = '';
    try { tcIds = JSON.parse(editingSchedule.testCaseIds); } catch { /* noop */ }
    try { emails = (JSON.parse(editingSchedule.emailRecipients) as string[]).join(', '); } catch { /* noop */ }
    return { name: editingSchedule.name, freq: parseCronToFreq(editingSchedule.cronExpression), environment: editingSchedule.environment, selectedTcIds: tcIds, emailRecipients: emails, isActive: editingSchedule.isActive, record: editingSchedule.record ?? true };
  }, [editingSchedule]);

  const editSuiteInitial = useMemo(() => {
    if (!editingSuite) return undefined;
    return { name: editingSuite.name, stages: parseStages(editingSuite.stages ?? '[]') };
  }, [editingSuite]);

  function closeForm() { setMode('idle'); setEditingId(null); setEditingSuiteId(null); }

  async function handleSaveSchedule(formData: ScheduleFormState) {
    const cronExpression = buildCron(formData.freq);
    const emailRecipients = formData.emailRecipients.split(',').map(e => e.trim()).filter(Boolean);
    try {
      if (mode === 'create') {
        await createSchedule({ name: formData.name, cronExpression, testCaseIds: formData.selectedTcIds, environment: formData.environment, isActive: formData.isActive, record: formData.record, emailRecipients });
        toast.success('Schedule created');
      } else if (editingId) {
        await updateSchedule({ id: editingId, name: formData.name, cronExpression, testCaseIds: formData.selectedTcIds, environment: formData.environment, isActive: formData.isActive, record: formData.record, emailRecipients });
        toast.success('Schedule updated');
      }
      closeForm();
    } catch (e) { toast.error((e as Error).message ?? 'Failed to save'); }
  }

  async function handleSaveSuite(data: { name: string; stages: SuiteStage[] }) {
    try {
      if (mode === 'suite-create') {
        await createSuite(data);
        toast.success('Suite created');
      } else if (editingSuiteId) {
        await updateSuite({ id: editingSuiteId, ...data });
        toast.success('Suite updated');
      }
      closeForm();
    } catch (e) { toast.error((e as Error).message ?? 'Failed to save suite'); }
  }

  async function handleRunNow(scheduleId: string) {
    setRunNowId(scheduleId);
    try {
      await runNow(scheduleId);
      toast.success('Run queued — check Execution for live logs');
    } catch (e) { toast.error((e as Error).message ?? 'Failed to trigger'); }
    finally { setRunNowId(null); }
  }

  async function handleSuiteRunNow(suite: Suite) {
    const stages = parseStages(suite.stages ?? '[]');
    if (stages.length === 0) { toast.error('This suite has no stages — add use cases to it first'); return; }
    setSuiteRunNowId(suite.id);
    try {
      await runSuite({ suiteId: suite.id, environment: defaultEnv, name: `${suite.name} — Quick Run`, parallelWorkers: suiteWorkers, record: suiteRecord });
      void qc.invalidateQueries({ queryKey: ['runs', projectId] });
      toast.success('Suite run queued — check Execution for live logs');
    } catch (e) { toast.error((e as Error).message ?? 'Failed to trigger'); }
    finally { setSuiteRunNowId(null); }
  }

  async function handleToggle(schedule: Schedule) {
    try {
      await updateSchedule({ id: schedule.id, isActive: !schedule.isActive });
      toast.success(schedule.isActive ? 'Schedule paused' : 'Schedule activated');
    } catch (e) { toast.error((e as Error).message ?? 'Failed'); }
  }

  async function handleDeleteSchedule(scheduleId: string) {
    if (!window.confirm('Delete this schedule?')) return;
    try {
      await deleteSchedule(scheduleId);
      if (editingId === scheduleId) closeForm();
      toast.success('Deleted');
    } catch (e) { toast.error((e as Error).message ?? 'Failed'); }
  }

  async function handleDeleteSuite(suiteId: string) {
    if (!window.confirm('Delete this suite?')) return;
    try {
      await deleteSuite(suiteId);
      if (editingSuiteId === suiteId) closeForm();
      toast.success('Suite deleted');
    } catch (e) { toast.error((e as Error).message ?? 'Failed'); }
  }

  const showForm = mode === 'create' || mode === 'edit' || mode === 'run-now' || mode === 'suite-create' || mode === 'suite-edit';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: activeProject?.name ?? 'Project' },
          { label: '⏰ Scheduler' },
        ]}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            {canWrite && (
              <>
                <TbBtn
                  variant="ghost"
                  onClick={() => setMode(mode === 'run-now' ? 'idle' : 'run-now')}
                  style={{ background: mode === 'run-now' ? 'rgba(42,157,143,0.18)' : 'rgba(42,157,143,0.1)', color: 'var(--pass)', border: '1px solid rgba(42,157,143,0.25)' }}
                >
                  ▶ Quick Run
                </TbBtn>
                <TbBtn
                  variant="ghost"
                  onClick={() => { setMode('suite-create'); setEditingSuiteId(null); }}
                  style={{ background: 'rgba(42,157,143,0.08)', color: 'var(--emerald)', border: '1px solid rgba(42,157,143,0.2)' }}
                >
                  📦 New Suite
                </TbBtn>
                <TbBtn
                  variant="primary"
                  onClick={() => { setMode('create'); setEditingId(null); setEditingSuiteId(null); }}
                  style={{ background: 'linear-gradient(90deg,#2563AB,#0A2A57)', color: '#fff', border: 'none' }}
                >
                  + New Schedule
                </TbBtn>
              </>
            )}
          </div>
        }
      />

      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Stat tiles */}
        <div style={{ display: 'flex', gap: 12 }}>
          <StatTile label="Total Schedules" value={schedules.length} color="var(--cyan)" accent="linear-gradient(90deg,#2563AB,#0A2A57)" />
          <StatTile label="Active Schedules" value={activeCount} color="var(--pass)" accent="linear-gradient(90deg,#2A9D8F,#1a7a6e)" />
          <StatTile label="Saved Suites" value={suites.length} color="var(--emerald)" accent="linear-gradient(90deg,#2A9D8F,#1d7a6c)" />
          <StatTile label="Runs (7d)" value={runs7d} color="#F47B20" accent="linear-gradient(90deg,#FFB347,#F47B20)" />
        </div>

        {/* 2-col layout */}
        <div style={{ display: 'grid', gridTemplateColumns: showForm ? '1fr 480px' : '1fr 1fr', gap: 20, alignItems: 'start' }}>

          {/* LEFT: schedules + suites */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Schedules section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                ⏰ Schedules
                {schedules.length > 0 && <span style={{ fontSize: 10, background: 'rgba(37,99,171,0.12)', color: 'var(--cyan)', padding: '1px 7px', borderRadius: 100, fontWeight: 700 }}>{schedules.length}</span>}
              </h2>

              {schedulesLoading ? (
                <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', padding: '40px 0' }}>Loading schedules…</div>
              ) : schedules.length === 0 ? (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '32px 24px', textAlign: 'center' }}>
                  <div style={{ fontSize: 28, marginBottom: 10 }}>⏰</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 5 }}>No schedules yet</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.65 }}>Create recurring test runs on a daily,<br />weekly, or custom schedule.</div>
                  {canWrite && (
                    <button onClick={() => setMode('create')} style={{ padding: '7px 18px', borderRadius: 7, background: 'linear-gradient(90deg,#2563AB,#0A2A57)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>+ Create First Schedule</button>
                  )}
                </div>
              ) : (
                schedules.map(schedule => (
                  <ScheduleCard
                    key={schedule.id}
                    schedule={schedule}
                    isSelected={editingId === schedule.id && mode === 'edit'}
                    onEdit={() => { setEditingId(schedule.id); setEditingSuiteId(null); setMode('edit'); }}
                    onRunNow={() => handleRunNow(schedule.id)}
                    onDelete={() => handleDeleteSchedule(schedule.id)}
                    onToggle={() => handleToggle(schedule)}
                    runNowPending={runNowId === schedule.id && runNowPending}
                    canWrite={canWrite}
                  />
                ))
              )}
            </div>

            {/* Suites section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  📦 Suites
                  {suites.length > 0 && <span style={{ fontSize: 10, background: 'rgba(42,157,143,0.12)', color: 'var(--pass)', padding: '1px 7px', borderRadius: 100, fontWeight: 700 }}>{suites.length}</span>}
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* Worker threads stepper — shared with Execution window via localStorage */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)' }}>Threads</span>
                    <Stepper value={suiteWorkers} onChange={updateSuiteWorkers} min={1} max={16} />
                  </div>
                  {/* Video toggle */}
                  <button
                    title={suiteRecord ? 'Video on — click to disable' : 'Video off — click to enable'}
                    onClick={toggleSuiteRecord}
                    style={{
                      padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      background: suiteRecord ? 'rgba(34,211,238,0.1)' : 'rgba(100,116,139,0.1)',
                      border: suiteRecord ? '1px solid rgba(34,211,238,0.3)' : '1px solid var(--border)',
                      color: suiteRecord ? 'var(--cyan)' : 'var(--text-dim)',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    {suiteRecord ? '🎬' : '🚫'} <span>Video</span>
                  </button>
                  {canWrite && (
                    <button
                      onClick={() => { setMode('suite-create'); setEditingSuiteId(null); setEditingId(null); }}
                      style={{ padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(42,157,143,0.08)', border: '1px solid rgba(42,157,143,0.2)', color: 'var(--pass)' }}
                    >
                      + New Suite
                    </button>
                  )}
                </div>
              </div>

              {suitesLoading ? (
                <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>Loading suites…</div>
              ) : suites.length === 0 ? (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '24px', textAlign: 'center' }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>📦</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>No suites yet</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.6 }}>
                    Group test cases into named suites — then load them instantly when configuring a run or schedule.
                  </div>
                  {canWrite && (
                    <button onClick={() => { setMode('suite-create'); setEditingSuiteId(null); }} style={{ padding: '6px 16px', borderRadius: 7, background: 'linear-gradient(90deg,#2A9D8F,#1d7a6c)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>📦 Create First Suite</button>
                  )}
                </div>
              ) : (() => {
                const SUITE_LIMIT = 5;
                const sorted = [...suites].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
                const visible = sorted.slice(0, SUITE_LIMIT);
                const overflow = sorted.slice(SUITE_LIMIT);
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {visible.map(suite => (
                      <SuiteCard
                        key={suite.id}
                        suite={suite}
                        isSelected={editingSuiteId === suite.id && mode === 'suite-edit'}
                        onEdit={() => { setEditingSuiteId(suite.id); setEditingId(null); setMode('suite-edit'); setSuiteDropdownOpen(false); }}
                        onDelete={() => handleDeleteSuite(suite.id)}
                        onRunNow={() => handleSuiteRunNow(suite)}
                        runNowPending={suiteRunNowId === suite.id}
                        canWrite={canWrite}
                        existingTcIds={existingTcIdSet}
                      />
                    ))}
                    {overflow.length > 0 && (
                      <div ref={suiteDropdownRef} style={{ position: 'relative' }}>
                        <button
                          onClick={() => setSuiteDropdownOpen(v => !v)}
                          style={{
                            width: '100%', padding: '6px 12px', borderRadius: 8,
                            background: 'var(--surface)', border: '1px dashed var(--border)',
                            color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                          }}
                        >
                          <span>{suiteDropdownOpen ? '▲' : '▼'}</span>
                          {suiteDropdownOpen ? 'Hide' : `${overflow.length} more suite${overflow.length !== 1 ? 's' : ''}`}
                        </button>
                        {suiteDropdownOpen && (
                          <div style={{
                            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
                            background: 'var(--surface)', border: '1px solid var(--border)',
                            borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
                            display: 'flex', flexDirection: 'column', gap: 4, padding: 6,
                            maxHeight: 220, overflowY: 'auto',
                          }}>
                            {overflow.map(suite => (
                              <SuiteCard
                                key={suite.id}
                                suite={suite}
                                isSelected={editingSuiteId === suite.id && mode === 'suite-edit'}
                                onEdit={() => { setEditingSuiteId(suite.id); setEditingId(null); setMode('suite-edit'); setSuiteDropdownOpen(false); }}
                                onDelete={() => handleDeleteSuite(suite.id)}
                                onRunNow={() => handleSuiteRunNow(suite)}
                                runNowPending={suiteRunNowId === suite.id}
                                canWrite={canWrite}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* RIGHT: form / run-now / idle panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {showForm ? (
              <>
                {/* Section header — outside the card, same pattern as Schedules / Suites */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div>
                    <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {mode === 'run-now'
                        ? '▶ Quick Run Now'
                        : mode === 'suite-create'
                          ? '📦 New Suite'
                          : mode === 'suite-edit'
                            ? '📦 Edit Suite'
                            : mode === 'create'
                              ? '⏰ New Schedule'
                              : '⏰ Edit Schedule'}
                    </h2>
                    {mode === 'run-now' && (
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>Run tests immediately — no schedule needed.</div>
                    )}
                    {(mode === 'suite-create' || mode === 'suite-edit') && (
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>
                        {mode === 'suite-create' ? 'Name and pick the test cases for this suite.' : 'Update the suite name or its test cases.'}
                      </div>
                    )}
                  </div>
                  <button onClick={closeForm} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 4px', marginTop: 1 }}>✕</button>
                </div>

                {/* Card — form content only, no internal title */}
                <div style={{
                  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
                  padding: '18px 20px', position: 'relative', overflow: 'hidden',
                  maxHeight: 'calc(100vh - 220px)', overflowY: 'auto',
                }}>
                  <div style={{
                    position: 'sticky', top: 0, left: 0, right: 0, height: 3, zIndex: 1,
                    background: mode === 'run-now'
                      ? 'linear-gradient(90deg,#2A9D8F,#1d7a6c)'
                      : mode === 'suite-create' || mode === 'suite-edit'
                        ? 'linear-gradient(90deg,#2A9D8F,#059669)'
                        : 'linear-gradient(90deg,#2563AB,#0A2A57)',
                    borderRadius: '12px 12px 0 0',
                    marginTop: -18, marginLeft: -20, marginRight: -20, marginBottom: 18,
                  }} />

                  {(mode === 'create' || mode === 'edit') && (
                    <ScheduleForm
                      mode={mode}
                      initial={editInitial}
                      envConfigs={envConfigs}
                      testCases={testCases}
                      suites={suites}
                      scriptedTcIds={scriptedTcIds}
                      onSave={handleSaveSchedule}
                      onCancel={closeForm}
                      isSaving={creating || updating}
                    />
                  )}

                  {mode === 'run-now' && (
                    <RunNowPanel
                      suites={suites}
                      testCases={testCases}
                      scriptedTcIds={scriptedTcIds}
                      envConfigs={envConfigs}
                      projectId={projectId}
                      onClose={() => setMode('idle')}
                    />
                  )}

                  {(mode === 'suite-create' || mode === 'suite-edit') && (
                    <SuiteForm
                      key={editingSuiteId ?? 'new'}
                      mode={mode === 'suite-create' ? 'create' : 'edit'}
                      initial={editSuiteInitial}
                      testCases={testCases}
                      scriptedTcIds={scriptedTcIds}
                      onSave={(data) => handleSaveSuite(data)}
                      onCancel={closeForm}
                      isSaving={creatingSuite || updatingSuite}
                    />
                  )}
                </div>
              </>
            ) : (
              <>
                {activeRuns.length > 0 && (
                  <div style={{ background: 'var(--surface)', border: '1px solid rgba(37,99,171,0.3)', borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--cyan)', display: 'inline-block' }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>In Progress</span>
                      <span style={{ fontSize: 10, background: 'rgba(37,99,171,0.12)', color: 'var(--cyan)', padding: '1px 7px', borderRadius: 100, fontWeight: 700 }}>{activeRuns.length}</span>
                    </div>
                    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {activeRuns.map(run => <ActiveRunCard key={run.id} run={run} />)}
                    </div>
                  </div>
                )}

                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Recent Scheduled Runs</span>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{scheduledRuns.length} total</span>
                  </div>
                  <RecentRunsTable runs={scheduledRuns.slice(0, 20)} loading={runsLoading} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
