import nodemailer from 'nodemailer';
import type { ReportsAgentOutput } from '../agents/reportsAgent.js';

// ── Transporter factory ────────────────────────────────────────────────────

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'localhost',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface RunReportEmailPayload {
  recipients: string[];
  run: {
    id: string;
    name: string;
    environment: string;
    status: string;
    startedAt: Date | null;
    completedAt: Date | null;
  };
  results: Array<{
    status: string;
    duration: number | null;
    errorMessage: string | null;
    testCase: { tcId: string; title: string; type: string };
  }>;
  analysis: ReportsAgentOutput;
  projectName: string;
}

// ── HTML builder ───────────────────────────────────────────────────────────

function buildHtml(payload: RunReportEmailPayload): string {
  const { run, results, analysis, projectName } = payload;
  const passed = results.filter((r) => r.status === 'PASSED').length;
  const failed = results.filter((r) => r.status === 'FAILED').length;
  const total = results.length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  const duration =
    run.startedAt && run.completedAt
      ? Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
      : 0;

  const severityColor: Record<string, string> = {
    CRITICAL: '#DC2626',
    HIGH: '#F47B20',
    MEDIUM: '#FBBF24',
    LOW: '#2A9D8F',
  };

  const statusColor = (s: string) =>
    s === 'PASSED' ? '#2A9D8F' : s === 'FAILED' ? '#DC2626' : '#94A3B8';

  const resultRows = results
    .slice(0, 50)
    .map(
      (r) => `
      <tr>
        <td style="padding:8px 12px;border-top:1px solid #E2E8F0;color:#475569;font-size:12px;">
          ${escHtml(r.testCase.tcId)}
        </td>
        <td style="padding:8px 12px;border-top:1px solid #E2E8F0;color:#334155;font-size:12px;">
          ${escHtml(r.testCase.title)}
        </td>
        <td style="padding:8px 12px;border-top:1px solid #E2E8F0;">
          <span style="font-size:10px;font-weight:700;color:${statusColor(r.status)};">${r.status}</span>
        </td>
        <td style="padding:8px 12px;border-top:1px solid #E2E8F0;color:#6B7280;font-size:11px;font-family:monospace;">
          ${r.duration ? `${(r.duration / 1000).toFixed(1)}s` : '—'}
        </td>
        <td style="padding:8px 12px;border-top:1px solid #E2E8F0;color:#DC2626;font-size:11px;font-family:monospace;max-width:280px;overflow:hidden;">
          ${r.errorMessage ? escHtml(r.errorMessage.slice(0, 120)) : ''}
        </td>
      </tr>`,
    )
    .join('');

  const rootCauseItems = analysis.rootCauses
    .map((c) => `<li style="margin-bottom:6px;color:#475569;font-size:13px;">${escHtml(c)}</li>`)
    .join('');

  const recItems = analysis.recommendations
    .map((r) => `<li style="margin-bottom:6px;color:#475569;font-size:13px;">${escHtml(r)}</li>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F9FC;font-family:'Open Sans',Arial,sans-serif;">

<div style="max-width:700px;margin:0 auto;background:#FFFFFF;">

  <!-- Header -->
  <div style="background:#0A2A57;padding:24px 32px;">
    <div style="font-size:20px;font-weight:700;color:#FFFFFF;">QA Infinity — Run Report</div>
    <div style="font-size:12px;color:#94A3B8;margin-top:4px;">${escHtml(projectName)} · ${escHtml(run.environment)}</div>
  </div>

  <!-- Run name bar -->
  <div style="background:#0F2D4A;padding:12px 32px;display:flex;align-items:center;justify-content:space-between;">
    <span style="font-size:14px;color:#CBD5E1;font-weight:600;">${escHtml(run.name)}</span>
    <span style="font-size:11px;color:#94A3B8;font-family:monospace;">${run.completedAt ? new Date(run.completedAt).toLocaleString() : ''}</span>
  </div>

  <div style="padding:24px 32px;">

    <!-- Stat tiles -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="width:25%;padding:0 8px 0 0;">
          <div style="background:#F7F9FC;border:1px solid #E2E8F0;border-radius:8px;padding:16px;text-align:center;">
            <div style="font-size:26px;font-weight:800;color:#F47B20;">${total}</div>
            <div style="font-size:10px;color:#6B7280;text-transform:uppercase;margin-top:4px;letter-spacing:0.05em;">Total Tests</div>
          </div>
        </td>
        <td style="width:25%;padding:0 8px;">
          <div style="background:#F7F9FC;border:1px solid #E2E8F0;border-radius:8px;padding:16px;text-align:center;">
            <div style="font-size:26px;font-weight:800;color:#2A9D8F;">${passed}</div>
            <div style="font-size:10px;color:#6B7280;text-transform:uppercase;margin-top:4px;letter-spacing:0.05em;">Passed</div>
          </div>
        </td>
        <td style="width:25%;padding:0 8px;">
          <div style="background:#F7F9FC;border:1px solid #E2E8F0;border-radius:8px;padding:16px;text-align:center;">
            <div style="font-size:26px;font-weight:800;color:#DC2626;">${failed}</div>
            <div style="font-size:10px;color:#6B7280;text-transform:uppercase;margin-top:4px;letter-spacing:0.05em;">Failed</div>
          </div>
        </td>
        <td style="width:25%;padding:0 0 0 8px;">
          <div style="background:#F7F9FC;border:1px solid #E2E8F0;border-radius:8px;padding:16px;text-align:center;">
            <div style="font-size:26px;font-weight:800;color:#F47B20;">${passRate}%</div>
            <div style="font-size:10px;color:#6B7280;text-transform:uppercase;margin-top:4px;letter-spacing:0.05em;">Pass Rate</div>
          </div>
        </td>
      </tr>
    </table>

    <!-- AI Analysis -->
    <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-left:4px solid #2563AB;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:13px;font-weight:700;color:#0A2A57;">AI Failure Analysis</span>
        <span style="font-size:10px;font-weight:700;padding:2px 10px;border-radius:100px;background:${severityColor[analysis.severity]}22;color:${severityColor[analysis.severity]};">${analysis.severity}</span>
      </div>
      <p style="font-size:13px;color:#334155;line-height:1.7;margin:0 0 12px;">${escHtml(analysis.summary)}</p>
      ${
        analysis.rootCauses.length > 0
          ? `<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#475569;margin-bottom:6px;letter-spacing:0.05em;">Root Causes</div>
             <ul style="margin:0;padding-left:18px;">${rootCauseItems}</ul>`
          : ''
      }
      ${
        analysis.recommendations.length > 0
          ? `<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#475569;margin:12px 0 6px;letter-spacing:0.05em;">Recommendations</div>
             <ul style="margin:0;padding-left:18px;">${recItems}</ul>`
          : ''
      }
    </div>

    <!-- Test Results table -->
    <div style="font-size:14px;font-weight:700;color:#0A2A57;margin-bottom:12px;">Test Results ${total > 50 ? '(first 50)' : ''}</div>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#F1F5F9;">
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.05em;">TC ID</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.05em;">Title</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.05em;">Status</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.05em;">Duration</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.05em;">Error</th>
        </tr>
      </thead>
      <tbody>${resultRows}</tbody>
    </table>

    ${duration > 0 ? `<div style="margin-top:16px;font-size:11px;color:#94A3B8;text-align:right;font-family:monospace;">Total duration: ${duration}s</div>` : ''}
  </div>

  <!-- Footer -->
  <div style="background:#F1F5F9;padding:16px 32px;text-align:center;border-top:1px solid #E2E8F0;">
    <div style="font-size:11px;color:#94A3B8;">Sent by QA Infinity · Powered by 6D Technologies</div>
  </div>

</div>
</body>
</html>`;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function sendRunReport(payload: RunReportEmailPayload): Promise<void> {
  if (!process.env.SMTP_HOST) {
    console.warn('[emailService] SMTP_HOST not set — skipping email send');
    return;
  }

  const transporter = createTransporter();
  const subject = `[QA Infinity] ${payload.run.name} — ${payload.analysis.severity} · ${payload.run.status}`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? 'qa-infinity@6dtech.co.in',
    to: payload.recipients.join(', '),
    subject,
    html: buildHtml(payload),
  });

  console.log(`[emailService] Report email sent to ${payload.recipients.join(', ')}`);
}
