import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import XLSXStyle from 'xlsx-js-style';
import AdmZip from 'adm-zip';
import fs from 'fs';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import {
  generateReport,
  getProjectStats,
  getRunTrend,
  getAgentStatuses,
  getTopSuites,
  getProjectTokenUsage,
  getEmailConfig,
  saveEmailConfig,
} from '../services/reportService.js';

// ── Zod schemas ────────────────────────────────────────────────────────────

const EmailConfigSchema = z.object({
  recipients: z.array(z.string().email()),
  triggerEvents: z.array(z.enum(['on_failure', 'on_completion', 'on_schedule'])),
});

// ── Router setup ───────────────────────────────────────────────────────────

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── GET /dashboard ─────────────────────────────────────────────────────────

router.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = parseInt(req.query['days'] as string || '7', 10);
    const [stats, trend, recentRunsData, agentStatuses, topSuites, projectTokens] = await Promise.all([
      getProjectStats(req.project.id),
      getRunTrend(req.project.id, days),
      prisma.run.findMany({
        where: { projectId: req.project.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          results: { select: { status: true } },
          _count: { select: { results: true } },
        },
      }),
      getAgentStatuses(req.project.id),
      getTopSuites(req.project.id),
      getProjectTokenUsage(req.project.id),
    ]);
    res.json({ stats, trend, recentRuns: recentRunsData, agentStatuses, topSuites, projectTokens });
  } catch (err) { next(err); }
});

// ── GET /runs ──────────────────────────────────────────────────────────────

router.get('/runs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query['page'] as string || '1', 10));
    const limit = Math.min(50, parseInt(req.query['limit'] as string || '20', 10));
    const skip = (page - 1) * limit;

    const [runs, total] = await Promise.all([
      prisma.run.findMany({
        where: { projectId: req.project.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          results: { select: { status: true } },
          _count: { select: { results: true } },
          report: { select: { id: true, summary: true, aiAnalysis: true } },
        },
      }),
      prisma.run.count({ where: { projectId: req.project.id } }),
    ]);

    res.json({ runs, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

// ── GET /runs/:runId ───────────────────────────────────────────────────────

router.get('/runs/:runId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.run.findFirst({
      where: { id: req.params['runId'], projectId: req.project.id },
      include: {
        results: {
          include: {
            testCase: { select: { id: true, tcId: true, title: true, type: true, useCaseTag: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        report: true,
      },
    });
    if (!run) { res.status(404).json({ error: 'Run not found' }); return; }

    // Auto-generate report if run is complete and no report yet
    if (
      (run.status === 'PASSED' || run.status === 'FAILED') &&
      !run.report
    ) {
      void generateReport(run.id).catch((err) =>
        console.error('[reports] Auto-generate report failed:', err),
      );
    }

    res.json({ run });
  } catch (err) { next(err); }
});

// ── POST /runs/:runId/generate ─────────────────────────────────────────────

router.post('/runs/:runId/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.run.findFirst({
      where: { id: req.params['runId'], projectId: req.project.id },
      select: { id: true, status: true },
    });
    if (!run) { res.status(404).json({ error: 'Run not found' }); return; }
    if (run.status === 'RUNNING' || run.status === 'PENDING') {
      res.status(400).json({ error: 'Cannot generate report for an in-progress run' });
      return;
    }
    await generateReport(run.id);
    const report = await prisma.report.findUnique({ where: { runId: run.id } });
    res.json({ report });
  } catch (err) { next(err); }
});

// ── GET /runs/:runId/export ────────────────────────────────────────────────
// Produces a formatted two-sheet workbook matching the reference format:
//   Sheet 1 "Dashboard"  — colour-coded execution summary + TC breakdown table
//   Sheet 2 "Test Cases" — full per-TC detail (steps, actual result, script ref …)

router.get('/runs/:runId/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.run.findFirst({
      where: { id: req.params['runId'], projectId: req.project.id },
      include: {
        results: {
          include: {
            testCase: {
              select: {
                id: true, tcId: true, title: true, description: true,
                steps: true, expectedResult: true, type: true,
                useCaseTag: true, priority: true, createdAt: true,
              },
            },
            script: { select: { filename: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        project: { select: { name: true } },
      },
    });
    if (!run) { res.status(404).json({ error: 'Run not found' }); return; }

    // ── Stats ────────────────────────────────────────────────────────────────
    const results = run.results;
    const total   = results.length;
    const passed  = results.filter((r) => r.status === 'PASSED').length;
    const failed  = results.filter((r) => r.status === 'FAILED').length;
    const flaky   = results.filter((r) => r.status === 'FLAKY').length;
    const notRun  = results.filter(
      (r) => r.status === 'SKIPPED' || r.status === 'PENDING' || r.status === 'CANCELLED',
    ).length;
    const passRate = total > 0 ? `${((passed / total) * 100).toFixed(1)}%` : '0.0%';

    const useCaseTags = [...new Set(results.map((r) => r.testCase.useCaseTag).filter(Boolean))];
    const featureLabel = useCaseTags.length === 1
      ? useCaseTags[0]!
      : useCaseTags.length > 1
        ? useCaseTags.slice(0, 3).join(', ')
        : run.name;

    const runDateStr = (run.startedAt ?? run.createdAt).toLocaleString('en-GB', {
      day: 'numeric', month: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });

    // ── Style helpers (xlsx-js-style uses rgb without 'FF' alpha prefix for fill) ──
    // fills: { fgColor: { rgb: '1F4E79' } }   fonts: { color: { rgb: 'FFFFFF' } }
    const bgSolid = (rgb: string) => ({ fill: { fgColor: { rgb } } });
    const fontWhiteBold = { font: { color: { rgb: 'FFFFFF' }, bold: true } };
    const fontBold      = { font: { bold: true } };
    const alignCtr      = { alignment: { horizontal: 'center', vertical: 'center' } };
    const alignLeft     = { alignment: { horizontal: 'left', vertical: 'center' } };
    const alignWrap     = { alignment: { horizontal: 'left', vertical: 'top', wrapText: true } };
    const alignHdrWrap  = { alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };

    type CellStyle = {
      fill?: { fgColor: { rgb: string } };
      font?: { color?: { rgb: string }; bold?: boolean; sz?: number };
      alignment?: { horizontal?: string; vertical?: string; wrapText?: boolean };
    };

    function cell(
      value: string | number,
      style: CellStyle = {},
    ): { v: string | number; t: string; s: CellStyle } {
      return { v: value, t: typeof value === 'number' ? 'n' : 's', s: style };
    }

    // ── Colour constants (6-hex, no alpha) ───────────────────────────────────
    const COL = {
      navyDark:  '1F4E79',
      navyMid:   '2E75B6',
      steelBlue: '4472C4',
      lightBlue: 'D6E4F0',
      white:     'FFFFFF',
      green:     '00B050',
      orange:    'FF8C00',
      red:       'FF0000',
      yellow:    'FFD966',
      grey:      'D9D9D9',
    };

    // ════════════════════════════════════════════════════════════════════════
    // SHEET 1: Dashboard
    // ════════════════════════════════════════════════════════════════════════
    type WsCell = { v: string | number; t: string; s: CellStyle };
    const ws1: Record<string, WsCell | object> = {};

    // Helper: write to a cell address
    function w1(addr: string, value: string | number, style: CellStyle) {
      ws1[addr] = cell(value, style);
    }

    // Merge helper (stored in !merges array)
    const merges1: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
    function merge1(r1: number, c1: number, r2: number, c2: number) {
      merges1.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
    }

    // Row 1 — Title (A1:F1)
    const titleStyle: CellStyle = {
      ...bgSolid(COL.navyDark),
      ...fontWhiteBold,
      ...alignCtr,
      font: { color: { rgb: COL.white }, bold: true, sz: 14 },
    };
    w1('A1', `EXECUTION DASHBOARD — ${featureLabel.toUpperCase()}`, titleStyle);
    merge1(0, 0, 0, 5);

    // Row 2 — spacer (empty)

    // Rows 3-5 — metadata
    const metaRows: [string, string][] = [
      ['Run ID',   run.id],
      ['Run Date', runDateStr],
      ['Feature',  featureLabel],
    ];
    metaRows.forEach(([label, value], i) => {
      const r = 2 + i; // 0-indexed row
      w1(`A${r + 1}`, label,  { ...bgSolid(COL.lightBlue), ...fontBold, ...alignLeft });
      w1(`C${r + 1}`, value,  { ...bgSolid(COL.white),    ...alignLeft });
      merge1(r, 0, r, 1);
      merge1(r, 2, r, 5);
    });

    // Row 7 — SUMMARY heading (A7:F7)
    w1('A7', 'SUMMARY', { ...bgSolid(COL.navyMid), ...fontWhiteBold, ...alignLeft });
    merge1(6, 0, 6, 5);

    // Row 8 — stat headers
    const statHdrs = ['TOTAL', 'PASSED', 'FLAKY', 'FAILED', 'NOT RUN', 'PASS RATE'];
    statHdrs.forEach((h, idx) => {
      const addr = `${String.fromCharCode(65 + idx)}8`;
      w1(addr, h, { ...bgSolid(COL.steelBlue), ...fontWhiteBold, ...alignCtr });
    });

    // Row 9 — stat values (colour-coded)
    const statData: [number | string, string][] = [
      [total,    COL.grey],
      [passed,   COL.green],
      [flaky,    COL.orange],
      [failed,   COL.red],
      [notRun,   COL.yellow],
      [passRate, passed === total && total > 0 ? COL.green : failed > 0 ? COL.red : COL.orange],
    ];
    statData.forEach(([val, color], idx) => {
      const addr = `${String.fromCharCode(65 + idx)}9`;
      w1(addr, val, { ...bgSolid(color), ...fontBold, ...alignCtr });
    });

    // Row 11 — breakdown heading (A11:F11)
    w1('A11', 'TEST CASE BREAKDOWN', { ...bgSolid(COL.navyMid), ...fontWhiteBold, ...alignLeft });
    merge1(10, 0, 10, 5);

    // Row 12 — breakdown headers
    const bdHdrs = ['#', 'Test Case ID', 'Title', 'Priority', 'Type', 'Status'];
    bdHdrs.forEach((h, idx) => {
      const addr = `${String.fromCharCode(65 + idx)}12`;
      w1(addr, h, { ...bgSolid(COL.navyDark), ...fontWhiteBold, ...alignCtr });
    });

    // Rows 13+ — TC data
    const lastDataRow1 = 12 + results.length;
    results.forEach((r, idx) => {
      const rowNum = 13 + idx;
      const rowFill = idx % 2 === 0 ? COL.lightBlue : COL.white;
      const rowVals: Array<string | number> = [
        idx + 1,
        r.testCase.tcId,
        r.testCase.title,
        r.testCase.priority ?? 'Medium',
        r.testCase.type,
        r.status,
      ];
      rowVals.forEach((val, ci) => {
        const addr = `${String.fromCharCode(65 + ci)}${rowNum}`;
        const baseStyle: CellStyle = { ...bgSolid(rowFill), ...alignLeft };
        w1(addr, val, ci === 5 ? { ...baseStyle, ...fontBold } : baseStyle);
      });
    });

    // Sheet dimensions
    const maxRow1 = Math.max(15, lastDataRow1);
    ws1['!ref'] = `A1:F${maxRow1}`;
    ws1['!merges'] = merges1;
    ws1['!cols'] = [
      { wch: 4 }, { wch: 20 }, { wch: 46 }, { wch: 12 }, { wch: 15 }, { wch: 12 },
    ];
    ws1['!rows'] = [
      { hpt: 36 }, { hpt: 8 },
      { hpt: 22 }, { hpt: 22 }, { hpt: 22 },
      { hpt: 8 }, { hpt: 22 }, { hpt: 20 }, { hpt: 32 }, { hpt: 8 },
      { hpt: 22 }, { hpt: 20 },
      ...results.map(() => ({ hpt: 18 })),
    ];

    // ════════════════════════════════════════════════════════════════════════
    // SHEET 2: Test Cases
    // ════════════════════════════════════════════════════════════════════════
    const ws2: Record<string, WsCell | object> = {};

    function w2(addr: string, value: string | number, style: CellStyle) {
      ws2[addr] = cell(value, style);
    }

    // Header row
    const tcHeaders = [
      'Test Case ID', 'Module / Feature', 'Test Case Title', 'Objective',
      'Test Steps', 'Test Data', 'Expected Result', 'Actual Result',
      'Status', 'Automation Script Ref', 'Priority', 'Test Type', 'Created Date',
    ];
    tcHeaders.forEach((h, idx) => {
      const addr = `${xlsxCol(idx + 1)}1`;
      w2(addr, h, { ...bgSolid(COL.navyDark), ...fontWhiteBold, ...alignHdrWrap });
    });

    // Data rows
    const tcRowHeights: { hpt: number }[] = [{ hpt: 26 }];
    results.forEach((r, idx) => {
      const rowNum  = 2 + idx;
      const rowFill = idx % 2 === 0 ? COL.lightBlue : COL.white;

      let stepsText = '';
      try {
        const arr: string[] = JSON.parse(r.testCase.steps ?? '[]');
        stepsText = arr.map((s, si) => `${si + 1}. ${s}`).join('\n');
      } catch {
        stepsText = r.testCase.steps ?? '';
      }

      let actualResult = '';
      if (r.status === 'PASSED') {
        actualResult = `Test passed successfully.${r.duration ? ` Duration: ${r.duration}ms.` : ''}`;
      } else if (r.status === 'FAILED') {
        actualResult = r.errorMessage
          ? `Test failed. ${r.errorMessage}${r.duration ? ` Duration: ${r.duration}ms.` : ''}`
          : `Test failed.${r.duration ? ` Duration: ${r.duration}ms.` : ''}`;
      } else {
        actualResult = r.status;
      }

      const rowData: Array<string | number> = [
        r.testCase.tcId,
        r.testCase.useCaseTag ?? run.project.name,
        r.testCase.title,
        r.testCase.description ?? '',
        stepsText,
        '',  // Test Data — not stored; left blank
        r.testCase.expectedResult,
        actualResult,
        r.status,
        r.script?.filename ?? '',
        r.testCase.priority ?? 'Medium',
        r.testCase.type,
        r.testCase.createdAt.toISOString().split('T')[0],
      ];

      rowData.forEach((val, ci) => {
        const addr = `${xlsxCol(ci + 1)}${rowNum}`;
        const baseStyle: CellStyle = { ...bgSolid(rowFill), ...alignWrap };
        // Status (col I = index 8) and Priority (col K = index 10) are bold
        w2(addr, val, (ci === 8 || ci === 10) ? { ...baseStyle, ...fontBold } : baseStyle);
      });

      const stepCount = stepsText.split('\n').length;
      tcRowHeights.push({ hpt: Math.max(42, Math.min(150, stepCount * 15 + 10)) });
    });

    ws2['!ref'] = `A1:M${1 + results.length}`;
    ws2['!cols'] = [
      { wch: 15 }, { wch: 19 }, { wch: 42 }, { wch: 55 }, { wch: 45 },
      { wch: 38 }, { wch: 55 }, { wch: 55 }, { wch: 10 }, { wch: 40 },
      { wch: 11 }, { wch: 13 }, { wch: 15 },
    ];
    ws2['!rows'] = tcRowHeights;

    // ── Build workbook and send ───────────────────────────────────────────────
    const wb = XLSXStyle.utils.book_new();
    XLSXStyle.utils.book_append_sheet(wb, ws1 as XLSXStyle.WorkSheet, 'Dashboard');
    XLSXStyle.utils.book_append_sheet(wb, ws2 as XLSXStyle.WorkSheet, 'Test Cases');

    const buf = XLSXStyle.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const runLabel = run.runSeq ? `RUN-${String(run.runSeq).padStart(4, '0')}` : run.id.slice(0, 8).toUpperCase();
    const safeFeature = featureLabel.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const filename = `${safeFeature}_${runLabel}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) { next(err); }
});

/** Convert 1-based column index to Excel column letter(s): 1→A, 26→Z, 27→AA … */
function xlsxCol(n: number): string {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ── GET /runs/:runId/results/:resultId/screenshot ──────────────────────────

router.get('/runs/:runId/results/:resultId/screenshot', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await prisma.runResult.findFirst({
      where: {
        id: req.params['resultId'],
        runId: req.params['runId'],
        run: { projectId: req.project.id },
      },
      select: {
        screenshotPath: true,
        run: { select: { runSeq: true } },
        testCase: { select: { tcId: true } },
      },
    });
    if (!result?.screenshotPath) { res.status(404).json({ error: 'Screenshot not found' }); return; }
    if (!fs.existsSync(result.screenshotPath)) { res.status(404).json({ error: 'Screenshot file missing on disk' }); return; }
    const runLabelSc = `RUN-${String(result.run.runSeq).padStart(4, '0')}`;
    const isJpeg = /\.(jpg|jpeg)$/i.test(result.screenshotPath);
    const imgMime = isJpeg ? 'image/jpeg' : 'image/png';
    const imgExt = isJpeg ? 'jpg' : 'png';
    res.setHeader('Content-Type', imgMime);
    res.setHeader('Content-Disposition', `attachment; filename="screenshot-${runLabelSc}_${result.testCase.tcId}.${imgExt}"`);
    fs.createReadStream(result.screenshotPath).pipe(res);
  } catch (err) { next(err); }
});


// ── GET /runs/:runId/results/:resultId/video ───────────────────────────────

router.get('/runs/:runId/results/:resultId/video', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await prisma.runResult.findFirst({
      where: {
        id: req.params['resultId'],
        runId: req.params['runId'],
        run: { projectId: req.project.id },
      },
      select: {
        videoPath: true,
        run: { select: { runSeq: true } },
        testCase: { select: { tcId: true } },
      },
    });
    if (!result?.videoPath) { res.status(404).json({ error: 'Video not found' }); return; }

    const runLabelVid = `RUN-${String(result.run.runSeq).padStart(4, '0')}`;

    // Multiple sessions — bundle into a ZIP
    if (result.videoPath.startsWith('[')) {
      const paths = JSON.parse(result.videoPath) as string[];
      const zip = new AdmZip();
      for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        if (fs.existsSync(p)) {
          const ext = p.toLowerCase().endsWith('.mp4') ? 'mp4' : 'webm';
          zip.addFile(`session-${i + 1}.${ext}`, fs.readFileSync(p));
        }
      }
      const buf = zip.toBuffer();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="videos-${runLabelVid}_${result.testCase.tcId}.zip"`);
      res.send(buf);
      return;
    }

    // Single session — wait for remux to complete if still in progress
    const vpDl = result.videoPath;
    const vpDlFast = vpDl.replace('.mp4', '_fast.mp4');
    const dlDeadline = Date.now() + 30_000;
    while (true) {
      if (fs.existsSync(vpDl) && fs.statSync(vpDl).size > 0 && !fs.existsSync(vpDlFast)) break;
      if (Date.now() > dlDeadline) { res.status(404).json({ error: 'Video file missing on disk' }); return; }
      await new Promise(r => setTimeout(r, 500));
    }
    if (!fs.existsSync(result.videoPath)) { res.status(404).json({ error: 'Video file missing on disk' }); return; }
    const videoExt = result.videoPath.toLowerCase().endsWith('.mp4') ? 'mp4' : 'webm';
    const videoMime = videoExt === 'mp4' ? 'video/mp4' : 'video/webm';
    res.setHeader('Content-Type', videoMime);
    res.setHeader('Content-Disposition', `attachment; filename="video-${runLabelVid}_${result.testCase.tcId}.${videoExt}"`);
    fs.createReadStream(result.videoPath).pipe(res);
  } catch (err) { next(err); }
});

// ── GET /runs/:runId/results/:resultId/video/stream — Range-aware for inline <video> ──

router.get('/runs/:runId/results/:resultId/video/stream', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await prisma.runResult.findFirst({
      where: {
        id: req.params['resultId'],
        runId: req.params['runId'],
        run: { projectId: req.project.id },
      },
      select: { videoPath: true },
    });
    if (!result?.videoPath || result.videoPath.startsWith('[')) {
      res.status(404).json({ error: 'Single video not available for streaming' }); return;
    }
    const vp = result.videoPath;
    const vpFast = vp.replace('.mp4', '_fast.mp4');
    // Poll up to 30s: wait for raw file to exist AND remux temp file to be gone
    const deadline = Date.now() + 30_000;
    while (true) {
      const exists = fs.existsSync(vp) && fs.statSync(vp).size > 0;
      const remuxing = fs.existsSync(vpFast); // remux in progress while _fast.mp4 exists
      if (exists && !remuxing) break;
      if (Date.now() > deadline) { res.status(404).json({ error: 'Video file not ready yet — try again in a moment' }); return; }
      await new Promise(r => setTimeout(r, 500));
    }

    const stat = fs.statSync(vp);
    const total = stat.size;
    const mime = vp.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/webm';
    const range = req.headers.range;

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : Math.min(start + 10 * 1024 * 1024 - 1, total - 1);
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': mime,
      });
      fs.createReadStream(vp, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(vp).pipe(res);
    }
  } catch (err) { next(err); }
});

// ── GET /runs/:runId/results/:resultId/rf-report ───────────────────────────

router.get('/runs/:runId/results/:resultId/rf-report', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await prisma.runResult.findFirst({
      where: {
        id: req.params['resultId'],
        runId: req.params['runId'],
        run: { projectId: req.project.id },
      },
      select: {
        rfReportPath: true,
        run: { select: { runSeq: true } },
        testCase: { select: { tcId: true } },
      },
    });
    if (!result?.rfReportPath) { res.status(404).json({ error: 'RF report not found' }); return; }
    if (!fs.existsSync(result.rfReportPath)) { res.status(404).json({ error: 'RF report file missing on disk' }); return; }
    const runLabel = `RUN-${String(result.run.runSeq).padStart(4, '0')}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rf-report-${runLabel}_${result.testCase.tcId}.html"`);
    fs.createReadStream(result.rfReportPath).pipe(res);
  } catch (err) { next(err); }
});

// ── GET /runs/:runId/results/:resultId/rf-log ──────────────────────────────

router.get('/runs/:runId/results/:resultId/rf-log', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await prisma.runResult.findFirst({
      where: {
        id: req.params['resultId'],
        runId: req.params['runId'],
        run: { projectId: req.project.id },
      },
      select: {
        rfLogPath: true,
        run: { select: { runSeq: true } },
        testCase: { select: { tcId: true } },
      },
    });
    if (!result?.rfLogPath) { res.status(404).json({ error: 'RF log not found' }); return; }
    if (!fs.existsSync(result.rfLogPath)) { res.status(404).json({ error: 'RF log file missing on disk' }); return; }
    const runLabel = `RUN-${String(result.run.runSeq).padStart(4, '0')}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rf-log-${runLabel}_${result.testCase.tcId}.html"`);
    fs.createReadStream(result.rfLogPath).pipe(res);
  } catch (err) { next(err); }
});

// ── GET /email-config ──────────────────────────────────────────────────────

router.get('/email-config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getEmailConfig(req.project.id);
    res.json({ config });
  } catch (err) { next(err); }
});

// ── PUT /email-config ──────────────────────────────────────────────────────

router.put('/email-config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = EmailConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    await saveEmailConfig(req.project.id, parsed.data);
    res.json({ config: parsed.data });
  } catch (err) { next(err); }
});

// ── GET /stats ─────────────────────────────────────────────────────────────

router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await getProjectStats(req.project.id);
    res.json({ stats });
  } catch (err) { next(err); }
});

// ── GET /trend ─────────────────────────────────────────────────────────────

router.get('/trend', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = parseInt(req.query['days'] as string || '30', 10);
    const trend = await getRunTrend(req.project.id, days);
    res.json({ trend });
  } catch (err) { next(err); }
});

export default router;
