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
  isExpanded = false,
  onExpand,
}: TCTableRowProps) {
  const suiteTags = tc.tags.filter((t) => t.startsWith('suite:'));
  const regularTags = tc.tags.filter((t) => !t.startsWith('suite:'));

  function handleRowClick() {
    onExpand?.(isExpanded ? null : tc.id);
  }

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Main row — click = expand */}
      <div
        className={`tc-item${selected ? ' selected' : ''}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '28px 1fr 60px 110px 96px 52px',
          gap: '8px',
          padding: '9px 14px',
          alignItems: 'center',
          cursor: 'pointer',
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
        onClick={handleRowClick}
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
          {/* ▶ only shown when a Playwright script exists */}
          {hasScript && (
            <button
              title="Run this test"
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
          <button
            title={isExpanded ? 'Collapse details' : 'Expand details'}
            onClick={(e) => { e.stopPropagation(); onExpand?.(isExpanded ? null : tc.id); }}
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '4px',
              background: isExpanded ? 'var(--cyan-dim)' : 'var(--surface2)',
              border: isExpanded ? '1px solid rgba(37,99,171,0.35)' : '1px solid var(--border)',
              color: isExpanded ? 'var(--cyan)' : 'var(--text-dim)',
              fontSize: '10px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'all 0.15s',
            }}
          >
            {isExpanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Detail panel */}
      {isExpanded && (
        <div
          style={{
            background: 'var(--surface2)',
            borderLeft: '3px solid var(--cyan)',
            padding: '14px 16px 16px 20px',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* Left column: steps */}
            <div>
              <div style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-dim)', fontWeight: 700, marginBottom: '6px' }}>
                Steps
              </div>
              <ol style={{ margin: 0, paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {tc.steps.map((step, i) => (
                  <li key={i} style={{ fontSize: '11px', color: 'var(--text)', lineHeight: 1.5 }}>
                    {step}
                  </li>
                ))}
              </ol>
            </div>

            {/* Right column: expected result + meta */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {tc.description && (
                <div>
                  <div style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-dim)', fontWeight: 700, marginBottom: '4px' }}>
                    Description
                  </div>
                  <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-mid)', lineHeight: 1.5 }}>
                    {tc.description}
                  </p>
                </div>
              )}

              {tc.expectedResult && (
                <div>
                  <div style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-dim)', fontWeight: 700, marginBottom: '4px' }}>
                    Expected Result
                  </div>
                  <p style={{ margin: 0, fontSize: '11px', color: 'var(--text)', lineHeight: 1.5 }}>
                    {tc.expectedResult}
                  </p>
                </div>
              )}

              {/* Meta row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>Priority:</span>
                <span style={{ fontSize: '10px', fontWeight: 700, color: PRIORITY_COLOR[tc.priority] ?? 'var(--text)' }}>
                  {tc.priority}
                </span>
                {tc.sourceRef && (
                  <>
                    <span style={{ color: 'var(--border2)' }}>·</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>Src:</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--cyan)' }}>
                      {tc.sourceRef}
                    </span>
                  </>
                )}
              </div>

              {/* All tags */}
              {tc.tags.length > 0 && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {tc.tags.map((tag) =>
                    tag.startsWith('suite:') ? (
                      <span key={tag} className="tag" style={{ fontSize: '8px', background: 'var(--amber-dim)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.3)' }}>
                        {tag.replace('suite:', '⚡ ')}
                      </span>
                    ) : (
                      <span key={tag} className="tag" style={{ fontSize: '8px' }}>{tag}</span>
                    )
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Action row */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
            {onEdit && (
              <button
                onClick={() => onEdit(tc)}
                style={{
                  padding: '5px 14px',
                  background: 'var(--cyan-dim)',
                  border: '1px solid rgba(37,99,171,0.3)',
                  borderRadius: '5px',
                  color: 'var(--cyan)',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  marginLeft: 'auto',
                }}
              >
                ✏ Edit TC
              </button>
            )}
            <button
              onClick={() => onDelete(tc)}
              style={{
                padding: '5px 14px',
                background: 'rgba(220,38,38,0.07)',
                border: '1px solid rgba(220,38,38,0.25)',
                borderRadius: '5px',
                color: 'var(--fail)',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                ...(onEdit ? {} : { marginLeft: 'auto' }),
              }}
            >
              🗑 Delete TC
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
