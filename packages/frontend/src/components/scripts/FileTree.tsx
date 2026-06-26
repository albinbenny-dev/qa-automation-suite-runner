import React from 'react';
import type { Script } from '../../types';

interface FileTreeProps {
  scripts: Script[];
  activeId: string | null;
  onSelect: (script: Script) => void;
  onDelete: (script: Script) => void;
  /** When false (Viewer role) the per-row delete button is hidden */
  canDelete?: boolean;
}

function StatusDot({ status }: { status: Script['lastRunStatus'] }) {
  if (status === 'PASSED') {
    return (
      <span
        title="Last run: passed"
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: 'var(--pass)',
          flexShrink: 0,
          display: 'inline-block',
        }}
      />
    );
  }
  if (status === 'FAILED') {
    return (
      <span
        title="Last run: failed"
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: 'var(--fail)',
          flexShrink: 0,
          display: 'inline-block',
        }}
      />
    );
  }
  if (status === 'RUNNING') {
    return (
      <span
        title="Running"
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: 'var(--run)',
          flexShrink: 0,
          display: 'inline-block',
        }}
      />
    );
  }
  return (
    <span
      title="Never run"
      style={{
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: 'var(--border2)',
        flexShrink: 0,
        display: 'inline-block',
      }}
    />
  );
}

function TreeItem({
  script,
  isActive,
  onSelect,
  onDelete,
  canDelete = true,
}: {
  script: Script;
  isActive: boolean;
  onSelect: (s: Script) => void;
  onDelete: (s: Script) => void;
  canDelete?: boolean;
}) {
  const [hovering, setHovering] = React.useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(script)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(script)}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        cursor: 'pointer',
        borderRadius: 4,
        background: isActive
          ? 'var(--cyan-dim)'
          : hovering
          ? 'rgba(255,255,255,0.04)'
          : 'transparent',
        color: isActive ? 'var(--cyan)' : 'var(--text-mid)',
        fontSize: 12,
        fontFamily: 'var(--font-mono)',
        userSelect: 'none',
        transition: 'background 0.12s, color 0.12s',
        position: 'relative',
      }}
    >
      {/* TypeScript icon */}
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: '#3178c6',
          background: 'rgba(49,120,198,0.15)',
          borderRadius: 3,
          padding: '1px 3px',
          flexShrink: 0,
          fontFamily: 'var(--font-ui)',
        }}
      >
        TS
      </span>

      {/* Filename */}
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 12,
        }}
        title={script.filename}
      >
        {script.filename}
      </span>

      {/* Custom badge */}
      {script.isCustomUpload && (
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: 'var(--violet)',
            background: 'var(--violet-dim)',
            borderRadius: 3,
            padding: '1px 4px',
            flexShrink: 0,
            fontFamily: 'var(--font-ui)',
          }}
        >
          CUSTOM
        </span>
      )}

      {/* Status dot */}
      <StatusDot status={script.lastRunStatus} />

      {/* Delete button on hover — hidden for Viewers */}
      {hovering && canDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(script);
          }}
          title="Delete script"
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--rose)',
            fontSize: 12,
            lineHeight: 1,
            padding: '2px 4px',
            borderRadius: 3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '1.3px',
        textTransform: 'uppercase',
        color: 'var(--text-dim)',
        fontFamily: 'var(--font-mono)',
        padding: '10px 10px 4px',
        userSelect: 'none',
      }}
    >
      {label}
    </div>
  );
}

export default function FileTree({ scripts, activeId, onSelect, onDelete, canDelete = true }: FileTreeProps) {
  const generated = scripts.filter((s) => !s.isCustomUpload);
  const custom = scripts.filter((s) => s.isCustomUpload);

  if (scripts.length === 0) {
    return (
      <div
        style={{
          padding: '24px 12px',
          textAlign: 'center',
          color: 'var(--text-dim)',
          fontSize: 12,
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
        No scripts yet.
        <br />
        Click <strong style={{ color: 'var(--6d-orange)' }}>+ Generate</strong> to create scripts
        from test cases.
      </div>
    );
  }

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {generated.length > 0 && (
        <>
          <SectionLabel label="AI Generated" />
          {generated.map((s) => (
            <TreeItem
              key={s.id}
              script={s}
              isActive={s.id === activeId}
              onSelect={onSelect}
              onDelete={onDelete}
              canDelete={canDelete}
            />
          ))}
        </>
      )}

      {custom.length > 0 && (
        <>
          <SectionLabel label="Custom Uploads" />
          {custom.map((s) => (
            <TreeItem
              key={s.id}
              script={s}
              isActive={s.id === activeId}
              onSelect={onSelect}
              onDelete={onDelete}
              canDelete={canDelete}
            />
          ))}
        </>
      )}
    </div>
  );
}
