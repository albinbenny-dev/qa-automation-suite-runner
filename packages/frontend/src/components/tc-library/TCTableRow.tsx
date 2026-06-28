import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { TestCase } from '../../types';

interface TCTableRowProps {
  tc: TestCase;
  selected: boolean;
  hasScript?: boolean;
  onToggle: (id: string) => void;
  onRunIndividual: (tc: TestCase) => void;
  onDelete: (tc: TestCase) => void;
  onEdit?: (tc: TestCase) => void;
  isRunning?: boolean;
  isExpanded?: boolean;
  onExpand?: (id: string | null) => void;
}

const TYPE_CLASS: Record<string, string> = {
  UI:  'badge-rose',
  API: 'badge-cyan',
  SIT: 'badge-teal',
};

const PRIORITY_COLOR: Record<string, string> = {
  LOW:      'var(--text-dim)',
  MEDIUM:   'var(--amber)',
  HIGH:     'var(--violet)',
  CRITICAL: 'var(--fail)',
};

const RUN_COLOR: Record<string, string> = {
  PASSED:    '#2A9D8F',
  FAILED:    '#DC2626',
  SKIPPED:   '#F59E0B',
  CANCELLED: '#64748b',
};

type RunEntry = { status: string; runId: string };

/** 5 mini coloured blocks — oldest left, newest right.
 *  Each filled block is clickable and navigates to the report for that run. */
function RunHistorySparkline({ statuses }: { statuses?: RunEntry[] }) {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const filled = statuses ?? [];

  if (filled.length === 0) {
    return (
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
        —
      </span>
    );
  }

  // Right-align: pad empty slots on the LEFT so newest run is always at the right edge.
  const slots: (RunEntry | null)[] = [
    ...Array<null>(Math.max(0, 5 - filled.length)).fill(null),
    ...filled,
  ];

  function handleBlockClick(e: React.MouseEvent, entry: RunEntry) {
    e.stopPropagation(); // don't expand the TC row
    navigate(`/projects/${slug}/reports?run=${entry.runId}`);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {slots.map((entry, i) => {
        const color = entry ? RUN_COLOR[entry.status] ?? '#64748b' : null;
        const clickable = entry?.status === 'PASSED' || entry?.status === 'FAILED';
        return (
          <div
            key={i}
            title={
              clickable
                ? `${entry!.status} — click to open report`
                : entry
                ? entry.status
                : 'No run yet'
            }
            onClick={clickable ? (e) => handleBlockClick(e, entry!) : undefined}
            style={{
              width: 8,
              height: 16,
              borderRadius: 2,
              flexShrink: 0,
              background: color ?? 'transparent',
              border: color ? `1px solid ${color}55` : '1px solid var(--border)',
              opacity: entry ? 1 : 0.3,
              cursor: clickable ? 'pointer' : 'default',
              transition: 'transform 0.1s, box-shadow 0.1s',
            }}
            onMouseEnter={(e) => {
              if (!clickable) return;
              const el = e.currentTarget as HTMLDivElement;
              el.style.transform = 'scaleY(1.25)';
              el.style.boxShadow = `0 0 5px ${color}99`;
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLDivElement;
              el.style.transform = 'scaleY(1)';
              el.style.boxShadow = 'none';
            }}
          />
        );
      })}
    </div>
  );
}

export default function TCTableRow({
  tc,
  selected,
  hasScript = false,
  onToggle,
  onRunIndividual,
  onDelete,
  onEdit,
  isRunning = false,
}: TCTableRowProps) {
  const suiteTags = tc.tags.filter((t) => t.startsWith('suite:'));
  const regularTags = tc.tags.filter((t) => !t.startsWith('suite:'));

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Main row */}
      <div
        className={`tc-item${selected ? ' selected' : ''}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '28px 1fr 60px 110px 96px 76px',
          gap: '8px',
          padding: '9px 14px',
          alignItems: 'center',
          cursor: 'default',
          background: isRunning
            ? 'rgba(37,99,171,0.06)'
            : selected
            ? 'var(--cyan-dim)'
            : 'transparent',
          borderLeft: selected
            ? '2px solid var(--cyan)'
            : isRunning
            ? '2px solid var(--run)'
            : '2px solid transparent',
          transition: 'background 0.15s',
          borderBottom: 'none',
        }}
      >
        {/* Checkbox — click selects, does NOT expand */}
        <div
          className={`tc-checkbox${selected ? ' checked' : ''}`}
          style={{ fontSize: '10px', flexShrink: 0 }}
          onClick={(e) => { e.stopPropagation(); onToggle(tc.id); }}
        >
          {selected ? '✓' : ''}
        </div>

        {/* Title + TC-ID + tags */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {isRunning && (
              <span
                className="dot dot-blink"
                style={{ background: 'var(--run)', width: '6px', height: '6px', flexShrink: 0 }}
              />
            )}
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--text)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '340px',
                display: 'block',
              }}
            >
              {tc.title}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)' }}>
              {tc.tcId}
            </span>
            {tc.prerequisiteTcId && tc.prerequisiteTc && (
              <span
                title={`Prerequisite: ${tc.prerequisiteTc.tcId} — ${tc.prerequisiteTc.title}`}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '8px',
                  color: 'var(--cyan)',
                  background: 'var(--cyan-dim)',
                  border: '1px solid rgba(37,99,171,0.25)',
                  borderRadius: '3px',
                  padding: '1px 4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                }}
              >
                ⛓ {tc.prerequisiteTc.tcId}
              </span>
            )}
            {regularTags.slice(0, 2).map((tag) => (
              <span key={tag} className="tag" style={{ fontSize: '8px' }}>{tag}</span>
            ))}
            {suiteTags.map((tag) => (
              <span
                key={tag}
                className="tag"
                style={{ fontSize: '8px', background: 'var(--amber-dim)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.3)' }}
              >
                {tag.replace('suite:', '⚡ ')}
              </span>
            ))}
          </div>
        </div>

        {/* Type badge */}
        <div>
          <span className={`badge ${TYPE_CLASS[tc.type] ?? 'badge-draft'}`} style={{ fontSize: '8px' }}>
            {tc.type.toLowerCase()}
          </span>
        </div>

        {/* Automation status column */}
        <div>
          {hasScript ? (
            <span
              className="badge badge-pass"
              style={{ fontSize: '8px', display: 'flex', alignItems: 'center', gap: '3px', width: 'fit-content' }}
            >
              ⚡ Automated
            </span>
          ) : (
            <span className="badge badge-draft" style={{ fontSize: '8px' }}>
              {tc.status.toLowerCase()}
            </span>
          )}
        </div>

        {/* Run history sparkline — last 5 runs, oldest→newest, right = latest */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <RunHistorySparkline statuses={tc.recentRunStatuses} />
        </div>

        {/* Action buttons */}
        <div
          style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}
          onClick={(e) => e.stopPropagation()}
        >
          {hasScript && (
            <button
              title="Run this script"
              onClick={() => onRunIndividual(tc)}
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '4px',
                background: 'var(--emerald-dim)',
                border: '1px solid rgba(42,157,143,0.3)',
                color: 'var(--emerald)',
                fontSize: '10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              ▶
            </button>
          )}
          {onEdit && (
            <button
              title="Edit title & description"
              onClick={() => onEdit(tc)}
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '4px',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                color: 'var(--text-dim)',
                fontSize: '11px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--cyan-dim)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(37,99,171,0.35)';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--cyan)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface2)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)';
              }}
            >
              ✏
            </button>
          )}
          <button
            title="Delete"
            onClick={() => onDelete(tc)}
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '4px',
              background: 'transparent',
              border: '1px solid transparent',
              color: 'var(--text-dim)',
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(220,38,38,0.1)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(220,38,38,0.3)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--fail)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)';
            }}
          >
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}
