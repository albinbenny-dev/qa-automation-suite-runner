import { useState, useMemo } from 'react';
import type { TestCase } from '../../types';

// ── Constants ──────────────────────────────────────────────────────────────

const AIRTEL_USE_CASES = [
  'Primary Sales',
  'Stock Management',
  'Dealer Onboarding & KYC',
  'Sales API',
  'Secondary Sales',
  'Distributor API',
];

const UC_COLORS: Record<string, string> = {
  'Primary Sales':           'var(--violet)',
  'Stock Management':        'var(--amber)',
  'Dealer Onboarding & KYC': 'var(--emerald)',
  'Sales API':               'var(--cyan)',
  'Secondary Sales':         'var(--rose)',
  'Distributor API':         'var(--sky)',
};
const UC_COLOR_FALLBACKS = ['var(--violet)', 'var(--cyan)', 'var(--emerald)', 'var(--amber)', 'var(--rose)', 'var(--sky)'];

function getUcColor(name: string, idx: number) {
  return UC_COLORS[name] ?? UC_COLOR_FALLBACKS[idx % UC_COLOR_FALLBACKS.length];
}

const TYPE_CHIP: Record<string, { bg: string; color: string }> = {
  UI:  { bg: 'rgba(244,123,32,0.1)',  color: 'var(--6d-orange)' },
  API: { bg: 'var(--cyan-dim)',       color: 'var(--cyan)' },
  SIT: { bg: 'var(--emerald-dim)',    color: 'var(--emerald)' },
};

// ── Props ──────────────────────────────────────────────────────────────────

interface TCListPanelProps {
  allTCs: TestCase[];
  useCases: string[];
  selectedIds: Set<string>;
  runningTcIds: Set<string>;
  scriptedTcIds: Set<string>;
  onToggleTc: (id: string) => void;
  onToggleGroup: (ids: string[]) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRunSelected: () => void;
  onRunGroup: (useCaseTag: string) => void;
  onRunIndividual: (tc: TestCase) => void;
  onStopIndividual?: (tc: TestCase) => void;
  onViewTc: (tc: TestCase) => void;
  onDuplicateTc: (tc: TestCase) => void;
  isRunning: boolean;
}

export default function TCListPanel({
  allTCs,
  useCases,
  selectedIds,
  runningTcIds,
  scriptedTcIds,
  onToggleTc,
  onToggleGroup,
  onSelectAll,
  onClearSelection,
  onRunSelected,
  onRunGroup,
  onRunIndividual,
  onViewTc,
  onDuplicateTc,
  isRunning,
}: TCListPanelProps) {
  const [viewMode, setViewMode] = useState<'usecase' | 'flat'>('usecase');
  const [typeFilter, setTypeFilter] = useState<'' | 'UI' | 'API' | 'SIT'>('');
  const [statusFilter, setStatusFilter] = useState('scripted');
  const [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(AIRTEL_USE_CASES));

  // ── Filtered TCs ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allTCs.filter((tc) => {
      if (typeFilter && tc.type !== typeFilter) return false;
      if (statusFilter === 'scripted' && !scriptedTcIds.has(tc.id)) return false;
      if (statusFilter === 'unscripted' && scriptedTcIds.has(tc.id)) return false;
      if (statusFilter === 'running' && !runningTcIds.has(tc.id)) return false;
      if (q && !tc.title.toLowerCase().includes(q) && !tc.tcId.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allTCs, typeFilter, statusFilter, search, scriptedTcIds, runningTcIds]);

  // ── Grouped TCs ──────────────────────────────────────────────────────────
  const groups = useMemo(() => {
    const map = new Map<string, TestCase[]>();
    AIRTEL_USE_CASES.forEach((uc) => map.set(uc, []));
    useCases.filter((uc) => !AIRTEL_USE_CASES.includes(uc)).forEach((uc) => map.set(uc, []));
    for (const tc of filtered) {
      const key = tc.useCaseTag ?? 'Uncategorised';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(tc);
    }
    return Array.from(map.entries())
      .filter(([, tcs]) => tcs.length > 0)
      .map(([name, tcs], i) => ({ name, tcs, color: getUcColor(name, i) }));
  }, [filtered, useCases]);

  const totalVisible = filtered.length;
  const totalGroups = groups.length;

  function toggleGroup(name: string) {
    setExpandedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name); else n.add(name);
      return n;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      borderTop: '1px solid var(--border)',
    }}>
      {/* View toggle + filter bar */}
      <div style={{
        padding: '8px 14px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
        flexWrap: 'wrap',
        background: 'var(--surface2)',
      }}>
        {/* View mode toggle */}
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {(['usecase', 'flat'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: '4px 9px',
                borderRadius: 5,
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
                border: `1px solid ${viewMode === mode ? 'rgba(37,99,171,0.3)' : 'var(--border)'}`,
                background: viewMode === mode ? 'var(--cyan-dim)' : 'var(--surface3)',
                color: viewMode === mode ? 'var(--cyan)' : 'var(--text-dim)',
              }}
            >
              {mode === 'usecase' ? '🏷 By UseCase' : '≡ Flat List'}
            </button>
          ))}
        </div>

        {/* Type filter pills */}
        <div style={{ display: 'flex', gap: 3 }}>
          {(['', 'UI', 'API', 'SIT'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              style={{
                padding: '3px 8px',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                border: `1px solid ${typeFilter === t ? 'rgba(37,99,171,0.3)' : 'var(--border)'}`,
                background: typeFilter === t ? 'var(--cyan-dim)' : 'transparent',
                color: typeFilter === t ? 'var(--cyan)' : 'var(--text-dim)',
              }}
            >
              {t || 'All'}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            padding: '3px 6px',
            borderRadius: 4,
            fontSize: 10,
            fontFamily: 'var(--font-ui)',
            background: 'var(--surface3)',
            border: '1px solid var(--border)',
            color: 'var(--text-dim)',
            cursor: 'pointer',
          }}
        >
          <option value="">All Status</option>
          <option value="scripted">Has Script</option>
          <option value="unscripted">No Script</option>
          <option value="running">Running</option>
        </select>

        {/* Search */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search TCs…"
          style={{
            flex: 1,
            minWidth: 100,
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 11,
            background: 'var(--surface3)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            fontFamily: 'var(--font-ui)',
            outline: 'none',
          }}
        />

        {/* Group info */}
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--text-dim)',
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}>
          {viewMode === 'usecase' ? `${totalGroups} groups · ` : ''}{totalVisible} TCs
        </span>
      </div>

      {/* Selection bar */}
      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 14px',
          background: 'rgba(37,99,171,0.08)',
          borderBottom: '1px solid rgba(37,99,171,0.2)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--cyan)', flex: 1 }}>
            ✓ {selectedIds.size} selected
            {totalGroups > 0 && viewMode === 'usecase' ? ` across ${groups.filter((g) => g.tcs.some((tc) => selectedIds.has(tc.id))).length} groups` : ''}
          </span>
          <button
            onClick={onSelectAll}
            style={{
              fontSize: 10, background: 'none', border: 'none',
              color: 'var(--text-dim)', cursor: 'pointer', padding: '2px 6px',
              fontFamily: 'var(--font-ui)', fontWeight: 600,
            }}
          >
            All {totalVisible}
          </button>
          <button
            onClick={onClearSelection}
            style={{
              fontSize: 10, background: 'none', border: 'none',
              color: 'var(--text-dim)', cursor: 'pointer', padding: '2px 6px',
              fontFamily: 'var(--font-ui)', fontWeight: 600,
            }}
          >
            Clear
          </button>
          <button
            onClick={onRunSelected}
            disabled={isRunning}
            style={{
              padding: '4px 12px',
              borderRadius: 5,
              fontSize: 11,
              fontWeight: 700,
              cursor: isRunning ? 'not-allowed' : 'pointer',
              background: isRunning ? 'rgba(244,123,32,0.1)' : 'var(--6d-orange)',
              border: 'none',
              color: 'white',
              opacity: isRunning ? 0.5 : 1,
              fontFamily: 'var(--font-ui)',
            }}
          >
            ▶ Run {selectedIds.size} Selected
          </button>
        </div>
      )}

      {/* TC List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>📋</div>
            {search || typeFilter || statusFilter ? 'No matching test cases.' : 'No test cases yet.'}
          </div>
        ) : viewMode === 'usecase' ? (
          groups.map((group, gIdx) => (
            <UseCaseGroupRow
              key={group.name}
              group={group}
              groupIndex={gIdx}
              expanded={expandedGroups.has(group.name)}
              selectedIds={selectedIds}
              runningTcIds={runningTcIds}
              scriptedTcIds={scriptedTcIds}
              isRunning={isRunning}
              onToggleExpand={() => toggleGroup(group.name)}
              onToggleTc={onToggleTc}
              onToggleGroup={onToggleGroup}
              onRunGroup={onRunGroup}
              onRunIndividual={onRunIndividual}
              onViewTc={onViewTc}
              onDuplicateTc={onDuplicateTc}
            />
          ))
        ) : (
          filtered.map((tc) => (
            <TCRow
              key={tc.id}
              tc={tc}
              isSelected={selectedIds.has(tc.id)}
              isRunning={runningTcIds.has(tc.id)}
              runDisabled={isRunning}
              onToggle={() => onToggleTc(tc.id)}
              onRun={() => onRunIndividual(tc)}
              onView={() => onViewTc(tc)}
              onDuplicate={() => onDuplicateTc(tc)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── UseCase group ─────────────────────────────────────────────────────────
function UseCaseGroupRow({
  group, groupIndex: _groupIndex, expanded, selectedIds, runningTcIds, scriptedTcIds: _scriptedTcIds,
  isRunning, onToggleExpand, onToggleTc, onToggleGroup, onRunGroup, onRunIndividual, onViewTc, onDuplicateTc,
}: {
  group: { name: string; tcs: TestCase[]; color: string };
  groupIndex: number;
  expanded: boolean;
  selectedIds: Set<string>;
  runningTcIds: Set<string>;
  scriptedTcIds: Set<string>;
  isRunning: boolean;
  onToggleExpand: () => void;
  onToggleTc: (id: string) => void;
  onToggleGroup: (ids: string[]) => void;
  onRunGroup: (tag: string) => void;
  onRunIndividual: (tc: TestCase) => void;
  onViewTc: (tc: TestCase) => void;
  onDuplicateTc: (tc: TestCase) => void;
}) {
  const ids = group.tcs.map((tc) => tc.id);
  const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
  const someSelected = ids.some((id) => selectedIds.has(id));
  const passCount = group.tcs.filter((tc) => tc.lastRun?.status === 'PASSED').length;
  const failCount = group.tcs.filter((tc) => tc.lastRun?.status === 'FAILED').length;
  const runningInGroup = group.tcs.filter((tc) => runningTcIds.has(tc.id)).length;

  return (
    <div>
      {/* Group header */}
      <div
        onClick={onToggleExpand}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px',
          cursor: 'pointer',
          background: `linear-gradient(90deg, ${group.color.replace('var(', '').replace(')', '')} 0 0)`,
          backgroundImage: `linear-gradient(90deg, rgba(37,99,171,0.06) 0%, transparent 100%)`,
          borderBottom: '1px solid var(--border)',
          userSelect: 'none',
          position: 'sticky',
          top: 0,
          zIndex: 1,
        }}
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore inline style with CSS variable
        className="uc-group-header"
      >
        {/* Group checkbox */}
        <div
          className={`tc-checkbox${allSelected ? ' checked' : someSelected ? ' indeterminate' : ''}`}
          style={{ fontSize: 9, flexShrink: 0, width: 14, height: 14 }}
          onClick={(e) => { e.stopPropagation(); onToggleGroup(ids); }}
        >
          {allSelected ? '✓' : someSelected ? '–' : ''}
        </div>

        {/* Chevron */}
        <span style={{
          fontSize: 10,
          color: 'var(--text-dim)',
          flexShrink: 0,
          transition: 'transform 0.15s',
          display: 'inline-block',
          transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
        }}>▼</span>

        {/* Color dot */}
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: group.color, flexShrink: 0, display: 'inline-block',
        }} />

        {/* Name */}
        <span style={{
          flex: 1, fontSize: 11, fontWeight: 700, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {group.name}
        </span>

        {/* TC count chip */}
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)',
          flexShrink: 0,
        }}>
          {group.tcs.length}
        </span>

        {/* Running indicator */}
        {runningInGroup > 0 && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10,
            background: 'rgba(96,165,250,0.15)', color: '#60a5fa',
            border: '1px solid rgba(96,165,250,0.3)', flexShrink: 0,
          }}>
            {runningInGroup} running
          </span>
        )}

        {/* Pass/fail chips */}
        {passCount > 0 && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10,
            background: 'rgba(42,157,143,0.1)', color: 'var(--pass)',
            border: '1px solid rgba(42,157,143,0.25)', flexShrink: 0,
          }}>
            ✓{passCount}
          </span>
        )}
        {failCount > 0 && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10,
            background: 'rgba(220,38,38,0.1)', color: 'var(--fail)',
            border: '1px solid rgba(220,38,38,0.25)', flexShrink: 0,
          }}>
            ✗{failCount}
          </span>
        )}

        {/* Run Group button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRunGroup(group.name);
          }}
          disabled={isRunning}
          style={{
            padding: '3px 9px',
            borderRadius: 4,
            fontSize: 10,
            fontWeight: 700,
            cursor: isRunning ? 'not-allowed' : 'pointer',
            background: 'rgba(42,157,143,0.12)',
            border: '1px solid rgba(42,157,143,0.3)',
            color: '#2A9D8F',
            flexShrink: 0,
            opacity: isRunning ? 0.4 : 1,
          }}
        >
          ▶ Run
        </button>
      </div>

      {/* TC rows */}
      {expanded && group.tcs.map((tc) => (
        <TCRow
          key={tc.id}
          tc={tc}
          isSelected={selectedIds.has(tc.id)}
          isRunning={runningTcIds.has(tc.id)}
          runDisabled={isRunning}
          onToggle={() => onToggleTc(tc.id)}
          onRun={() => onRunIndividual(tc)}
          onView={() => onViewTc(tc)}
          onDuplicate={() => onDuplicateTc(tc)}
          indent
        />
      ))}
    </div>
  );
}

// ── TC row ────────────────────────────────────────────────────────────────
function TCRow({
  tc, isSelected, isRunning, runDisabled,
  onToggle, onRun, onView, onDuplicate, indent = false,
}: {
  tc: TestCase;
  isSelected: boolean;
  isRunning: boolean;
  runDisabled: boolean;
  onToggle: () => void;
  onRun: () => void;
  onView: () => void;
  onDuplicate: () => void;
  indent?: boolean;
}) {
  const chip = TYPE_CHIP[tc.type] ?? { bg: 'var(--surface3)', color: 'var(--text-dim)' };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: `7px 14px 7px ${indent ? 28 : 14}px`,
        borderBottom: '1px solid var(--border)',
        background: isRunning
          ? 'rgba(96,165,250,0.06)'
          : isSelected
          ? 'rgba(37,99,171,0.06)'
          : 'transparent',
        transition: 'background 0.15s',
        cursor: 'default',
      }}
    >
      {/* Running blink dot or checkbox */}
      {isRunning ? (
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: '#60a5fa', flexShrink: 0, display: 'inline-block',
          animation: 'blink 1s ease-in-out infinite',
        }} />
      ) : (
        <div
          className={`tc-checkbox${isSelected ? ' checked' : ''}`}
          style={{ fontSize: 9, flexShrink: 0, width: 14, height: 14 }}
          onClick={onToggle}
        >
          {isSelected ? '✓' : ''}
        </div>
      )}

      {/* Title + TC-ID */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 600,
          color: isRunning ? '#60a5fa' : 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {tc.title}
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)',
          marginTop: 1, display: 'flex', gap: 5, alignItems: 'center',
        }}>
          <span>{tc.tcId}</span>
          {tc.tags.filter((t) => t.startsWith('suite:')).map((t) => (
            <span key={t} style={{
              background: 'rgba(244,123,32,0.08)', color: 'rgba(244,123,32,0.7)',
              padding: '0 4px', borderRadius: 3, fontSize: 8,
            }}>
              {t.replace('suite:', '')}
            </span>
          ))}
        </div>
      </div>

      {/* Type badge */}
      <span style={{
        fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
        background: chip.bg, color: chip.color, flexShrink: 0,
      }}>
        {tc.type}
      </span>

      {/* Run / Stop button */}
      <button
        onClick={onRun}
        disabled={runDisabled && !isRunning}
        title={isRunning ? 'Stop individual test' : 'Run this test'}
        style={{
          width: 22, height: 22, borderRadius: 4,
          background: isRunning ? 'rgba(220,38,38,0.1)' : 'rgba(42,157,143,0.1)',
          border: `1px solid ${isRunning ? 'rgba(220,38,38,0.3)' : 'rgba(42,157,143,0.3)'}`,
          color: isRunning ? '#DC2626' : '#2A9D8F',
          fontSize: isRunning ? 9 : 11, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          opacity: (runDisabled && !isRunning) ? 0.4 : 1,
        }}
      >
        {isRunning ? '■' : '▶'}
      </button>

      {/* Duplicate button */}
      <button
        onClick={onDuplicate}
        title="Duplicate test case"
        style={{
          width: 22, height: 22, borderRadius: 4,
          background: 'rgba(139,92,246,0.08)',
          border: '1px solid rgba(139,92,246,0.2)',
          color: 'var(--violet)', fontSize: 10, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        ⎘
      </button>

      {/* View button */}
      <button
        onClick={onView}
        title="View test case"
        style={{
          width: 22, height: 22, borderRadius: 4,
          background: 'rgba(37,99,171,0.08)',
          border: '1px solid rgba(37,99,171,0.2)',
          color: 'var(--cyan)', fontSize: 10, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        👁
      </button>
    </div>
  );
}
