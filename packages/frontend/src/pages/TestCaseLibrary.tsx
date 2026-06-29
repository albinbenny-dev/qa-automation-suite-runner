import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useProject } from '../hooks/useProjects';
import { useTestCases } from '../hooks/useTestCases';
import { useRBAC } from '../hooks/useRBAC';
import {
  useTcItems,
  useTcItemStats,
  useImportTcItems,
  useUpdateTcItem,
  useDeleteTcItem,
  useBulkDeleteTcItems,
  useBulkLinkTcItems,
  useBulkMoveTcItems,
  useBulkSetAutomationStatus,
  type TcItem,
  type ImportResult,
} from '../hooks/useTcItems';
import { useExecutionStore } from '../stores/executionStore';
import { api } from '../lib/api';

// ── Stat tile ──────────────────────────────────────────────────────────────
function StatTile({ label, value, sub, color }: { label: string; value: number; sub?: string; color: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '4px', boxShadow: 'var(--shadow-card)' }}>
      <div style={{ fontSize: '22px', fontWeight: 800, color, fontFamily: 'var(--font-mono)' }}>{value}</div>
      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text)' }}>{label}</div>
      {sub && <div style={{ fontSize: '10px', color: 'var(--text-dim)' }}>{sub}</div>}
    </div>
  );
}

// ── Feature group colors (matches Script Library palette) ──────────────────
const GROUP_COLORS = ['--cyan', '--violet', '--emerald', '--amber', '--rose', '--sky'];

function groupColor(index: number): string {
  return GROUP_COLORS[index % GROUP_COLORS.length];
}

function colorToRgba(cssVar: string, alpha: number): string {
  const map: Record<string, string> = {
    '--cyan':    `rgba(37,99,171,${alpha})`,
    '--violet':  `rgba(139,92,246,${alpha})`,
    '--emerald': `rgba(42,157,143,${alpha})`,
    '--amber':   `rgba(245,158,11,${alpha})`,
    '--rose':    `rgba(220,38,38,${alpha})`,
    '--sky':     `rgba(56,189,248,${alpha})`,
  };
  return map[cssVar] ?? `rgba(100,100,100,${alpha})`;
}

// Grid shared between header row and data rows
const GRID = '28px 110px 240px 1fr 90px 136px';
const HEADERS = ['', 'TC ID', 'Test Case', 'Description', 'Script Link', 'Actions'];

function naturalCompare(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// ── Feature group ───────────────────────────────────────────────────────────
function FeatureGroup({
  feature, color, items, isOpen, onOpenChange,
  selectedIds, onToggle, onToggleAll,
  onEdit, onLink, onDelete, onRun, onToggleNA,
}: {
  feature: string; color: string; items: TcItem[]; isOpen: boolean; onOpenChange: (open: boolean) => void;
  selectedIds: Set<string>; onToggle: (id: string) => void; onToggleAll: (ids: string[]) => void;
  onEdit: (item: TcItem) => void; onLink: (item: TcItem) => void;
  onDelete: (item: TcItem) => void; onRun: (item: TcItem) => void; onToggleNA: (item: TcItem) => void;
}) {
  const ids = items.map((i) => i.id);
  const selectedCount = ids.filter((id) => selectedIds.has(id)).length;
  const allSelected = ids.length > 0 && selectedCount === ids.length;
  const linkedCount = items.filter((i) => i.linkedScriptId && i.automationStatus === 'IN_SCOPE').length;
  const naCount = items.filter((i) => i.automationStatus === 'NOT_APPLICABLE').length;

  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${colorToRgba(color, 0.25)}`, borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
      {/* Group header */}
      <div
        onClick={() => onOpenChange(!isOpen)}
        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: `linear-gradient(90deg, ${colorToRgba(color, 0.07)}, transparent)`, borderBottom: isOpen ? `1px solid ${colorToRgba(color, 0.2)}` : 'none', cursor: 'pointer', userSelect: 'none' }}
      >
        <div
          className={`tc-checkbox${allSelected ? ' checked' : selectedCount > 0 ? ' indeterminate' : ''}`}
          style={{ fontSize: '10px', flexShrink: 0 }}
          onClick={(e) => { e.stopPropagation(); onToggleAll(ids); }}
        >
          {allSelected ? '✓' : selectedCount > 0 ? '–' : ''}
        </div>
        <span style={{ fontSize: '11px', color: 'var(--text-dim)', minWidth: '10px', transition: 'transform 0.15s', display: 'inline-block', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: `var(${color})`, flexShrink: 0 }} />
        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', flex: 1 }}>{feature}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{items.length} TCs</span>
        {linkedCount > 0 && <span className="badge badge-pass" style={{ fontSize: '8px' }}>{linkedCount} linked</span>}
        {linkedCount < items.length - naCount && <span className="badge badge-draft" style={{ fontSize: '8px' }}>{items.length - naCount - linkedCount} unlinked</span>}
        {naCount > 0 && <span style={{ fontSize: '8px', padding: '2px 5px', borderRadius: '4px', background: 'rgba(107,114,128,0.12)', border: '1px solid rgba(107,114,128,0.25)', color: 'var(--text-dim)', fontWeight: 700 }}>{naCount} N/A</span>}
      </div>

      {/* Table */}
      {isOpen && items.length > 0 && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '8px', padding: '6px 14px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
            {HEADERS.map((col, i) => (
              <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: '1px', fontWeight: 700 }}>
                {col}
              </div>
            ))}
          </div>
          {items.map((item) => (
            <TcItemRow key={item.id} item={item} selected={selectedIds.has(item.id)} onToggle={onToggle} onEdit={onEdit} onLink={onLink} onDelete={onDelete} onRun={onRun} onToggleNA={onToggleNA} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── TC Item row ────────────────────────────────────────────────────────────
function TcItemRow({ item, selected, onToggle, onEdit, onLink, onDelete, onRun, onToggleNA }: {
  item: TcItem; selected: boolean;
  onToggle: (id: string) => void; onEdit: (item: TcItem) => void;
  onLink: (item: TcItem) => void; onDelete: (item: TcItem) => void;
  onRun: (item: TcItem) => void; onToggleNA: (item: TcItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = !!(item.steps || item.expectedResult || item.description);

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Main row */}
      <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '8px', padding: '8px 14px', alignItems: 'center', background: selected ? 'var(--cyan-dim)' : item.automationStatus === 'NOT_APPLICABLE' ? 'rgba(107,114,128,0.04)' : 'transparent', borderLeft: selected ? '2px solid var(--cyan)' : item.automationStatus === 'NOT_APPLICABLE' ? '2px solid rgba(107,114,128,0.3)' : '2px solid transparent', transition: 'background 0.15s', opacity: item.automationStatus === 'NOT_APPLICABLE' ? 0.6 : 1 }}>
        <div className={`tc-checkbox${selected ? ' checked' : ''}`} style={{ fontSize: '10px', flexShrink: 0 }} onClick={() => onToggle(item.id)}>
          {selected ? '✓' : ''}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
          <button
            title={expanded ? 'Collapse detail' : hasDetail ? 'Expand steps & expected result' : 'No detail available'}
            onClick={() => hasDetail && setExpanded((v) => !v)}
            style={{ width: '16px', height: '16px', borderRadius: '3px', background: expanded ? 'var(--cyan-dim)' : 'var(--surface2)', border: `1px solid ${expanded ? 'rgba(37,99,171,0.35)' : 'var(--border)'}`, color: expanded ? 'var(--cyan)' : hasDetail ? 'var(--text)' : 'var(--border)', fontSize: '8px', cursor: hasDetail ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s', lineHeight: 1 }}
          >{expanded ? '▲' : '▼'}</button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--cyan)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.srNo ?? '—'}</span>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: item.automationStatus === 'NOT_APPLICABLE' ? 'var(--text-dim)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: item.automationStatus === 'NOT_APPLICABLE' ? 'line-through' : 'none' }}>{item.title}</div>
        </div>

        <div style={{ fontSize: '10px', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.description ?? ''}>
          {item.description ?? '—'}
        </div>

        <div>
          {item.automationStatus === 'NOT_APPLICABLE' ? (
            <span style={{ fontSize: '8px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(107,114,128,0.12)', border: '1px solid rgba(107,114,128,0.3)', color: 'var(--text-dim)', fontWeight: 700, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>N/A</span>
          ) : item.linkedScript ? (
            <span className="badge badge-pass" style={{ fontSize: '8px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }} title={item.linkedScript.title}>
              ⚡ {item.linkedScript.tcId}
            </span>
          ) : (
            <span className="badge badge-draft" style={{ fontSize: '8px' }}>Unlinked</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '3px', justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
          {/* Execute — only for linked IN_SCOPE TCs */}
          {item.linkedScript && item.automationStatus === 'IN_SCOPE' ? (
            <button
              title="Run this script in Execution"
              onClick={() => onRun(item)}
              style={{ width: '24px', height: '24px', borderRadius: '4px', background: 'rgba(37,99,171,0.12)', border: '1px solid rgba(37,99,171,0.3)', color: 'var(--cyan)', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--cyan-dim)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--cyan)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(37,99,171,0.12)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(37,99,171,0.3)'; }}
            >▶</button>
          ) : <div style={{ width: '24px', flexShrink: 0 }} />}

          {/* Scope toggle — green circle when IN_SCOPE, grey N/A when NOT_APPLICABLE */}
          <button
            title={item.automationStatus === 'NOT_APPLICABLE' ? 'Mark as In Scope' : 'Mark as Not Applicable'}
            onClick={() => onToggleNA(item)}
            style={{ width: '24px', height: '24px', borderRadius: '4px', background: item.automationStatus === 'NOT_APPLICABLE' ? 'rgba(107,114,128,0.15)' : 'rgba(34,197,94,0.12)', border: `1px solid ${item.automationStatus === 'NOT_APPLICABLE' ? 'rgba(107,114,128,0.4)' : 'rgba(34,197,94,0.35)'}`, color: item.automationStatus === 'NOT_APPLICABLE' ? '#9ca3af' : '#4ade80', fontSize: item.automationStatus === 'NOT_APPLICABLE' ? '9px' : '13px', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s', fontFamily: 'var(--font-mono)' }}
            onMouseEnter={(e) => { const na = item.automationStatus === 'NOT_APPLICABLE'; (e.currentTarget as HTMLButtonElement).style.background = na ? 'rgba(107,114,128,0.25)' : 'rgba(34,197,94,0.22)'; (e.currentTarget as HTMLButtonElement).style.borderColor = na ? 'rgba(107,114,128,0.6)' : 'rgba(34,197,94,0.55)'; }}
            onMouseLeave={(e) => { const na = item.automationStatus === 'NOT_APPLICABLE'; (e.currentTarget as HTMLButtonElement).style.background = na ? 'rgba(107,114,128,0.15)' : 'rgba(34,197,94,0.12)'; (e.currentTarget as HTMLButtonElement).style.borderColor = na ? 'rgba(107,114,128,0.4)' : 'rgba(34,197,94,0.35)'; }}
          >{item.automationStatus === 'NOT_APPLICABLE' ? 'N/A' : '●'}</button>

          {/* Link — green */}
          <button
            title={item.linkedScript ? 'Change linked script' : 'Link to script'}
            onClick={() => onLink(item)}
            style={{ width: '24px', height: '24px', borderRadius: '4px', background: item.linkedScript ? 'rgba(42,157,143,0.18)' : 'rgba(42,157,143,0.07)', border: `1px solid ${item.linkedScript ? 'rgba(42,157,143,0.45)' : 'rgba(42,157,143,0.25)'}`, color: item.linkedScript ? 'var(--emerald)' : 'rgba(42,157,143,0.55)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(42,157,143,0.25)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(42,157,143,0.6)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--emerald)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = item.linkedScript ? 'rgba(42,157,143,0.18)' : 'rgba(42,157,143,0.07)'; (e.currentTarget as HTMLButtonElement).style.borderColor = item.linkedScript ? 'rgba(42,157,143,0.45)' : 'rgba(42,157,143,0.25)'; (e.currentTarget as HTMLButtonElement).style.color = item.linkedScript ? 'var(--emerald)' : 'rgba(42,157,143,0.55)'; }}
          >⛓</button>

          {/* Edit — amber */}
          <button
            title="Edit test case"
            onClick={() => onEdit(item)}
            style={{ width: '24px', height: '24px', borderRadius: '4px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.2)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(245,158,11,0.5)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.1)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(245,158,11,0.3)'; }}
          >✏</button>

          {/* Delete — red */}
          <button
            title="Delete"
            onClick={() => onDelete(item)}
            style={{ width: '24px', height: '24px', borderRadius: '4px', background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', color: '#ef4444', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s', lineHeight: 1 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(220,38,38,0.2)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(220,38,38,0.5)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(220,38,38,0.1)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(220,38,38,0.3)'; }}
          >✕</button>
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div style={{ padding: '10px 14px 12px 46px', background: 'var(--surface2)', borderLeft: '2px solid rgba(37,99,171,0.2)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {item.description && (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '3px' }}>Description</div>
              <div style={{ fontSize: '11px', color: 'var(--text)', lineHeight: 1.5 }}>{item.description}</div>
            </div>
          )}
          {item.steps && (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '3px' }}>Steps</div>
              <pre style={{ margin: 0, fontSize: '11px', color: 'var(--text)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{item.steps}</pre>
            </div>
          )}
          {item.expectedResult && (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '3px' }}>Expected Result</div>
              <div style={{ fontSize: '11px', color: 'var(--emerald)', lineHeight: 1.5 }}>{item.expectedResult}</div>
            </div>
          )}
          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '6px', paddingTop: '4px', borderTop: '1px solid var(--border)' }}>
            <button
              onClick={() => { setExpanded(false); onEdit(item); }}
              style={{ padding: '5px 14px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: '5px', color: '#f59e0b', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.15s' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.2)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(245,158,11,0.55)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.1)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(245,158,11,0.35)'; }}
            >✏ Edit</button>
            <button
              onClick={() => { setExpanded(false); onDelete(item); }}
              style={{ padding: '5px 14px', background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: '5px', color: '#ef4444', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.15s' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(220,38,38,0.2)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(220,38,38,0.5)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(220,38,38,0.1)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(220,38,38,0.3)'; }}
            >✕ Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Selection action bar ───────────────────────────────────────────────────
function SelectionBar({ count, linkedCount, naCount, inScopeCount, allFeatures, onClear, onBulkDelete, onMoveToFeature, onOpenLinkModal, onBulkRun, onBulkMarkNA, onBulkMarkInScope }: {
  count: number;
  linkedCount: number;
  naCount: number;
  inScopeCount: number;
  allFeatures: string[];
  onClear: () => void;
  onBulkDelete: () => void;
  onMoveToFeature: (feature: string) => void;
  onOpenLinkModal: () => void;
  onBulkRun: () => void;
  onBulkMarkNA: () => void;
  onBulkMarkInScope: () => void;
}) {
  const [showMoveDrop, setShowMoveDrop] = useState(false);
  const [customFeature, setCustomFeature] = useState('');

  return (
    <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 500, display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '10px', boxShadow: '0 8px 32px rgba(0,0,0,0.45)', padding: '8px 14px' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700, color: 'var(--text)', paddingRight: '8px', borderRight: '1px solid var(--border)' }}>
        {count} selected
      </span>

      {/* ⛓ Link Script — opens full grouped modal */}
      <button
        onClick={onOpenLinkModal}
        style={{ padding: '5px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
      >
        ⛓ Link Script
      </button>

      {/* N/A / In Scope toggle */}
      {inScopeCount > 0 && (
        <button
          onClick={onBulkMarkNA}
          title={`Mark ${inScopeCount} in-scope TCs as Not Applicable`}
          style={{ padding: '5px 12px', background: 'rgba(107,114,128,0.1)', border: '1px solid rgba(107,114,128,0.3)', borderRadius: '6px', color: 'var(--text-dim)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
        >
          N/A ({inScopeCount})
        </button>
      )}
      {naCount > 0 && (
        <button
          onClick={onBulkMarkInScope}
          title={`Restore ${naCount} N/A TCs to In Scope`}
          style={{ padding: '5px 12px', background: 'rgba(42,157,143,0.1)', border: '1px solid rgba(42,157,143,0.3)', borderRadius: '6px', color: 'var(--emerald)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
        >
          ↩ In Scope ({naCount})
        </button>
      )}

      {/* 📁 Move to Feature */}
      <div style={{ position: 'relative' }}>
        <button onClick={() => { setShowMoveDrop((v) => !v); setShowLinkDrop(false); }} style={{ padding: '5px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
          📁 Move to Feature ▾
        </button>
        {showMoveDrop && (
          <div style={{ position: 'absolute', bottom: '36px', left: 0, minWidth: '230px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 600, overflow: 'hidden' }}>
            <div style={{ padding: '8px' }}>
              <input autoFocus value={customFeature} onChange={(e) => setCustomFeature(e.target.value)} placeholder="Type or choose a feature…" style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text)', fontSize: '11px', padding: '6px 8px', outline: 'none', boxSizing: 'border-box' }}
                onKeyDown={(e) => { if (e.key === 'Enter' && customFeature.trim()) { onMoveToFeature(customFeature.trim()); setShowMoveDrop(false); setCustomFeature(''); } if (e.key === 'Escape') setShowMoveDrop(false); }} />
            </div>
            <div style={{ borderTop: '1px solid var(--border)', maxHeight: '180px', overflowY: 'auto' }}>
              {allFeatures.filter((f) => !customFeature || f.toLowerCase().includes(customFeature.toLowerCase())).map((f) => (
                <div key={f} onClick={() => { onMoveToFeature(f); setShowMoveDrop(false); setCustomFeature(''); }} style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--text)', cursor: 'pointer' }} onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--surface2)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>{f}</div>
              ))}
              {customFeature.trim() && !allFeatures.some((f) => f.toLowerCase() === customFeature.trim().toLowerCase()) && (
                <div onClick={() => { onMoveToFeature(customFeature.trim()); setShowMoveDrop(false); setCustomFeature(''); }} style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--cyan)', cursor: 'pointer', borderTop: '1px solid var(--border)', fontStyle: 'italic' }} onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--cyan-dim)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>
                  + Create "{customFeature.trim()}"
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ▶ Run linked */}
      <button
        onClick={onBulkRun}
        disabled={linkedCount === 0}
        title={linkedCount === 0 ? 'No linked scripts in selection' : `Run ${linkedCount} linked script${linkedCount === 1 ? '' : 's'}`}
        style={{ padding: '5px 12px', background: linkedCount > 0 ? 'rgba(37,99,171,0.12)' : 'var(--surface2)', border: `1px solid ${linkedCount > 0 ? 'rgba(37,99,171,0.3)' : 'var(--border)'}`, borderRadius: '6px', color: linkedCount > 0 ? 'var(--cyan)' : 'var(--text-dim)', fontSize: '11px', fontWeight: 700, cursor: linkedCount > 0 ? 'pointer' : 'not-allowed', opacity: linkedCount === 0 ? 0.4 : 1 }}
      >
        ▶ Run ({linkedCount})
      </button>

      <button onClick={onBulkDelete} style={{ padding: '5px 12px', background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: '6px', color: 'var(--fail)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
        🗑 Delete ({count})
      </button>
      <button onClick={onClear} title="Clear selection" style={{ width: '26px', height: '26px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-dim)', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
    </div>
  );
}

// ── Edit modal ─────────────────────────────────────────────────────────────
function EditItemModal({ item, onSave, onClose }: {
  item: TcItem; onSave: (patch: Partial<TcItem>) => Promise<void>; onClose: () => void;
}) {
  const [srNo, setSrNo] = useState(item.srNo?.toString() ?? '');
  const [module, setModule] = useState(item.module ?? '');
  const [feature, setFeature] = useState(item.feature ?? '');
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? '');
  const [steps, setSteps] = useState(item.steps ?? '');
  const [expectedResult, setExpectedResult] = useState(item.expectedResult ?? '');
  const [saving, setSaving] = useState(false);

  const LABEL: React.CSSProperties = { fontSize: '9px', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginBottom: '4px' };
  const INPUT: React.CSSProperties = { width: '100%', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '6px', color: 'var(--text)', fontSize: '12px', padding: '7px 10px', outline: 'none', boxSizing: 'border-box' };

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave({ srNo: srNo.trim() || undefined, module: module.trim() || undefined, feature: feature.trim() || undefined, title: title.trim(), description: description.trim() || undefined, steps: steps.trim() || undefined, expectedResult: expectedResult.trim() || undefined });
    } finally { setSaving(false); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '12px', width: '100%', maxWidth: '580px', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontSize: '14px' }}>✏️</span>
          <div style={{ flex: 1, fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>Edit Test Case</div>
          <button onClick={onClose} style={{ width: '28px', height: '28px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-dim)', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: '12px' }}>
            <div><div style={LABEL}>SR No</div><input style={INPUT} value={srNo} onChange={(e) => setSrNo(e.target.value)} placeholder="e.g. AIR-TC-001" /></div>
            <div><div style={LABEL}>Module</div><input style={INPUT} value={module} onChange={(e) => setModule(e.target.value)} placeholder="e.g. CPM" /></div>
            <div><div style={LABEL}>Feature</div><input style={INPUT} value={feature} onChange={(e) => setFeature(e.target.value)} placeholder="e.g. Geo Hierarchy" /></div>
          </div>
          <div><div style={LABEL}>Test Case Title *</div><input autoFocus style={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Test case title" /></div>
          <div><div style={LABEL}>Description</div><textarea style={{ ...INPUT, resize: 'vertical', minHeight: '60px' }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" /></div>
          <div><div style={LABEL}>Steps</div><textarea style={{ ...INPUT, resize: 'vertical', minHeight: '100px', fontFamily: 'var(--font-mono)', fontSize: '11px' }} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={'1. Navigate to...\n2. Click...\n3. Verify...'} /></div>
          <div><div style={LABEL}>Expected Result</div><textarea style={{ ...INPUT, resize: 'vertical', minHeight: '60px' }} value={expectedResult} onChange={(e) => setExpectedResult(e.target.value)} placeholder="What should happen" /></div>
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', padding: '12px 18px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '7px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-dim)', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !title.trim()} style={{ padding: '7px 20px', background: 'var(--cyan-dim)', border: '1px solid rgba(37,99,171,0.35)', borderRadius: '6px', color: 'var(--cyan)', fontSize: '12px', fontWeight: 700, cursor: saving || !title.trim() ? 'not-allowed' : 'pointer', opacity: saving || !title.trim() ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Link Script modal ──────────────────────────────────────────────────────
function LinkScriptModal({ item, scripts, onLink, onClose }: {
  item: TcItem;
  scripts: Array<{ id: string; tcId: string; title: string; useCaseTag: string | null }>;
  onLink: (scriptId: string | null) => Promise<void>; onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [linking, setLinking] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Build stable ordered groups (Uncategorised last)
  const groups = useMemo(() => {
    const map = new Map<string, typeof scripts>();
    for (const s of scripts) {
      const key = s.useCaseTag ?? 'Uncategorised';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    // Sort: named use cases first, Uncategorised last
    const entries = Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Uncategorised') return 1;
      if (b === 'Uncategorised') return -1;
      return a.localeCompare(b);
    });
    return entries.map(([name, items], i) => ({ name, items, color: groupColor(i) }));
  }, [scripts]);

  // Filter within groups; hide empty groups
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((s) =>
          s.tcId.toLowerCase().includes(q) ||
          s.title.toLowerCase().includes(q) ||
          g.name.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, search]);

  const totalVisible = filteredGroups.reduce((n, g) => n + g.items.length, 0);

  async function handleSelect(scriptId: string | null) {
    setLinking(true);
    try { await onLink(scriptId); } finally { setLinking(false); }
  }

  function toggleGroup(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '12px', width: '100%', maxWidth: '560px', maxHeight: '78vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontSize: '14px' }}>⛓</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>Link to Script</div>
            <div style={{ fontSize: '10px', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
          </div>
          <button onClick={onClose} style={{ width: '28px', height: '28px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-dim)', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <input
            autoFocus
            className="input-field"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Search by ID, title, or use case…"
            style={{ width: '100%', padding: '7px 10px' }}
          />
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1 }}>

          {/* Remove link row */}
          {item.linkedScriptId && !search && (
            <div
              onClick={() => !linking && handleSelect(null)}
              style={{ padding: '9px 14px', cursor: linking ? 'wait' : 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--fail)', fontSize: '11px', fontWeight: 600 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(220,38,38,0.06)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              <span>✕</span> Remove current link
            </div>
          )}

          {totalVisible === 0 && (
            <div style={{ padding: '28px', textAlign: 'center', fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>No scripts found</div>
          )}

          {/* Groups */}
          {filteredGroups.map((g) => {
            const isOpen = search.trim() ? true : !collapsed.has(g.name);
            return (
              <div key={g.name}>
                {/* Group header */}
                <div
                  onClick={() => !search.trim() && toggleGroup(g.name)}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 14px', background: `linear-gradient(90deg, ${colorToRgba(g.color, 0.07)}, transparent)`, borderBottom: `1px solid ${colorToRgba(g.color, 0.18)}`, cursor: search.trim() ? 'default' : 'pointer', userSelect: 'none', position: 'sticky', top: 0, zIndex: 1 }}
                >
                  {!search.trim() && (
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)', transition: 'transform 0.15s', display: 'inline-block', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
                  )}
                  <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: `var(${g.color})`, flexShrink: 0 }} />
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text)', flex: 1 }}>{g.name}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)' }}>{g.items.length}</span>
                </div>

                {/* Scripts in group */}
                {isOpen && g.items.map((s) => {
                  const isLinked = s.id === item.linkedScriptId;
                  return (
                    <div
                      key={s.id}
                      onClick={() => !linking && handleSelect(s.id)}
                      style={{ padding: '8px 14px 8px 30px', borderBottom: '1px solid var(--border)', cursor: linking ? 'wait' : 'pointer', background: isLinked ? 'var(--emerald-dim)' : 'transparent', display: 'flex', alignItems: 'center', gap: '10px', transition: 'background 0.1s' }}
                      onMouseEnter={(e) => { if (!isLinked) (e.currentTarget as HTMLDivElement).style.background = 'var(--surface2)'; }}
                      onMouseLeave={(e) => { if (!isLinked) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {isLinked && <span style={{ color: 'var(--emerald)', fontSize: '10px' }}>✓</span>}
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>{s.tcId}</span>
                        </div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: isLinked ? 'var(--emerald)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>{s.title}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Bulk Link Script modal (same grouped view, used from floating SelectionBar) ──
function BulkLinkScriptModal({ count, linkedCount, scripts, onSelect, onUnlink, onClose }: {
  count: number;
  linkedCount: number;
  scripts: Array<{ id: string; tcId: string; title: string; useCaseTag: string | null }>;
  onSelect: (testCaseId: string) => void;
  onUnlink: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const map = new Map<string, typeof scripts>();
    for (const s of scripts) {
      const key = s.useCaseTag ?? 'Uncategorised';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    const entries = Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Uncategorised') return 1;
      if (b === 'Uncategorised') return -1;
      return a.localeCompare(b);
    });
    return entries.map(([name, items], i) => ({ name, items, color: groupColor(i) }));
  }, [scripts]);

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((s) =>
          s.tcId.toLowerCase().includes(q) || s.title.toLowerCase().includes(q) || g.name.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, search]);

  const totalVisible = filteredGroups.reduce((n, g) => n + g.items.length, 0);

  function toggleGroup(name: string) {
    setCollapsed((prev) => { const next = new Set(prev); if (next.has(name)) next.delete(name); else next.add(name); return next; });
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '12px', width: '100%', maxWidth: '560px', maxHeight: '78vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontSize: '14px' }}>⛓</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>Link Script</div>
            <div style={{ fontSize: '10px', color: 'var(--text-dim)' }}>Linking {count} selected test case{count === 1 ? '' : 's'} to one script</div>
          </div>
          {linkedCount > 0 && (
            <button
              onClick={() => { onUnlink(); onClose(); }}
              title={`Unlink script from ${linkedCount} already-linked test case${linkedCount === 1 ? '' : 's'}`}
              style={{ padding: '4px 10px', borderRadius: '6px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171', fontSize: '11px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              ✕ Unlink {linkedCount}
            </button>
          )}
          <button onClick={onClose} style={{ width: '28px', height: '28px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-dim)', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <input
            autoFocus
            className="input-field"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Search by ID, title, or use case…"
            style={{ width: '100%', padding: '7px 10px' }}
          />
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {totalVisible === 0 && (
            <div style={{ padding: '28px', textAlign: 'center', fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>No scripts found</div>
          )}
          {filteredGroups.map((g) => {
            const isOpen = search.trim() ? true : !collapsed.has(g.name);
            return (
              <div key={g.name}>
                <div
                  onClick={() => !search.trim() && toggleGroup(g.name)}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 14px', background: `linear-gradient(90deg, ${colorToRgba(g.color, 0.07)}, transparent)`, borderBottom: `1px solid ${colorToRgba(g.color, 0.18)}`, cursor: search.trim() ? 'default' : 'pointer', userSelect: 'none', position: 'sticky', top: 0, zIndex: 1 }}
                >
                  {!search.trim() && (
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)', transition: 'transform 0.15s', display: 'inline-block', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
                  )}
                  <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: `var(${g.color})`, flexShrink: 0 }} />
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text)', flex: 1 }}>{g.name}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)' }}>{g.items.length}</span>
                </div>
                {isOpen && g.items.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => { onSelect(s.id); onClose(); }}
                    style={{ padding: '8px 14px 8px 30px', borderBottom: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', transition: 'background 0.1s' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--surface2)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>{s.tcId}</span>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>{s.title}</div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Import modal ───────────────────────────────────────────────────────────
function ImportModal({ projectId, onClose, onImported }: { projectId: string; onClose: () => void; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportResult | null>(null);
  const importMutation = useImportTcItems(projectId);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const result = await importMutation.mutateAsync(file);
      setSummary(result);
      onImported();
    } catch { toast.error('Import failed — check the file format'); }
    finally { setImporting(false); }
  }

  async function handleDownloadTemplate() {
    try {
      const res = await api.get(`/projects/${projectId}/tc-items/template`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a'); a.href = url; a.download = 'tc-import-template.xlsx'; a.click(); URL.revokeObjectURL(url);
    } catch { toast.error('Template download failed'); }
  }

  const hasWarnings = summary && (summary.skippedEmpty > 0 || summary.duplicateRows.length > 0 || summary.rfNotFound.length > 0);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '12px', width: '100%', maxWidth: summary ? '520px' : '420px', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontSize: '14px' }}>{summary ? (hasWarnings ? '⚠️' : '✅') : '📥'}</span>
          <div style={{ flex: 1, fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
            {summary ? 'Import Summary' : 'Import from Excel'}
          </div>
          <button onClick={onClose} style={{ width: '28px', height: '28px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-dim)', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Summary view */}
        {summary ? (
          <div style={{ overflowY: 'auto', flex: 1, padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

            {/* Stat row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
              {[
                { label: 'Total rows', value: summary.totalRows, color: 'var(--text-dim)' },
                { label: 'New', value: summary.imported, color: 'var(--pass)' },
                { label: 'Updated', value: summary.updated ?? 0, color: (summary.updated ?? 0) > 0 ? 'var(--cyan)' : 'var(--text-dim)' },
                { label: 'Auto-linked', value: summary.linked, color: summary.linked > 0 ? 'var(--cyan)' : 'var(--text-dim)' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '22px', fontWeight: 800, color, fontFamily: 'var(--font-mono)' }}>{value}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '2px', fontWeight: 600 }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Skipped empty rows */}
            {summary.skippedEmpty > 0 && (
              <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '8px', padding: '10px 14px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--amber)', marginBottom: '2px' }}>⚠ {summary.skippedEmpty} empty rows skipped</div>
                <div style={{ fontSize: '10px', color: 'var(--text-dim)' }}>Rows with no Test Case Title were ignored.</div>
              </div>
            )}

            {/* Duplicate rows */}
            {summary.duplicateRows.length > 0 && (
              <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '8px', padding: '10px 14px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--amber)', marginBottom: '6px' }}>⚠ {summary.duplicateRows.length} duplicate TC{summary.duplicateRows.length === 1 ? '' : 's'} skipped</div>
                <div style={{ maxHeight: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {summary.duplicateRows.map((r, i) => (
                    <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>• {r}</div>
                  ))}
                </div>
              </div>
            )}

            {/* RF Script IDs not found */}
            {summary.rfNotFound.length > 0 && (
              <div style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: '8px', padding: '10px 14px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--fail)', marginBottom: '4px' }}>✕ {summary.rfNotFound.length} RF Script ID{summary.rfNotFound.length === 1 ? '' : 's'} not matched</div>
                <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '6px' }}>These filenames were in the sheet but no matching script was found in this project:</div>
                <div style={{ maxHeight: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {summary.rfNotFound.map((r, i) => (
                    <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--fail)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>• {r}</div>
                  ))}
                </div>
              </div>
            )}

            {/* All good */}
            {!hasWarnings && (
              <div style={{ background: 'rgba(42,157,143,0.07)', border: '1px solid rgba(42,157,143,0.25)', borderRadius: '8px', padding: '10px 14px', fontSize: '11px', color: 'var(--pass)', fontWeight: 600 }}>
                ✓ Import completed with no issues.
              </div>
            )}

            <button onClick={onClose} style={{ marginTop: '4px', padding: '8px', background: 'var(--cyan-dim)', border: '1px solid rgba(37,99,171,0.35)', borderRadius: '7px', color: 'var(--cyan)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
              Done
            </button>
          </div>
        ) : (
          /* Upload view */
          <div style={{ padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-mid)', lineHeight: 1.6 }}>
              Upload an Excel file with columns: <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--cyan)' }}>Test Case ID, Module, Feature, Test Case Title, Test Case Description, Step, Expected Result, RF Script ID</span>
            </p>
            <button onClick={handleDownloadTemplate} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-dim)', fontSize: '11px', cursor: 'pointer', width: 'fit-content' }}>📄 Download template</button>
            <div onClick={() => !importing && fileRef.current?.click()} style={{ border: '2px dashed var(--border2)', borderRadius: '8px', padding: '28px', textAlign: 'center', cursor: importing ? 'wait' : 'pointer', opacity: importing ? 0.6 : 1 }} onMouseEnter={(e) => { if (!importing) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--cyan)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border2)'; }}>
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>{importing ? '⏳' : '📊'}</div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>{importing ? 'Importing…' : 'Click to select Excel file'}</div>
              <div style={{ fontSize: '10px', color: 'var(--text-dim)' }}>.xlsx or .xls</div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFile} disabled={importing} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
type LinkFilter = 'all' | 'linked' | 'unlinked' | 'na';

export default function TestCaseLibrary() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(slug);
  const projectId = project?.id;
  useRBAC();

  const { data: items = [], isLoading } = useTcItems(projectId);
  const { data: stats } = useTcItemStats(projectId);
  const { data: tcData } = useTestCases(projectId, { limit: 500 });
  const scripts = tcData?.testCases ?? [];

  const updateMutation = useUpdateTcItem(projectId);
  const deleteMutation = useDeleteTcItem(projectId);
  const bulkDeleteMutation = useBulkDeleteTcItems(projectId);
  const bulkLinkMutation = useBulkLinkTcItems(projectId);
  const bulkMoveMutation = useBulkMoveTcItems(projectId);
  const bulkStatusMutation = useBulkSetAutomationStatus(projectId);
  const { setSelected } = useExecutionStore();

  const [search, setSearch] = useState('');
  const [linkFilter, setLinkFilter] = useState<LinkFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [editingItem, setEditingItem] = useState<TcItem | null>(null);
  const [linkingItem, setLinkingItem] = useState<TcItem | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showBulkLinkModal, setShowBulkLinkModal] = useState(false);

  // Filtered items (search + link status)
  const filteredItems = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((i) => i.title.toLowerCase().includes(q) || (i.module ?? '').toLowerCase().includes(q) || (i.feature ?? '').toLowerCase().includes(q));
    }
    if (linkFilter === 'linked') result = result.filter((i) => !!i.linkedScriptId && i.automationStatus === 'IN_SCOPE');
    if (linkFilter === 'unlinked') result = result.filter((i) => !i.linkedScriptId && i.automationStatus === 'IN_SCOPE');
    if (linkFilter === 'na') result = result.filter((i) => i.automationStatus === 'NOT_APPLICABLE');
    return result;
  }, [items, search, linkFilter]);

  // Group by Feature, sorted by feature name; items within each group sorted by TC ID
  const groups = useMemo(() => {
    const map = new Map<string, TcItem[]>();
    for (const item of filteredItems) {
      const key = item.feature ?? 'Uncategorised';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries())
      .map(([feature, featureItems]) => ({
        feature,
        items: [...featureItems].sort((a, b) => naturalCompare(a.srNo, b.srNo)),
      }))
      .sort((a, b) => {
        // Sort groups by the lowest TC ID in the group so order matches the Excel sheet
        if (a.feature === 'Uncategorised') return 1;
        if (b.feature === 'Uncategorised') return -1;
        const aMin = a.items[0]?.srNo ?? null;
        const bMin = b.items[0]?.srNo ?? null;
        return naturalCompare(aMin, bMin);
      })
      .map(({ feature, items }, i) => ({ feature, items, color: groupColor(i) }));
  }, [filteredItems]);

  // On first data load collapse all groups after the first 2
  const [initialCollapseDone, setInitialCollapseDone] = useState(false);
  useEffect(() => {
    if (!initialCollapseDone && groups.length > 0) {
      setCollapsedGroups(new Set(groups.slice(2).map((g) => g.feature)));
      setInitialCollapseDone(true);
    }
  }, [groups, initialCollapseDone]);

  const allFeatures = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) { if (item.feature) set.add(item.feature); }
    return Array.from(set).sort();
  }, [items]);

  const scriptOptions = useMemo(
    () => scripts.map((s) => ({ id: s.id, tcId: s.tcId, title: s.title, useCaseTag: s.useCaseTag ?? null })),
    [scripts],
  );

  function toggleSelect(id: string) {
    setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleSelectAll(ids: string[]) {
    setSelectedIds((prev) => { const next = new Set(prev); const allSel = ids.every((id) => next.has(id)); if (allSel) ids.forEach((id) => next.delete(id)); else ids.forEach((id) => next.add(id)); return next; });
  }

  async function handleSaveEdit(patch: Partial<TcItem>) {
    if (!editingItem) return;
    try { await updateMutation.mutateAsync({ id: editingItem.id, patch }); toast.success('Test case updated'); setEditingItem(null); }
    catch { toast.error('Update failed'); }
  }
  async function handleLink(scriptId: string | null) {
    if (!linkingItem) return;
    try { await updateMutation.mutateAsync({ id: linkingItem.id, patch: { linkedScriptId: scriptId } }); toast.success(scriptId ? 'Script linked' : 'Link removed'); setLinkingItem(null); }
    catch { toast.error('Link failed'); }
  }
  async function handleDelete(item: TcItem) {
    try { await deleteMutation.mutateAsync(item.id); setSelectedIds((prev) => { const next = new Set(prev); next.delete(item.id); return next; }); toast.success(`"${item.title}" deleted`); }
    catch { toast.error('Delete failed'); }
  }
  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} selected test case${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    try { await bulkDeleteMutation.mutateAsync(ids); setSelectedIds(new Set()); toast.success(`${ids.length} test case${ids.length === 1 ? '' : 's'} deleted`); }
    catch { toast.error('Bulk delete failed'); }
  }
  async function handleMoveToFeature(feature: string) {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try { await bulkMoveMutation.mutateAsync({ ids, feature }); setSelectedIds(new Set()); toast.success(`${ids.length} item${ids.length === 1 ? '' : 's'} moved to "${feature}"`); }
    catch { toast.error('Move failed'); }
  }
  function handleRun(item: TcItem) {
    if (!item.linkedScript) return;
    setSelected([item.linkedScript.id]);
    navigate(`/projects/${slug}/execution`);
  }
  async function handleBulkLinkScript(testCaseId: string) {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      await bulkLinkMutation.mutateAsync({ ids, testCaseId });
      toast.success(`${ids.length} test case${ids.length === 1 ? '' : 's'} linked`);
    } catch { toast.error('Bulk link failed'); }
  }
  async function handleBulkUnlink() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      await bulkLinkMutation.mutateAsync({ ids, testCaseId: null });
      toast.success(`${selectedLinkedCount} test case${selectedLinkedCount === 1 ? '' : 's'} unlinked`);
    } catch { toast.error('Bulk unlink failed'); }
  }
  async function handleToggleNA(item: TcItem) {
    const next = item.automationStatus === 'NOT_APPLICABLE' ? 'IN_SCOPE' : 'NOT_APPLICABLE';
    try {
      await updateMutation.mutateAsync({ id: item.id, patch: { automationStatus: next } });
      toast.success(next === 'NOT_APPLICABLE' ? 'Marked as Not Applicable' : 'Marked as In Scope');
    } catch { toast.error('Update failed'); }
  }
  async function handleBulkMarkNA() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      await bulkStatusMutation.mutateAsync({ ids, automationStatus: 'NOT_APPLICABLE' });
      toast.success(`${ids.length} test case${ids.length === 1 ? '' : 's'} marked as Not Applicable`);
      setSelectedIds(new Set());
    } catch { toast.error('Bulk update failed'); }
  }
  async function handleBulkMarkInScope() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      await bulkStatusMutation.mutateAsync({ ids, automationStatus: 'IN_SCOPE' });
      toast.success(`${ids.length} test case${ids.length === 1 ? '' : 's'} marked as In Scope`);
      setSelectedIds(new Set());
    } catch { toast.error('Bulk update failed'); }
  }
  function handleBulkRun() {
    const linkedScriptIds = items
      .filter((i) => selectedIds.has(i.id) && i.linkedScript)
      .map((i) => i.linkedScript!.id);
    if (!linkedScriptIds.length) return;
    setSelected(linkedScriptIds);
    navigate(`/projects/${slug}/execution`);
  }

  const selectedLinkedCount = useMemo(
    () => items.filter((i) => selectedIds.has(i.id) && !!i.linkedScript).length,
    [items, selectedIds],
  );
  const selectedNaCount = useMemo(
    () => items.filter((i) => selectedIds.has(i.id) && i.automationStatus === 'NOT_APPLICABLE').length,
    [items, selectedIds],
  );
  const selectedInScopeCount = useMemo(
    () => items.filter((i) => selectedIds.has(i.id) && i.automationStatus === 'IN_SCOPE').length,
    [items, selectedIds],
  );

  function expandAll() { setCollapsedGroups(new Set()); }
  function collapseAll() { setCollapsedGroups(new Set(groups.map((g) => g.feature))); }

  const linkedPct = stats && stats.inScope > 0 ? Math.round((stats.linked / stats.inScope) * 100) : 0;

  async function handleExport() {
    if (!projectId) return;
    try {
      const res = await api.get(`/projects/${projectId}/tc-items/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tc-library-${slug ?? 'export'}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Export failed'); }
  }

  // Filter tab style helper
  const filterTab = (active: boolean) => ({
    padding: '4px 12px', fontSize: '10px', fontWeight: 700, cursor: 'pointer', borderRadius: '5px',
    background: active ? 'var(--cyan-dim)' : 'transparent',
    border: active ? '1px solid rgba(37,99,171,0.35)' : '1px solid transparent',
    color: active ? 'var(--cyan)' : 'var(--text-dim)',
    transition: 'all 0.15s',
  } as React.CSSProperties);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: `📡 ${project?.name ?? slug ?? ''}`, href: `/projects/${slug}/settings` },
          { label: '📋 TC Library' },
        ]}
        actions={
          <div style={{ display: 'flex', gap: '6px' }}>
            <TbBtn variant="ghost" onClick={handleExport}>📤 Export Excel</TbBtn>
            <TbBtn variant="ghost" onClick={() => setShowImport(true)}>📥 Import Excel</TbBtn>
          </div>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px 20px 80px' }}>
        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', flexShrink: 0 }}>
          <StatTile label="Total TCs" value={stats?.total ?? items.length} color="var(--cyan)" />
          <StatTile label="In Scope" value={stats?.inScope ?? items.length} color="var(--cyan)" sub="eligible for automation" />
          <StatTile label="Automated" value={stats?.linked ?? 0} color="var(--pass)" sub={stats?.inScope ? `${linkedPct}% of in-scope` : undefined} />
          <StatTile label="Unlinked" value={stats?.unlinked ?? items.length} color="var(--amber)" />
          <StatTile label="Not Applicable" value={stats?.notApplicable ?? 0} color="var(--text-dim)" sub="manual only" />
        </div>
        {/* Coverage bar */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: '6px', boxShadow: 'var(--shadow-card)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text)' }}>Automation Coverage <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 400 }}>(in-scope TCs only)</span></div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 800, color: linkedPct >= 80 ? 'var(--pass)' : linkedPct >= 40 ? 'var(--amber)' : 'var(--fail)' }}>{linkedPct}%</div>
          </div>
          <div style={{ background: 'var(--surface2)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${linkedPct}%`, background: linkedPct >= 80 ? 'var(--pass)' : linkedPct >= 40 ? 'var(--amber)' : 'var(--fail)', borderRadius: '4px', transition: 'width 0.4s' }} />
          </div>
        </div>

        {/* Filter bar */}
        <div className="card" style={{ flexShrink: 0 }}>
          <div className="card-body" style={{ padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <input className="input-field" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Search test cases, modules, features…" style={{ width: '260px', padding: '6px 10px' }} />

              {/* Link status filter */}
              <div style={{ display: 'flex', gap: '3px', padding: '2px', background: 'var(--surface2)', borderRadius: '7px', border: '1px solid var(--border)' }}>
                <button style={filterTab(linkFilter === 'all')} onClick={() => setLinkFilter('all')}>All</button>
                <button style={filterTab(linkFilter === 'linked')} onClick={() => setLinkFilter('linked')}>⚡ Linked</button>
                <button style={filterTab(linkFilter === 'unlinked')} onClick={() => setLinkFilter('unlinked')}>Unlinked</button>
                <button style={{ ...filterTab(linkFilter === 'na'), color: linkFilter === 'na' ? 'var(--text-dim)' : 'var(--text-dim)', background: linkFilter === 'na' ? 'rgba(107,114,128,0.15)' : 'transparent', border: linkFilter === 'na' ? '1px solid rgba(107,114,128,0.35)' : '1px solid transparent' }} onClick={() => setLinkFilter('na')}>N/A</button>
              </div>

              {/* Select All */}
              {(() => {
                const allFilteredIds = filteredItems.map((i) => i.id);
                const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.has(id));
                const someSelected = !allSelected && allFilteredIds.some((id) => selectedIds.has(id));
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div
                      className={`tc-checkbox${allSelected ? ' checked' : someSelected ? ' indeterminate' : ''}`}
                      style={{ fontSize: '10px', flexShrink: 0, cursor: 'pointer' }}
                      title={allSelected ? 'Deselect all' : `Select all ${allFilteredIds.length} TCs`}
                      onClick={() => {
                        if (allSelected) {
                          setSelectedIds((prev) => { const next = new Set(prev); allFilteredIds.forEach((id) => next.delete(id)); return next; });
                        } else {
                          setSelectedIds((prev) => { const next = new Set(prev); allFilteredIds.forEach((id) => next.add(id)); return next; });
                        }
                      }}
                    >
                      {allSelected ? '✓' : someSelected ? '–' : ''}
                    </div>
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)', userSelect: 'none' }}>Select all</span>
                  </div>
                );
              })()}

              {/* Expand / Collapse All */}
              <div style={{ display: 'flex', gap: '4px' }}>
                <button onClick={expandAll} title="Expand all groups" style={{ padding: '4px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-dim)', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}>⊞ All</button>
                <button onClick={collapseAll} title="Collapse all groups" style={{ padding: '4px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-dim)', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}>⊟ All</button>
              </div>

              <div style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                {groups.length} features · {filteredItems.length} TCs
              </div>
            </div>
          </div>
        </div>

        {/* Groups */}
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '40px', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-dim)' }}>Loading test cases…</div>
        ) : groups.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '60px 40px', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', opacity: 0.3 }}>📋</div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
              {linkFilter !== 'all' ? `No ${linkFilter} test cases` : 'No test cases yet'}
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-dim)', maxWidth: '320px', lineHeight: 1.6, margin: 0 }}>
              {linkFilter !== 'all' ? 'Try changing the filter above.' : 'Import your test cases from Excel using the button above.'}
            </p>
            {linkFilter === 'all' && (
              <button onClick={() => setShowImport(true)} style={{ marginTop: '8px', padding: '9px 20px', background: 'var(--cyan-dim)', border: '1px solid rgba(37,99,171,0.35)', borderRadius: '8px', color: 'var(--cyan)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>📥 Import Excel</button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {groups.map((g) => (
              <FeatureGroup
                key={g.feature}
                feature={g.feature}
                color={g.color}
                items={g.items}
                isOpen={!collapsedGroups.has(g.feature)}
                onOpenChange={(open) => {
                  setCollapsedGroups((prev) => {
                    const next = new Set(prev);
                    if (open) next.delete(g.feature); else next.add(g.feature);
                    return next;
                  });
                }}
                selectedIds={selectedIds}
                onToggle={toggleSelect}
                onToggleAll={toggleSelectAll}
                onEdit={setEditingItem}
                onLink={setLinkingItem}
                onDelete={handleDelete}
                onRun={handleRun}
                onToggleNA={handleToggleNA}
              />
            ))}
          </div>
        )}
      </div>

      {/* Floating selection bar */}
      {selectedIds.size > 0 && (
        <SelectionBar
          count={selectedIds.size}
          linkedCount={selectedLinkedCount}
          naCount={selectedNaCount}
          inScopeCount={selectedInScopeCount}
          allFeatures={allFeatures}
          onClear={() => setSelectedIds(new Set())}
          onBulkDelete={handleBulkDelete}
          onMoveToFeature={handleMoveToFeature}
          onOpenLinkModal={() => setShowBulkLinkModal(true)}
          onBulkRun={handleBulkRun}
          onBulkMarkNA={handleBulkMarkNA}
          onBulkMarkInScope={handleBulkMarkInScope}
        />
      )}

      {/* Modals */}
      {showImport && <ImportModal projectId={projectId ?? ''} onClose={() => setShowImport(false)} onImported={() => {}} />}
      {editingItem && <EditItemModal item={editingItem} onSave={handleSaveEdit} onClose={() => setEditingItem(null)} />}
      {linkingItem && <LinkScriptModal item={linkingItem} scripts={scriptOptions} onLink={handleLink} onClose={() => setLinkingItem(null)} />}
      {showBulkLinkModal && (
        <BulkLinkScriptModal
          count={selectedIds.size}
          linkedCount={selectedLinkedCount}
          scripts={scriptOptions}
          onSelect={handleBulkLinkScript}
          onUnlink={handleBulkUnlink}
          onClose={() => setShowBulkLinkModal(false)}
        />
      )}
    </div>
  );
}
