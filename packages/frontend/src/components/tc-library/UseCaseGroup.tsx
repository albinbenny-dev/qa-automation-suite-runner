import { useState } from 'react';
import type { TestCase } from '../../types';
import TCTableRow from './TCTableRow';

export interface UseCaseGroupProps {
  name: string;
  tcs: TestCase[];
  selectedIds: Set<string>;
  scriptedTcIds: Set<string>;
  color: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleTc: (id: string) => void;
  onToggleGroup: (ids: string[]) => void;
  onRunGroup: (ids: string[]) => void;
  onRunIndividual: (tc: TestCase) => void;
  onDeleteTc: (tc: TestCase) => void;
  onDeleteGroup: (name: string) => void;
  onEditTc: (tc: TestCase) => void;
}

const COLUMNS_HEADER = ['', 'Test Case', 'Type', 'Automation', 'Run History', ''];

export default function UseCaseGroup({
  name,
  tcs,
  selectedIds,
  scriptedTcIds,
  color,
  expanded,
  onToggleExpand,
  onToggleTc,
  onToggleGroup,
  onRunGroup,
  onRunIndividual,
  onDeleteTc,
  onDeleteGroup,
  onEditTc,
}: UseCaseGroupProps) {
  const [expandedTcId, setExpandedTcId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const tcIds = tcs.map((tc) => tc.id);
  const selectedCount = tcIds.filter((id) => selectedIds.has(id)).length;
  const allSelected = tcIds.length > 0 && selectedCount === tcIds.length;
  const passedCount = tcs.filter((tc) => tc.lastRun?.status === 'PASSED').length;
  const failedCount = tcs.filter((tc) => tc.lastRun?.status === 'FAILED').length;

  function handleHeaderCheckbox(e: React.MouseEvent) {
    e.stopPropagation();
    onToggleGroup(tcIds);
  }

  function handleExpandTc(id: string | null) {
    setExpandedTcId((cur) => (cur === id ? null : id));
  }

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Group header */}
      <div
        onClick={onToggleExpand}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 14px',
          background: `linear-gradient(90deg, ${colorToRgba(color, 0.07)}, transparent)`,
          borderBottom: expanded ? '1px solid var(--border)' : 'none',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {/* Group checkbox */}
        <div
          className={`tc-checkbox${allSelected ? ' checked' : selectedCount > 0 ? ' indeterminate' : ''}`}
          style={{
            fontSize: '10px',
            flexShrink: 0,
            ...(allSelected
              ? { background: `var(${color})`, borderColor: `var(${color})` }
              : selectedCount > 0
              ? { background: `rgba(244,123,32,0.3)`, borderColor: `var(${color})` }
              : {}),
          }}
          onClick={handleHeaderCheckbox}
        >
          {allSelected ? '✓' : selectedCount > 0 ? '–' : ''}
        </div>

        {/* Chevron */}
        <span style={{ fontSize: '11px', color: 'var(--text-dim)', minWidth: '10px', transition: 'transform 0.15s', display: 'inline-block', transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
          ▼
        </span>

        {/* Status dot */}
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: `var(${color})`,
            flexShrink: 0,
          }}
        />

        {/* Group name */}
        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', flex: 1 }}>
          {name}
        </span>

        {/* TC count + selection */}
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            color: 'var(--text-dim)',
            whiteSpace: 'nowrap',
          }}
        >
          {tcs.length} TCs{selectedCount > 0 ? ` · ${selectedCount} selected` : ''}
        </span>

        {/* Pass chip */}
        {passedCount > 0 && (
          <span className="badge badge-pass" style={{ fontSize: '8px' }}>
            {passedCount}✓
          </span>
        )}

        {/* Fail chip */}
        {failedCount > 0 && (
          <span className="badge badge-fail" style={{ fontSize: '8px' }}>
            {failedCount}✗
          </span>
        )}

        {/* Run Group button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRunGroup(tcIds);
          }}
          style={{
            padding: '4px 10px',
            background: 'var(--emerald-dim)',
            border: '1px solid rgba(42,157,143,0.3)',
            borderRadius: '5px',
            color: 'var(--emerald)',
            fontSize: '10px',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          ▶ Run Group
        </button>

        {/* Delete group */}
        {confirmingDelete ? (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <span style={{ fontSize: '10px', color: 'var(--fail)', fontWeight: 600 }}>
              Delete {tcs.length} TCs?
            </span>
            <button
              onClick={() => { setConfirmingDelete(false); onDeleteGroup(name); }}
              style={{
                padding: '3px 8px',
                background: 'rgba(220,38,38,0.1)',
                border: '1px solid rgba(220,38,38,0.3)',
                borderRadius: '4px',
                color: 'var(--fail)',
                fontSize: '10px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              style={{
                padding: '3px 8px',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                color: 'var(--text-dim)',
                fontSize: '10px',
                cursor: 'pointer',
              }}
            >
              No
            </button>
          </div>
        ) : (
          <button
            title="Delete all TCs in this group"
            onClick={(e) => {
              e.stopPropagation();
              if (tcs.length === 0) return;
              setConfirmingDelete(true);
            }}
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '4px',
              background: 'transparent',
              border: '1px solid transparent',
              color: 'var(--text-dim)',
              fontSize: '11px',
              cursor: tcs.length === 0 ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              opacity: tcs.length === 0 ? 0.3 : 0.6,
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              if (tcs.length > 0) {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(220,38,38,0.1)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(220,38,38,0.3)';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--fail)';
                (e.currentTarget as HTMLButtonElement).style.opacity = '1';
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)';
              (e.currentTarget as HTMLButtonElement).style.opacity = tcs.length === 0 ? '0.3' : '0.6';
            }}
          >
            🗑
          </button>
        )}
      </div>

      {/* Expanded table */}
      {expanded && tcs.length > 0 && (
        <div>
          {/* Column headers */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '28px 1fr 60px 100px 96px 72px',
              gap: '8px',
              padding: '6px 14px',
              background: 'var(--surface2)',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {COLUMNS_HEADER.map((col, i) => (
              <div
                key={i}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  color: 'var(--text-dim)',
                  letterSpacing: '1px',
                  fontWeight: 700,
                }}
              >
                {col}
              </div>
            ))}
          </div>

          {/* TC rows */}
          {tcs.map((tc) => (
            <TCTableRow
              key={tc.id}
              tc={tc}
              selected={selectedIds.has(tc.id)}
              hasScript={scriptedTcIds.has(tc.id)}
              onToggle={onToggleTc}
              onRunIndividual={onRunIndividual}
              onDelete={onDeleteTc}
              onEdit={onEditTc}
              isExpanded={expandedTcId === tc.id}
              onExpand={handleExpandTc}
            />
          ))}
        </div>
      )}

      {expanded && tcs.length === 0 && (
        <div
          style={{
            padding: '20px 14px',
            textAlign: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--text-dim)',
          }}
        >
          No test cases in this group.
        </div>
      )}
    </div>
  );
}

function colorToRgba(cssVar: string, alpha: number): string {
  const map: Record<string, string> = {
    '--violet':  `rgba(244,123,32,${alpha})`,
    '--amber':   `rgba(245,158,11,${alpha})`,
    '--emerald': `rgba(42,157,143,${alpha})`,
    '--cyan':    `rgba(37,99,171,${alpha})`,
    '--rose':    `rgba(220,38,38,${alpha})`,
    '--sky':     `rgba(37,99,171,${alpha})`,
    '--pass':    `rgba(42,157,143,${alpha})`,
    '--fail':    `rgba(220,38,38,${alpha})`,
    '--run':     `rgba(37,99,171,${alpha})`,
  };
  return map[cssVar] ?? `rgba(100,100,100,${alpha})`;
}
