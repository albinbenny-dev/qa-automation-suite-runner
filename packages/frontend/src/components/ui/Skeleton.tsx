import React from 'react';

// ── Base shimmer block ─────────────────────────────────────────────────────

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  style?: React.CSSProperties;
  className?: string;
}

function Sk({ width, height, style, className = '' }: SkeletonProps) {
  return (
    <div
      className={`skeleton-shimmer ${className}`}
      style={{ width, height, ...style }}
    />
  );
}

// ── StatRow — 5 stat tiles ─────────────────────────────────────────────────

export function StatRowSkeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="stat-card">
          <Sk width="55%" height={11} style={{ marginBottom: 10 }} />
          <Sk width="38%" height={28} style={{ marginBottom: 8 }} />
          <Sk width="50%" height={10} />
        </div>
      ))}
    </div>
  );
}

// ── TableRows(n) — table body rows ─────────────────────────────────────────

export function TableRowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: 12,
            padding: '13px 16px',
            borderBottom: '1px solid var(--border)',
            alignItems: 'center',
          }}
        >
          <Sk width={18} height={18} style={{ borderRadius: 4, flexShrink: 0 }} />
          <Sk width="28%" height={13} />
          <Sk width="16%" height={13} />
          <Sk width="14%" height={13} />
          <Sk width="10%" height={13} />
          <Sk width={72} height={24} style={{ borderRadius: 6, marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  );
}

// ── CardGrid — project/result card grid ────────────────────────────────────

export function CardGridSkeleton({ cols = 3, count = 6 }: { cols?: number; count?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card" style={{ padding: 18 }}>
          <Sk width="65%" height={18} style={{ marginBottom: 12 }} />
          <Sk width="100%" height={12} style={{ marginBottom: 6 }} />
          <Sk width="80%" height={12} style={{ marginBottom: 18 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Sk width={56} height={22} style={{ borderRadius: 4 }} />
            <Sk width={56} height={22} style={{ borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── MessageList — chat conversation skeleton ───────────────────────────────

export function MessageListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 16 }}>
      {Array.from({ length: count }).map((_, i) => {
        const isUser = i % 2 !== 0;
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              flexDirection: isUser ? 'row-reverse' : 'row',
            }}
          >
            <Sk
              width={32}
              height={32}
              style={{ borderRadius: '50%', flexShrink: 0 }}
            />
            <div style={{ flex: 1, maxWidth: '72%' }}>
              <Sk
                width={isUser ? '45%' : '70%'}
                height={13}
                style={{ marginBottom: 6 }}
              />
              <Sk width={isUser ? '30%' : '85%'} height={13} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Default export — raw shimmer block ────────────────────────────────────

export default Sk;
