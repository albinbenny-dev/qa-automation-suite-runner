import { useEffect, useRef } from 'react';
import type { LogLine, RunStats, RunSocketStatus } from '../../hooks/useRunSocket';

interface LiveLogProps {
  logs: LogLine[];
  stats: RunStats;
  status: RunSocketStatus;
  elapsedMs: number;
  onStop: () => void;
  isStopping: boolean;
  onHeal?: () => void;
  isHealing?: boolean;
  healTriggered?: boolean;
}

const KIND_STYLE: Record<string, { color: string; prefix: string }> = {
  pass: { color: '#2A9D8F', prefix: '✓' },
  fail: { color: '#DC2626', prefix: '✗' },
  run:  { color: '#60a5fa', prefix: '→' },
  warn: { color: '#F59E0B', prefix: '⚡' },
  info: { color: 'rgba(226,232,240,0.6)', prefix: '▶' },
};

function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '--:--:--';
  }
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export default function LiveLog({ logs, stats, status, elapsedMs, onStop, isStopping, onHeal, isHealing, healTriggered }: LiveLogProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new log lines
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [logs.length]);

  const isRunning = status === 'running';
  const runningCount = stats.running;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#06224A',
      overflow: 'hidden',
    }}>
      {/* Accent stripe */}
      <div style={{ height: 3, background: 'linear-gradient(90deg, #2563AB, #06224A)', flexShrink: 0 }} />

      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}>
        {/* Blinking dot */}
        {isRunning && (
          <span style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#22d3ee',
            display: 'inline-block',
            flexShrink: 0,
            animation: 'blink 1s ease-in-out infinite',
          }} />
        )}
        {!isRunning && (
          <span style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: status === 'complete'
              ? (stats.failed > 0 ? '#DC2626' : '#2A9D8F')
              : 'rgba(255,255,255,0.2)',
            display: 'inline-block',
            flexShrink: 0,
          }} />
        )}

        <span style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'rgba(226,232,240,0.9)',
          fontFamily: 'var(--font-ui)',
          flex: 1,
        }}>
          Live Execution Log
        </span>

        {isRunning && runningCount > 0 && (
          <span style={{
            fontSize: 9,
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: 10,
            background: 'rgba(34,211,238,0.15)',
            border: '1px solid rgba(34,211,238,0.3)',
            color: '#22d3ee',
            fontFamily: 'var(--font-mono)',
          }}>
            {runningCount}/{stats.total} running
          </span>
        )}

        {status === 'complete' && (
          <span style={{
            fontSize: 9,
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: 10,
            background: stats.failed > 0 ? 'rgba(220,38,38,0.15)' : 'rgba(42,157,143,0.15)',
            border: `1px solid ${stats.failed > 0 ? 'rgba(220,38,38,0.3)' : 'rgba(42,157,143,0.3)'}`,
            color: stats.failed > 0 ? '#DC2626' : '#2A9D8F',
            fontFamily: 'var(--font-mono)',
          }}>
            {stats.failed > 0 ? `${stats.failed} FAILED` : 'PASSED'}
          </span>
        )}
      </div>

      {/* Log body */}
      <div
        ref={bodyRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 0',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          lineHeight: '18px',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,255,255,0.15) transparent',
        }}
      >
        {logs.length === 0 ? (
          <div style={{
            padding: '40px 16px',
            textAlign: 'center',
            color: 'rgba(226,232,240,0.2)',
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>▶</div>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-ui)' }}>
              Waiting for run to start…
            </div>
          </div>
        ) : (
          logs.map((line, i) => {
            const style = KIND_STYLE[line.kind] ?? KIND_STYLE['info'];
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 0,
                  padding: '1px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                }}
              >
                <span style={{
                  minWidth: 68,
                  padding: '0 10px',
                  color: 'rgba(226,232,240,0.3)',
                  fontSize: 10,
                  flexShrink: 0,
                  paddingTop: 1,
                }}>
                  {formatTime(line.ts)}
                </span>
                <span style={{
                  width: 16,
                  flexShrink: 0,
                  color: style.color,
                  fontWeight: 700,
                }}>
                  {style.prefix}
                </span>
                <span style={{
                  flex: 1,
                  color: style.color,
                  wordBreak: 'break-all',
                  paddingRight: 10,
                  fontWeight: line.kind === 'fail' ? 600 : 400,
                }}>
                  {line.text}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Stats row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4,1fr)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}>
        {[
          { label: 'Passed',  value: stats.passed,  color: '#2A9D8F' },
          { label: 'Failed',  value: stats.failed,  color: '#DC2626' },
          { label: 'Running', value: stats.running, color: '#60a5fa' },
          { label: 'Elapsed', value: formatElapsed(elapsedMs), color: 'rgba(226,232,240,0.5)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            padding: '8px 10px',
            textAlign: 'center',
            borderRight: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{ fontSize: 15, fontWeight: 800, color, fontFamily: 'var(--font-mono)' }}>
              {value}
            </div>
            <div style={{ fontSize: 9, color: 'rgba(226,232,240,0.3)', fontFamily: 'var(--font-ui)', marginTop: 1, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Stop / Clear button */}
      <div style={{ padding: '10px 14px', flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {isRunning ? (
          <button
            onClick={onStop}
            disabled={isStopping}
            style={{
              width: '100%',
              padding: '8px',
              background: 'transparent',
              border: '1px solid rgba(220,38,38,0.5)',
              borderRadius: 6,
              color: '#DC2626',
              fontSize: 12,
              fontWeight: 700,
              cursor: isStopping ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-ui)',
              opacity: isStopping ? 0.6 : 1,
              transition: 'all 0.15s',
            }}
          >
            {isStopping ? '■ Stopping…' : '■ Stop Run'}
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{
              textAlign: 'center',
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              color: status === 'complete'
                ? (stats.failed > 0 ? 'rgba(220,38,38,0.6)' : 'rgba(42,157,143,0.6)')
                : 'rgba(226,232,240,0.2)',
              padding: '2px 0',
            }}>
              {status === 'complete'
                ? `Run complete · ${stats.passed} passed · ${stats.failed} failed`
                : status === 'error'
                ? 'Run ended with an error'
                : 'No run in progress'}
            </div>
            {status === 'complete' && stats.failed > 0 && onHeal && (
              <button
                onClick={onHeal}
                disabled={healTriggered || isHealing}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: healTriggered
                    ? 'rgba(245,158,11,0.08)'
                    : 'transparent',
                  border: `1px solid ${healTriggered ? 'rgba(245,158,11,0.35)' : 'rgba(245,158,11,0.55)'}`,
                  borderRadius: 6,
                  color: healTriggered ? 'rgba(245,158,11,0.55)' : '#F59E0B',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: (healTriggered || isHealing) ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-ui)',
                  opacity: (healTriggered || isHealing) ? 0.75 : 1,
                  transition: 'all 0.15s',
                }}
              >
                {isHealing
                  ? '⚡ Analysing failures…'
                  : healTriggered
                  ? `⚡ Heal queued for ${stats.failed} test${stats.failed !== 1 ? 's' : ''}`
                  : `⚡ Heal ${stats.failed} Failed Test${stats.failed !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
