import { useEffect, useRef, useState, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getToken } from '../lib/auth';

export type LogKind = 'info' | 'pass' | 'fail' | 'run' | 'warn';

export interface LogLine {
  ts: string;
  kind: LogKind;
  text: string;
}

export interface RunStats {
  total: number;
  passed: number;
  failed: number;
  running: number;
  skipped: number;
}

export type RunSocketStatus = 'idle' | 'connecting' | 'running' | 'complete' | 'error' | 'cancelled';

export interface UseRunSocketReturn {
  logs: LogLine[];
  stats: RunStats;
  status: RunSocketStatus;
  clearLogs: () => void;
  joinRun: (runId: string) => void;
  leaveRun: (runId: string) => void;
}

const SOCKET_URL = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.host}`
  : 'http://localhost:3000';

export function useRunSocket(): UseRunSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [stats, setStats] = useState<RunStats>({ total: 0, passed: 0, failed: 0, running: 0, skipped: 0 });
  const [status, setStatus] = useState<RunSocketStatus>('idle');

  // Connect once on mount
  useEffect(() => {
    const token = getToken();
    const socket = io(`${SOCKET_URL}/runs`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('run:start', ({ total }: { total: number; environment?: string }) => {
      setStatus('running');
      setStats({ total, passed: 0, failed: 0, running: total, skipped: 0 });
    });

    socket.on('run:log', (data: { kind: LogKind; text: string; ts: string }) => {
      setLogs((prev) => [
        ...prev,
        { ts: data.ts ?? new Date().toISOString(), kind: data.kind ?? 'info', text: data.text },
      ]);
    });

    socket.on('run:progress', ({
      testCaseId: _tcId, status: _tcStatus, passed, failed,
    }: {
      testCaseId: string;
      status: string;
      index?: number;
      total?: number;
      passed?: number;
      failed?: number;
    }) => {
      setStats((prev) => ({
        ...prev,
        passed: passed ?? prev.passed,
        failed: failed ?? prev.failed,
        running: Math.max(0, prev.running - 1),
      }));
    });

    socket.on('run:complete', ({
      passed, failed, skipped, duration: _dur,
    }: { passed: number; failed: number; skipped: number; duration: number }) => {
      setStatus('complete');
      setStats((prev) => ({ ...prev, passed, failed, skipped, running: 0 }));
    });

    socket.on('run:cancelled', () => {
      setStatus('cancelled');
      setStats((prev) => ({ ...prev, running: 0 }));
    });

    socket.on('run:error', (msg: string) => {
      setStatus('error');
      setLogs((prev) => [...prev, {
        ts: new Date().toISOString(), kind: 'fail', text: `Error: ${msg}`,
      }]);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const joinRun = useCallback((runId: string) => {
    if (socketRef.current) {
      socketRef.current.emit('joinRun', { runId });
    }
  }, []);

  const leaveRun = useCallback((runId: string) => {
    if (socketRef.current) {
      socketRef.current.emit('leaveRun', { runId });
    }
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
    setStats({ total: 0, passed: 0, failed: 0, running: 0, skipped: 0 });
    setStatus('idle');
  }, []);

  return { logs, stats, status, clearLogs, joinRun, leaveRun };
}
