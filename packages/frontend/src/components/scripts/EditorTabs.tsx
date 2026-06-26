import React from 'react';
import type { Script } from '../../types';

export type EditorTab =
  | { kind: 'script'; id: string; filename: string; script: Script }
  | { kind: 'resource'; id: string; filename: string };

interface EditorTabsProps {
  tabs: EditorTab[];
  activeId: string | null;
  dirtyIds: Set<string>;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

export default function EditorTabs({
  tabs,
  activeId,
  dirtyIds,
  onActivate,
  onClose,
}: EditorTabsProps) {
  if (tabs.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        overflowX: 'auto',
        background: '#06224A',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        minHeight: 36,
        flexShrink: 0,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const isDirty = dirtyIds.has(tab.id);
        return (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={isActive}
            isDirty={isDirty}
            onActivate={() => onActivate(tab.id)}
            onClose={() => onClose(tab.id)}
          />
        );
      })}
    </div>
  );
}

function Tab({
  tab,
  isActive,
  isDirty,
  onActivate,
  onClose,
}: {
  tab: EditorTab;
  isActive: boolean;
  isDirty: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const [closeHover, setCloseHover] = React.useState(false);
  const [tabHover, setTabHover] = React.useState(false);
  const isResource = tab.kind === 'resource';
  const activeColor = isResource ? 'var(--emerald)' : '#60a5fa';
  const activeBg = isResource ? 'rgba(42,157,143,0.08)' : 'rgba(96,165,250,0.08)';

  return (
    <div
      onClick={onActivate}
      onMouseEnter={() => setTabHover(true)}
      onMouseLeave={() => setTabHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 12px',
        cursor: 'pointer',
        userSelect: 'none',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        borderBottom: isActive ? `1.5px solid ${activeColor}` : '1.5px solid transparent',
        background: isActive
          ? activeBg
          : tabHover
          ? 'rgba(255,255,255,0.03)'
          : 'transparent',
        color: isActive ? activeColor : 'rgba(226,232,240,0.55)',
        transition: 'background 0.1s, color 0.1s',
        fontSize: 12,
        fontFamily: 'var(--font-mono)',
        whiteSpace: 'nowrap',
        minWidth: 0,
        maxWidth: 200,
        position: 'relative',
      }}
    >
      {/* Dirty indicator */}
      {isDirty && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#fbbf24',
            flexShrink: 0,
          }}
        />
      )}

      {/* Icon */}
      {isResource && (
        <span style={{ fontSize: 11, flexShrink: 0 }}>🤖</span>
      )}

      {/* Filename */}
      <span
        style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}
        title={tab.filename}
      >
        {tab.filename}
      </span>

      {/* Close button */}
      {(tabHover || isActive) && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onMouseEnter={() => setCloseHover(true)}
          onMouseLeave={() => setCloseHover(false)}
          style={{
            border: 'none',
            background: closeHover ? 'rgba(248,113,113,0.25)' : 'transparent',
            color: closeHover ? '#f87171' : 'inherit',
            cursor: 'pointer',
            borderRadius: 3,
            width: 16,
            height: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            flexShrink: 0,
            transition: 'background 0.1s, color 0.1s',
            padding: 0,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
