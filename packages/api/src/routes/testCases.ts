import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import * as xlsx from 'xlsx';
import XLSXStyle from 'xlsx-js-style';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { saveScript, deleteScript } from '../services/scriptFileService.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

const SCRIPTS_ROOT = process.env.SCRIPTS_ROOT ?? '/scripts';

/** Move a script inside TestCases/ to a new use-case folder on disk and update its DB filename. */
async function syncScriptToUseCase(
  slug: string,
  script: { id: string; filename: string },
  newUseCaseTag: string | null,
): Promise<void> {
  const parts = script.filename.split('/');
  if (parts.length < 3 || !/^TestCases$/i.test(parts[0])) return; // not a TestCases script
  const basename = parts.slice(2).join('/'); // preserve any sub-path within the use-case folder
  const newFolder = newUseCaseTag ?? 'Uncategorised';
  const newFilename = `TestCases/${newFolder}/${basename}`;
  if (newFilename === script.filename) return;
  const absFrom = path.join(SCRIPTS_ROOT, slug, script.filename);
  const absTo   = path.join(SCRIPTS_ROOT, slug, newFilename);
  if (fs.existsSync(absFrom)) {
    fs.mkdirSync(path.dirname(absTo), { recursive: true });
    try { fs.renameSync(absFrom, absTo); } catch { /* tolerate race / missing file */ }
  }
  await prisma.script.update({ where: { id: script.id }, data: { filename: newFilename } });
}

// Multer for seed Excel upload (memory only — never touches disk)
const seedUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') cb(null, true);
    else cb(new Error('Only .xlsx / .xls files are accepted'));
  },
});

// ── Zod schemas ────────────────────────────────────────────────────────────

const SeedTCSchema = z.object({
  title: z.string().min(1),
  steps: z.array(z.string()).default([]),
  expectedResult: z.string().default(''),
  useCaseTag: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  type: z.enum(['UI', 'API', 'SIT']).optional(),
  preConditions: z.string().optional(),
  testData: z.string().optional(),
  notes: z.string().optional(),
});

const SaveTestCasesSchema = z.object({
  testCases: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().optional().default(''),
      steps: z.array(z.string()).min(1),
      expectedResult: z.string().min(1),
      type: z.enum(['UI', 'API', 'SIT']),
      tags: z.array(z.string()).default([]),
      useCaseTag: z.string().optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
      sourceRef: z.string().optional(),
      generationHints: z.string().optional(),
      status: z.enum(['DRAFT', 'APPROVED', 'DEPRECATED']).optional().default('DRAFT'),
    }),
  ).min(1),
});

const UpdateTestCaseSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  steps: z.array(z.string()).optional(),
  expectedResult: z.string().optional(),
  type: z.enum(['UI', 'API', 'SIT']).optional(),
  tags: z.array(z.string()).optional(),
  useCaseTag: z.string().optional().nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  status: z.enum(['DRAFT', 'APPROVED', 'DEPRECATED']).optional(),
  sourceRef: z.string().optional(),
  prerequisiteTcId: z.string().nullable().optional(),
});

const BulkApproveSchema = z.object({
  ids: z.array(z.string().cuid()).min(1),
});

const BulkUpdateUseCaseSchema = z.object({
  testCaseIds: z.array(z.string().cuid()).min(1),
  targetUseCaseTag: z.string().min(1).max(120),
});

const BulkDeleteSchema = z.object({
  ids: z.array(z.string().cuid()).min(1),
});

const BulkAddTagSchema = z.object({
  testCaseIds: z.array(z.string().cuid()).min(1),
  tag: z.string().min(1).max(80),
});

// ── Helpers ────────────────────────────────────────────────────────────────

function parseTCFields(tc: Record<string, unknown>) {
  return {
    ...tc,
    steps: JSON.parse((tc['steps'] as string) || '[]'),
    tags: JSON.parse((tc['tags'] as string) || '[]'),
  };
}

// ── GET /use-cases ─────────────────────────────────────────────────────────

router.get('/use-cases', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = await prisma.testCase.findMany({
      where: { projectId: req.project.id, useCaseTag: { not: null } },
      select: { useCaseTag: true },
      distinct: ['useCaseTag'],
      orderBy: { useCaseTag: 'asc' },
    });

    const useCases = raw.map((r) => r.useCaseTag).filter(Boolean) as string[];
    res.json({ useCases });
  } catch (err) {
    next(err);
  }
});

// ── GET /export/excel ──────────────────────────────────────────────────────

router.get('/export/excel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { useCaseTag: ucFilter, ids: idsParam } = req.query as Record<string, string>;

    const where: Record<string, unknown> = { projectId: req.project.id };
    if (ucFilter) where['useCaseTag'] = ucFilter;
    if (idsParam) {
      const ids = idsParam.split(',').filter(Boolean);
      if (ids.length > 0) where['id'] = { in: ids };
    }

    const tcs = await prisma.testCase.findMany({
      where,
      orderBy: [{ useCaseTag: 'asc' }, { tcId: 'asc' }],
    });

    // ── Style helpers ────────────────────────────────────────────────────────
    const COL = {
      navyDark:  '1F4E79', navyMid: '2E75B6', steelBlue: '4472C4',
      lightBlue: 'D6E4F0', white: 'FFFFFF',   green: '00B050',
      orange:    'FF8C00', red: 'FF0000',      yellow: 'FFD966', grey: 'D9D9D9',
    };
    type CellStyle = {
      fill?: { fgColor: { rgb: string } };
      font?: { color?: { rgb: string }; bold?: boolean; sz?: number };
      alignment?: { horizontal?: string; vertical?: string; wrapText?: boolean };
    };
    function mkCell(v: string | number, s: CellStyle = {}) {
      return { v, t: typeof v === 'number' ? 'n' : 's', s };
    }
    const bgS  = (rgb: string) => ({ fill: { fgColor: { rgb } } });
    const fWB  = { font: { color: { rgb: COL.white }, bold: true } };
    const fB   = { font: { bold: true } };
    const aC   = { alignment: { horizontal: 'center', vertical: 'center' } };
    const aL   = { alignment: { horizontal: 'left',   vertical: 'center' } };
    const aWL  = { alignment: { horizontal: 'left',   vertical: 'top', wrapText: true } };
    const aWC  = { alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };

    const total      = tcs.length;
    const approved   = tcs.filter((t) => t.status === 'APPROVED').length;
    const draft      = tcs.filter((t) => t.status === 'DRAFT').length;
    const deprecated = tcs.filter((t) => t.status === 'DEPRECATED').length;
    const useCases   = [...new Set(tcs.map((t) => t.useCaseTag).filter(Boolean))];
    const exportDate = new Date().toLocaleString('en-GB', {
      day: 'numeric', month: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });

    // ════════════════════════════════════════════════════════════════════════
    // SHEET 1: Dashboard
    // ════════════════════════════════════════════════════════════════════════
    const ws1: Record<string, ReturnType<typeof mkCell> | object> = {};
    const m1: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
    function w1(addr: string, v: string | number, s: CellStyle) { ws1[addr] = mkCell(v, s); }
    function mg1(r1: number, c1: number, r2: number, c2: number) {
      m1.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
    }

    // Row 1 — title banner
    let exportTitle = `TEST CASE LIBRARY — ${req.project.name.toUpperCase()}`;
    if (ucFilter) exportTitle = `${req.project.name.toUpperCase()} · ${ucFilter.toUpperCase()}`;
    else if (idsParam) exportTitle = `${req.project.name.toUpperCase()} · SELECTED (${tcs.length} TCs)`;
    w1('A1', exportTitle,
      { ...bgS(COL.navyDark), font: { color: { rgb: COL.white }, bold: true, sz: 14 }, ...aC });
    mg1(0, 0, 0, 5);

    // Rows 3–5 — metadata
    const metaRows: [string, string][] = [
      ['Project',     req.project.name],
      ['Export Date', exportDate],
      ['Use Cases',   useCases.join(', ') || '(none)'],
    ];
    metaRows.forEach(([label, value], i) => {
      const r = 2 + i;
      w1(`A${r + 1}`, label, { ...bgS(COL.lightBlue), ...fB, ...aL });
      w1(`C${r + 1}`, value, { ...bgS(COL.white), ...aL });
      mg1(r, 0, r, 1); mg1(r, 2, r, 5);
    });

    // Row 7 — SUMMARY heading
    w1('A7', 'SUMMARY', { ...bgS(COL.navyMid), ...fWB, ...aL });
    mg1(6, 0, 6, 5);

    // Row 8 — stat headers
    ['TOTAL', 'APPROVED', 'DRAFT', 'DEPRECATED', 'USE CASES', ''].forEach((h, i) => {
      w1(`${String.fromCharCode(65 + i)}8`, h, { ...bgS(COL.steelBlue), ...fWB, ...aC });
    });

    // Row 9 — stat values
    ([
      [total, COL.grey], [approved, COL.green], [draft, COL.yellow],
      [deprecated, COL.orange], [useCases.length, COL.steelBlue], ['', COL.white],
    ] as Array<[number | string, string]>).forEach(([val, color], i) => {
      w1(`${String.fromCharCode(65 + i)}9`, val, { ...bgS(color), ...fB, ...aC });
    });

    // Row 11 — breakdown heading
    w1('A11', 'TEST CASE BREAKDOWN', { ...bgS(COL.navyMid), ...fWB, ...aL });
    mg1(10, 0, 10, 5);

    // Row 12 — column headers
    ['#', 'Test Case ID', 'Title', 'Priority', 'Type', 'Status'].forEach((h, i) => {
      w1(`${String.fromCharCode(65 + i)}12`, h, { ...bgS(COL.navyDark), ...fWB, ...aC });
    });

    // TC data rows
    tcs.forEach((tc, idx) => {
      const rn = 13 + idx;
      const fill = idx % 2 === 0 ? COL.lightBlue : COL.white;
      [idx + 1, tc.tcId, tc.title, tc.priority, tc.type, tc.status].forEach((v, ci) => {
        const addr = `${String.fromCharCode(65 + ci)}${rn}`;
        const st: CellStyle = { ...bgS(fill), ...(ci === 0 ? aC : aL) };
        w1(addr, v, ci === 5 ? { ...st, ...fB } : st);
      });
    });

    const maxRow1 = Math.max(15, 12 + tcs.length);
    ws1['!ref']    = `A1:F${maxRow1}`;
    ws1['!merges'] = m1;
    ws1['!cols']   = [{ wch: 4 }, { wch: 20 }, { wch: 46 }, { wch: 12 }, { wch: 15 }, { wch: 12 }];
    ws1['!rows']   = [
      { hpt: 36 }, { hpt: 8 },
      { hpt: 22 }, { hpt: 22 }, { hpt: 22 },
      { hpt: 8 }, { hpt: 22 }, { hpt: 20 }, { hpt: 32 }, { hpt: 8 },
      { hpt: 22 }, { hpt: 20 },
      ...tcs.map(() => ({ hpt: 18 })),
    ];

    // ════════════════════════════════════════════════════════════════════════
    // SHEET 2: Test Cases
    // ════════════════════════════════════════════════════════════════════════
    const ws2: Record<string, ReturnType<typeof mkCell> | object> = {};
    function w2(addr: string, v: string | number, s: CellStyle) { ws2[addr] = mkCell(v, s); }

    const tcHeaders = [
      'Test Case ID', 'Module / Feature', 'Test Case Title', 'Objective',
      'Test Steps', 'Test Data', 'Expected Result', 'Status',
      'Priority', 'Test Type', 'Created Date',
    ];
    tcHeaders.forEach((h, idx) => {
      w2(`${tcCol(idx + 1)}1`, h, { ...bgS(COL.navyDark), ...fWB, ...aWC });
    });

    const tcRowH: { hpt: number }[] = [{ hpt: 26 }];
    tcs.forEach((tc, idx) => {
      const rn   = 2 + idx;
      const fill = idx % 2 === 0 ? COL.lightBlue : COL.white;

      let stepsText = '';
      try {
        const arr: string[] = JSON.parse(tc.steps || '[]');
        stepsText = arr.map((s, si) => `${si + 1}. ${s}`).join('\n');
      } catch { stepsText = tc.steps; }

      const rowData: Array<string | number> = [
        tc.tcId, tc.useCaseTag ?? '', tc.title, tc.description ?? '',
        stepsText, '', tc.expectedResult,
        tc.status, tc.priority, tc.type,
        tc.createdAt.toISOString().split('T')[0],
      ];

      rowData.forEach((v, ci) => {
        const st: CellStyle = { ...bgS(fill), ...aWL };
        w2(`${tcCol(ci + 1)}${rn}`, v, (ci === 7 || ci === 8) ? { ...st, ...fB } : st);
      });

      tcRowH.push({ hpt: Math.max(42, Math.min(150, stepsText.split('\n').length * 15 + 10)) });
    });

    ws2['!ref']  = `A1:K${1 + tcs.length}`;
    ws2['!cols'] = [
      { wch: 15 }, { wch: 19 }, { wch: 42 }, { wch: 55 }, { wch: 45 },
      { wch: 38 }, { wch: 55 }, { wch: 10 }, { wch: 11 }, { wch: 13 }, { wch: 15 },
    ];
    ws2['!rows'] = tcRowH;

    const wb = XLSXStyle.utils.book_new();
    XLSXStyle.utils.book_append_sheet(wb, ws1 as XLSXStyle.WorkSheet, 'Dashboard');
    XLSXStyle.utils.book_append_sheet(wb, ws2 as XLSXStyle.WorkSheet, 'Test Cases');
    const buf = XLSXStyle.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    let filename = `${req.project.slug}-test-cases-${Date.now()}.xlsx`;
    if (ucFilter) filename = `${req.project.slug}-${ucFilter.replace(/\s+/g, '-')}-${Date.now()}.xlsx`;
    else if (idsParam) filename = `${req.project.slug}-selected-${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

/** Excel column index to letter(s): 1→A, 27→AA … (for the TC sheet export) */
function tcCol(n: number): string {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ── PATCH /reorder ────────────────────────────────────────────────────────

router.patch('/reorder', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderedIds } = req.body as { orderedIds: string[] };
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      res.status(400).json({ error: 'orderedIds must be a non-empty array' });
      return;
    }
    await prisma.$transaction(
      orderedIds.map((id, idx) =>
        prisma.testCase.updateMany({
          where: { id, projectId: req.project.id },
          data: { sortOrder: idx },
        })
      )
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /bulk-approve ─────────────────────────────────────────────────────

router.post('/bulk-approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = BulkApproveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }

    const result = await prisma.testCase.updateMany({
      where: { id: { in: parsed.data.ids }, projectId: req.project.id },
      data: { status: 'APPROVED' },
    });

    res.json({ updated: result.count });
  } catch (err) {
    next(err);
  }
});

// ── GET /stats ─────────────────────────────────────────────────────────────

router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.project.id;

    const [totalTCs, ucRaw, neverRunCount, runResultsRaw] = await Promise.all([
      prisma.testCase.count({ where: { projectId } }),
      prisma.testCase.findMany({
        where: { projectId, useCaseTag: { not: null } },
        select: { useCaseTag: true },
        distinct: ['useCaseTag'],
      }),
      prisma.testCase.count({ where: { projectId, runResults: { none: {} } } }),
      prisma.runResult.findMany({
        where: { testCase: { projectId } },
        select: { testCaseId: true, status: true },
        orderBy: { run: { createdAt: 'desc' } },
      }),
    ]);

    // First occurrence per testCaseId = most recent run result (ordered desc above)
    const latestByTc = new Map<string, string>();
    for (const rr of runResultsRaw) {
      if (!latestByTc.has(rr.testCaseId)) {
        latestByTc.set(rr.testCaseId, rr.status);
      }
    }

    let passedLast = 0;
    let failedLast = 0;
    for (const status of latestByTc.values()) {
      if (status === 'PASSED') passedLast++;
      else if (status === 'FAILED') failedLast++;
    }

    res.json({
      totalTCs,
      useCaseCount: ucRaw.length,
      passedLast,
      failedLast,
      neverRun: neverRunCount,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /bulk-update-usecase ──────────────────────────────────────────────

router.post('/bulk-update-usecase', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = BulkUpdateUseCaseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }

    const { testCaseIds, targetUseCaseTag } = parsed.data;

    // Move any TestCases/ scripts to the new use-case folder before updating the DB
    const scriptsToMove = await prisma.script.findMany({
      where: { projectId: req.project.id, testCaseId: { in: testCaseIds } },
      select: { id: true, filename: true },
    });
    for (const s of scriptsToMove) {
      await syncScriptToUseCase(req.project.slug, s, targetUseCaseTag).catch(() => {});
    }

    const result = await prisma.testCase.updateMany({
      where: { id: { in: testCaseIds }, projectId: req.project.id },
      data: { useCaseTag: targetUseCaseTag },
    });

    res.json({ updated: result.count });
  } catch (err) {
    next(err);
  }
});

// ── POST /bulk-delete ─────────────────────────────────────────────────────

router.post('/bulk-delete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = BulkDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }

    const scripts = await prisma.script.findMany({
      where: { testCaseId: { in: parsed.data.ids }, projectId: req.project.id },
      select: { id: true, filename: true },
    });

    if (scripts.length > 0) {
      await prisma.script.deleteMany({ where: { id: { in: scripts.map((s) => s.id) } } });
      for (const s of scripts) deleteScript(req.project.slug, s.filename);
    }

    const result = await prisma.testCase.deleteMany({
      where: { id: { in: parsed.data.ids }, projectId: req.project.id },
    });

    res.json({ deleted: result.count });
  } catch (err) {
    next(err);
  }
});

// ── POST /bulk-add-tag ────────────────────────────────────────────────────

router.post('/bulk-add-tag', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = BulkAddTagSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }

    const { testCaseIds, tag } = parsed.data;
    const tcs = await prisma.testCase.findMany({
      where: { id: { in: testCaseIds }, projectId: req.project.id },
      select: { id: true, tags: true },
    });

    await prisma.$transaction(
      tcs.map((tc) => {
        const tags = JSON.parse(tc.tags || '[]') as string[];
        if (!tags.includes(tag)) tags.push(tag);
        return prisma.testCase.update({ where: { id: tc.id }, data: { tags: JSON.stringify(tags) } });
      }),
    );

    res.json({ updated: tcs.length });
  } catch (err) {
    next(err);
  }
});

// ── GET /seed-template — download a pre-formatted Excel template ───────────

router.get('/seed-template', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const headers = [
      'Use Case', 'Title', 'Objective', 'Priority', 'Test Type',
      'Pre-conditions / Dependencies', 'Test Steps', 'Test Data',
      'Expected Result', 'Actual Result', 'Notes',
    ];
    const samples = [
      {
        'Use Case': 'User Login',
        'Title': 'Verify login with valid credentials',
        'Objective': 'Ensure a registered user can log in successfully',
        'Priority': 'HIGH',
        'Test Type': 'UI',
        'Pre-conditions / Dependencies': 'User account exists and is active',
        'Test Steps': '1. Navigate to the login page\n2. Enter valid username\n3. Enter valid password\n4. Click Login button',
        'Test Data': 'Username: testuser@example.com | Password: Test@123',
        'Expected Result': 'User is redirected to the dashboard with a welcome message',
        'Actual Result': '',
        'Notes': 'Regression – run on every release',
      },
      {
        'Use Case': 'User Login',
        'Title': 'Verify login with invalid password',
        'Objective': 'Ensure an error is shown when wrong credentials are used',
        'Priority': 'HIGH',
        'Test Type': 'UI',
        'Pre-conditions / Dependencies': 'User account exists',
        'Test Steps': '1. Navigate to the login page\n2. Enter valid username\n3. Enter incorrect password\n4. Click Login button',
        'Test Data': 'Username: testuser@example.com | Password: WrongPass',
        'Expected Result': 'Error message "Invalid credentials" is displayed. User remains on the login page.',
        'Actual Result': '',
        'Notes': '',
      },
    ];

    const ws = xlsx.utils.json_to_sheet(samples, { header: headers });
    // Set column widths
    ws['!cols'] = [20, 40, 40, 12, 12, 40, 60, 40, 50, 20, 30].map((w) => ({ wch: w }));
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Test Cases');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="seed-tc-template.xlsx"');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

// ── POST /parse-seed — extract test cases from an uploaded Excel file ──────

router.post('/parse-seed', seedUpload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'An Excel file is required (multipart field: "file")' });
      return;
    }

    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws);

    const titleKeys       = ['title', 'name', 'test case', 'test case title', 'tc title', 'testcase', 'tc name'];
    const useCaseKeys     = ['use case', 'usecase', 'use case tag', 'module', 'feature'];
    const objectiveKeys   = ['objective', 'description', 'test objective', 'purpose'];
    const priorityKeys    = ['priority'];
    const typeKeys        = ['test type', 'type', 'testtype'];
    const preCondKeys     = ['pre-conditions / dependencies', 'pre-conditions', 'preconditions', 'pre conditions', 'prerequisites', 'dependencies', 'pre-condition', 'precondition'];
    const stepsKeys       = ['test steps', 'steps', 'step', 'test step'];
    const testDataKeys    = ['test data', 'testdata', 'data'];
    const expectedKeys    = ['expected result', 'expected results', 'expected outcome', 'expected', 'result'];
    const notesKeys       = ['notes', 'note', 'comments', 'comment', 'remarks'];

    const findVal = (row: Record<string, unknown>, keys: string[]): string => {
      const normalised: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) normalised[k.toLowerCase().trim()] = v;
      for (const k of keys) {
        const v = normalised[k.toLowerCase().trim()];
        if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
      }
      return '';
    };

    const normalizePriority = (v: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | undefined => {
      const u = v.toUpperCase().trim();
      if (u === 'CRITICAL' || u === 'P0') return 'CRITICAL';
      if (u === 'HIGH' || u === 'P1') return 'HIGH';
      if (u === 'MEDIUM' || u === 'MED' || u === 'NORMAL' || u === 'P2') return 'MEDIUM';
      if (u === 'LOW' || u === 'P3') return 'LOW';
      return undefined;
    };

    const normalizeType = (v: string): 'UI' | 'API' | 'SIT' | undefined => {
      const u = v.toUpperCase().trim();
      if (u.includes('API')) return 'API';
      if (u.includes('SIT') || u.includes('INTEGRAT')) return 'SIT';
      if (u.includes('UI')) return 'UI';
      return undefined;
    };

    const seedTCs = rows
      .map((row) => {
        const title = findVal(row, titleKeys);
        if (!title) return null;

        const stepsRaw = findVal(row, stepsKeys);
        const steps = stepsRaw
          .split(/\r?\n/)
          .map((s) => s.replace(/^\d+\.\s*/, '').trim())
          .filter(Boolean);

        const priorityRaw = findVal(row, priorityKeys);
        const typeRaw = findVal(row, typeKeys);

        return {
          title,
          steps: steps.length ? steps : (stepsRaw ? [stepsRaw] : []),
          expectedResult: findVal(row, expectedKeys),
          useCaseTag: findVal(row, useCaseKeys) || undefined,
          description: findVal(row, objectiveKeys) || undefined,
          priority: priorityRaw ? normalizePriority(priorityRaw) : undefined,
          type: typeRaw ? normalizeType(typeRaw) : undefined,
          preConditions: findVal(row, preCondKeys) || undefined,
          testData: findVal(row, testDataKeys) || undefined,
          notes: findVal(row, notesKeys) || undefined,
        };
      })
      .filter(Boolean);

    res.json({ seedTCs });
  } catch (err) {
    next(err);
  }
});

// ── GET / ─────────────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, status, useCaseTag, search, page = '1', limit = '50' } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const where = {
      projectId: req.project.id,
      ...(type && { type }),
      ...(status && { status }),
      ...(useCaseTag && { useCaseTag }),
      ...(search && {
        title: { contains: search },
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [testCases, total] = await Promise.all([
      prisma.testCase.findMany({
        where,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        include: { prerequisiteTc: { select: { id: true, tcId: true, title: true } } } as any,
        orderBy: [{ useCaseTag: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: limitNum,
      }),
      prisma.testCase.count({ where }),
    ]);

    // Fetch the last 5 run statuses for each TC in a single query (newest first per TC).
    const tcIds = testCases.map((tc) => tc.id);
    const runResultRows = tcIds.length > 0
      ? await prisma.runResult.findMany({
          where: {
            testCaseId: { in: tcIds },
            status: { in: ['PASSED', 'FAILED', 'SKIPPED'] },
          },
          select: { testCaseId: true, status: true, runId: true },
          orderBy: [{ run: { createdAt: 'desc' } }],
        })
      : [];

    // Group newest-first, cap at 5 per TC, then reverse to oldest→newest for display.
    const recentByTc = new Map<string, Array<{ status: string; runId: string }>>();
    for (const rr of runResultRows) {
      const arr = recentByTc.get(rr.testCaseId) ?? [];
      if (arr.length < 5) arr.push({ status: rr.status, runId: rr.runId });
      recentByTc.set(rr.testCaseId, arr);
    }

    res.json({
      testCases: testCases.map((tc) => ({
        ...parseTCFields(tc as Record<string, unknown>),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prerequisiteTc: (tc as any).prerequisiteTc ?? null,
        // Oldest → newest (right side = most recent run)
        recentRunStatuses: [...(recentByTc.get(tc.id) ?? [])].reverse(),
      })),
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    next(err);
  }
});

// ── POST / — save batch ────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = SaveTestCasesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }

    const slug = req.project.slug;
    const projectId = req.project.id;
    const prefix = slug.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();

    // Use max numeric suffix so deletions/gaps never cause collisions
    const existing = await prisma.testCase.findMany({
      where: { projectId },
      select: { tcId: true },
    });
    const maxNum = existing.reduce((max, { tcId }) => {
      const m = tcId.match(/(\d+)$/);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);

    const created = await prisma.$transaction(
      parsed.data.testCases.map((tc, i) =>
        prisma.testCase.create({
          data: {
            projectId,
            tcId: `TC-${prefix}-${String(maxNum + i + 1).padStart(3, '0')}`,
            title: tc.title,
            description: tc.description,
            steps: JSON.stringify(tc.steps),
            expectedResult: tc.expectedResult,
            type: tc.type,
            tags: JSON.stringify(tc.tags),
            useCaseTag: tc.useCaseTag,
            priority: tc.priority,
            status: tc.status,
            sourceRef: tc.sourceRef,
            generationHints: tc.generationHints ?? null,
          },
        }),
      ),
    );

    res.status(201).json({ testCases: created.map(parseTCFields), count: created.length });
  } catch (err) {
    next(err);
  }
});

// ── GET /:tcId ─────────────────────────────────────────────────────────────

router.get('/:tcId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tc = await prisma.testCase.findFirst({
      where: { tcId: req.params['tcId'], projectId: req.project.id },
    });

    if (!tc) {
      res.status(404).json({ error: 'Test case not found' });
      return;
    }

    res.json({ testCase: parseTCFields(tc as unknown as Record<string, unknown>) });
  } catch (err) {
    next(err);
  }
});

// ── PUT /:tcId ─────────────────────────────────────────────────────────────

router.put('/:tcId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = UpdateTestCaseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }

    const existing = await prisma.testCase.findFirst({
      where: { tcId: req.params['tcId'], projectId: req.project.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Test case not found' });
      return;
    }

    const { steps, tags, prerequisiteTcId, ...rest } = parsed.data;

    // Guard: prevent self-referencing prerequisite
    if (prerequisiteTcId === existing.id) {
      res.status(400).json({ error: 'A test case cannot be its own prerequisite' });
      return;
    }

    // Sync TestCases/ scripts to the new use-case folder when useCaseTag changes
    if (parsed.data.useCaseTag !== undefined && parsed.data.useCaseTag !== existing.useCaseTag) {
      const scripts = await prisma.script.findMany({
        where: { testCaseId: existing.id, projectId: req.project.id },
        select: { id: true, filename: true },
      });
      for (const s of scripts) {
        await syncScriptToUseCase(req.project.slug, s, parsed.data.useCaseTag ?? null).catch(() => {});
      }
    }

    const updated = await prisma.testCase.update({
      where: { id: existing.id },
      data: {
        ...rest,
        ...(steps !== undefined && { steps: JSON.stringify(steps) }),
        ...(tags !== undefined && { tags: JSON.stringify(tags) }),
        ...(prerequisiteTcId !== undefined && { prerequisiteTcId: prerequisiteTcId ?? null }),
      },
    });

    res.json({ testCase: parseTCFields(updated as unknown as Record<string, unknown>) });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /:tcId ──────────────────────────────────────────────────────────

router.delete('/:tcId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.testCase.findFirst({
      where: { tcId: req.params['tcId'], projectId: req.project.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Test case not found' });
      return;
    }

    const scripts = await prisma.script.findMany({
      where: { testCaseId: existing.id, projectId: req.project.id },
      select: { id: true, filename: true },
    });

    if (scripts.length > 0) {
      await prisma.script.deleteMany({ where: { id: { in: scripts.map((s) => s.id) } } });
      for (const s of scripts) deleteScript(req.project.slug, s.filename);
    }

    await prisma.testCase.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
