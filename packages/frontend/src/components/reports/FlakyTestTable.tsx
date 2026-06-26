import type { FlakyTest } from '../../types';

interface FlakyTestTableProps {
  tests: FlakyTest[];
}

const DOT_COLOR: Record<string, string> = {
  PASSED: 'var(--pass)',
  FAILED: 'var(--fail)',
  SKIPPED: 'var(--text-dim)',
};

export default function FlakyTestTable({ tests }: FlakyTestTableProps) {
  if (tests.length === 0) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
        No flaky tests detected in the current window.
      </div>
    );
  }

  return (
    <div style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {['TC ID', 'Test Case', 'Last 10 Runs', 'Pass', 'Fail', 'Flakiness'].map((h) => (
              <th
                key={h}
                style={{
                  padding: '6px 10px',
                  textAlign: 'left',
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--text-dim)',
                  borderBottom: '1px solid var(--border)',
                  whiteSpace: 'nowrap',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tests.map((t) => {
            const total = t.passCount + t.failCount;
            const flakiness = total > 0 ? Math.round((t.failCount / total) * 100) : 0;
            return (
              <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td
                  style={{
                    padding: '8px 10px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--text-dim)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.tcId}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    color: 'var(--text)',
                    maxWidth: 200,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontWeight: 500,
                  }}
                >
                  {t.title}
                </td>
                {/* Dot pattern for last 10 runs */}
                <td style={{ padding: '8px 10px' }}>
                  <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                    {t.recentResults.slice(0, 10).map((r, i) => (
                      <span
                        key={i}
                        title={r}
                        style={{
                          display: 'inline-block',
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: DOT_COLOR[r] ?? 'var(--text-dim)',
                          flexShrink: 0,
                        }}
                      />
                    ))}
                    {/* Pad to 10 dots if fewer */}
                    {Array.from({ length: Math.max(0, 10 - t.recentResults.length) }).map((_, i) => (
                      <span
                        key={`pad-${i}`}
                        style={{
                          display: 'inline-block',
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: 'var(--border)',
                          flexShrink: 0,
                        }}
                      />
                    ))}
                  </div>
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    fontWeight: 700,
                    color: 'var(--pass)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.passCount}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    fontWeight: 700,
                    color: 'var(--fail)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.failCount}
                </td>
                <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Mini progress bar */}
                    <div
                      style={{
                        width: 60,
                        height: 6,
                        background: 'var(--surface2)',
                        borderRadius: 3,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${flakiness}%`,
                          background:
                            flakiness >= 50
                              ? 'var(--fail)'
                              : flakiness >= 25
                              ? 'var(--amber)'
                              : 'var(--skip)',
                          borderRadius: 3,
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color:
                          flakiness >= 50
                            ? 'var(--fail)'
                            : flakiness >= 25
                            ? 'var(--amber)'
                            : 'var(--skip)',
                      }}
                    >
                      {flakiness}%
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
