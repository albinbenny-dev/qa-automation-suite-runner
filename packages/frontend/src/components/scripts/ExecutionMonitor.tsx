import { useEffect, useRef, useState, useCallback } from 'react';
import { useRunSocket } from '../../hooks/useRunSocket';
import LiveLog from '../execution/LiveLog';
import { api } from '../../lib/api';

interface Props {
  runId: string;
  projectId: string;
  scriptName: string;
  onClose: () => void;
}

const MIN_W = 420;
const MIN_H = 320;
const INIT_W = 720;
const INIT_H = 560;

type ResizeEdge = 'e' | 'w' | 's' | 'n' | 'se' | 'sw' | 'ne' | 'nw' | null;

export default function ExecutionMonitor({ runId, projectId, scriptName, onClose }: Props) {
  const { logs, stats, status, clearLogs, joinRun, leaveRun } = useRunSocket();
  const [isStopping, setIsStopping] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [pos, setPos]   = useState(() => ({ x: Math.max(20, window.innerWidth  - INIT_W - 20), y: 60 }));
  const [size, setSize] = useState({ w: INIT_W, h: INIT_H });

  // ── Drag to move ──────────────────────────────────────────────────────────
  const dragOffset = useRef<{ x: number; y: number } | null>(null);

  const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos]);

  // ── Resize ────────────────────────────────────────────────────────────────
  const resizeEdge   = useRef<ResizeEdge>(null);
  const resizeStart  = useRef<{ mx: number; my: number; x: number; y: number; w: number; h: number } | null>(null);

  const onResizeMouseDown = useCallback((edge: ResizeEdge) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeEdge.current  = edge;
    resizeStart.current = { mx: e.clientX, my: e.clientY, x: pos.x, y: pos.y, w: size.w, h: size.h };
  }, [pos, size]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragOffset.current) {
        setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
        return;
      }
      if (!resizeEdge.current || !resizeStart.current) return;
      const { mx, my, x, y, w, h } = resizeStart.current;
      const dx = e.clientX - mx;
      const dy = e.clientY - my;
      const edge = resizeEdge.current;
      let nx = x, ny = y, nw = w, nh = h;
      if (edge.includes('e'))  nw = Math.max(MIN_W, w + dx);
      if (edge.includes('s'))  nh = Math.max(MIN_H, h + dy);
      if (edge.includes('w')) { nw = Math.max(MIN_W, w - dx); nx = x + (w - nw); }
      if (edge.includes('n')) { nh = Math.max(MIN_H, h - dy); ny = y + (h - nh); }
      setSize({ w: nw, h: nh });
      setPos({ x: nx, y: ny });
    };
    const onUp = () => { dragOffset.current = null; resizeEdge.current = null; resizeStart.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // ── Socket + timer ────────────────────────────────────────────────────────
  useEffect(() => {
    clearLogs();
    joinRun(runId);
    elapsedRef.current = setInterval(() => setElapsedMs(ms => ms + 1000), 1000);
    return () => {
      leaveRun(runId);
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    };
  }, [runId]);

  useEffect(() => {
    if (status === 'complete' || status === 'error' || status === 'cancelled') {
      if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
    }
  }, [status]);

  async function handleStop() {
    setIsStopping(true);
    try { await api.post(`/projects/${projectId}/runs/${runId}/cancel`); } catch { /* ignore */ }
  }

  const filename = scriptName.split('/').pop() ?? scriptName;

  const HANDLE_PX = 6;
  const edge = (cursor: string, style: React.CSSProperties, e: ResizeEdge) => (
    <div
      onMouseDown={onResizeMouseDown(e)}
      style={{ position: 'absolute', cursor, zIndex: 10, ...style }}
    />
  );

  return (
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        zIndex: 2000,
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 8px 48px rgba(0,0,0,0.7)',
        border: '1px solid rgba(255,255,255,0.12)',
        display: 'flex',
        flexDirection: 'column',
        userSelect: resizeEdge.current ? 'none' : undefined,
      }}
    >
      {/* ── Resize handles ────────────────────────────────────────────────── */}
      {edge('ew-resize',  { left: 0,  top: HANDLE_PX, bottom: HANDLE_PX, width: HANDLE_PX }, 'w')}
      {edge('ew-resize',  { right: 0, top: HANDLE_PX, bottom: HANDLE_PX, width: HANDLE_PX }, 'e')}
      {edge('ns-resize',  { top: 0,   left: HANDLE_PX, right: HANDLE_PX, height: HANDLE_PX }, 'n')}
      {edge('ns-resize',  { bottom: 0, left: HANDLE_PX, right: HANDLE_PX, height: HANDLE_PX }, 's')}
      {edge('nwse-resize',{ left: 0,  top: 0,    width: HANDLE_PX, height: HANDLE_PX }, 'nw')}
      {edge('nesw-resize',{ right: 0, top: 0,    width: HANDLE_PX, height: HANDLE_PX }, 'ne')}
      {edge('nesw-resize',{ left: 0,  bottom: 0, width: HANDLE_PX, height: HANDLE_PX }, 'sw')}
      {edge('nwse-resize',{ right: 0, bottom: 0, width: HANDLE_PX, height: HANDLE_PX }, 'se')}

      {/* ── Title / drag bar ──────────────────────────────────────────────── */}
      <div
        onMouseDown={onTitleMouseDown}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px',
          background: '#0a1628',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          cursor: 'grab',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        <span style={{
          fontSize: 12, fontWeight: 700, color: 'rgba(226,232,240,0.85)',
          fontFamily: 'var(--font-ui)', flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          ▶ {filename}
        </span>
        <span style={{ fontSize: 10, color: 'rgba(226,232,240,0.25)', fontFamily: 'var(--font-mono)', marginRight: 6 }}>
          ⤡ drag to resize
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'transparent', border: 'none',
            color: 'rgba(226,232,240,0.45)', fontSize: 18,
            cursor: 'pointer', lineHeight: 1, padding: '0 2px',
          }}
          title="Close"
        >✕</button>
      </div>

      {/* ── Live log ──────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <LiveLog
          logs={logs}
          stats={stats}
          status={status}
          elapsedMs={elapsedMs}
          onStop={handleStop}
          isStopping={isStopping}
        />
      </div>
    </div>
  );
}
