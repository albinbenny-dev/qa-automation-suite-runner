import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import * as xlsx from 'xlsx';
import { prisma } from '../lib/prisma.js';

const router = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── GET /stats ─────────────────────────────────────────────────────────────
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const [total, linked, notApplicable] = await Promise.all([
      prisma.tcItem.count({ where: { projectId } }),
      prisma.tcItem.count({ where: { projectId, linkedScriptId: { not: null }, automationStatus: 'IN_SCOPE' } }),
      prisma.tcItem.count({ where: { projectId, automationStatus: 'NOT_APPLICABLE' } }),
    ]);
    const inScope = total - notApplicable;
    const unlinked = inScope - linked;
    res.json({ total, linked, unlinked, notApplicable, inScope });
  } catch (err) {
    next(err);
  }
});

// ── GET / ──────────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const { module: mod, search } = req.query as Record<string, string>;

    const items = await prisma.tcItem.findMany({
      where: {
        projectId,
        ...(mod ? { module: mod } : {}),
        ...(search ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { module: { contains: search, mode: 'insensitive' } },
            { feature: { contains: search, mode: 'insensitive' } },
          ],
        } : {}),
      },
      include: {
        linkedScript: { select: { id: true, tcId: true, title: true, useCaseTag: true } },
      },
      orderBy: [{ module: 'asc' }, { srNo: 'asc' }, { createdAt: 'asc' }],
    });

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// ── POST / ────────────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const { srNo, module: mod, feature, title, description, steps, expectedResult } = req.body as Record<string, string>;
    if (!title?.trim()) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const item = await prisma.tcItem.create({
      data: {
        projectId,
        srNo: srNo ? Number(srNo) : undefined,
        module: mod || undefined,
        feature: feature || undefined,
        title: title.trim(),
        description: description || undefined,
        steps: steps || undefined,
        expectedResult: expectedResult || undefined,
      },
      include: { linkedScript: { select: { id: true, tcId: true, title: true, useCaseTag: true } } },
    });
    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /:id ────────────────────────────────────────────────────────────
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId, id } = req.params;
    const { srNo, module: mod, feature, title, description, steps, expectedResult, linkedScriptId, automationStatus } = req.body as Record<string, string | null>;

    const existing = await prisma.tcItem.findFirst({ where: { id, projectId } });
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

    const item = await prisma.tcItem.update({
      where: { id },
      data: {
        ...(srNo !== undefined ? { srNo: srNo || null } : {}),
        ...(mod !== undefined ? { module: mod || null } : {}),
        ...(feature !== undefined ? { feature: feature || null } : {}),
        ...(title !== undefined ? { title: (title as string).trim() } : {}),
        ...(description !== undefined ? { description: description || null } : {}),
        ...(steps !== undefined ? { steps: steps || null } : {}),
        ...(expectedResult !== undefined ? { expectedResult: expectedResult || null } : {}),
        ...(linkedScriptId !== undefined ? { linkedScriptId: linkedScriptId || null } : {}),
        ...(automationStatus !== undefined ? { automationStatus: automationStatus || 'IN_SCOPE' } : {}),
      },
      include: { linkedScript: { select: { id: true, tcId: true, title: true, useCaseTag: true } } },
    });
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId, id } = req.params;
    const existing = await prisma.tcItem.findFirst({ where: { id, projectId } });
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
    await prisma.tcItem.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /bulk-delete ────────────────────────────────────────────────────
router.post('/bulk-delete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids array required' });
      return;
    }
    const { count } = await prisma.tcItem.deleteMany({ where: { projectId, id: { in: ids } } });
    res.json({ deleted: count });
  } catch (err) {
    next(err);
  }
});

// ── POST /bulk-move-feature ───────────────────────────────────────────────
router.post('/bulk-move-feature', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const { ids, feature } = req.body as { ids: string[]; feature: string };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids array required' });
      return;
    }
    const { count } = await prisma.tcItem.updateMany({
      where: { projectId, id: { in: ids } },
      data: { feature: feature?.trim() || null },
    });
    res.json({ updated: count });
  } catch (err) {
    next(err);
  }
});

// ── POST /bulk-link-script ────────────────────────────────────────────────
router.post('/bulk-link-script', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const { ids, testCaseId } = req.body as { ids: string[]; testCaseId: string | null };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids array required' });
      return;
    }
    const { count } = await prisma.tcItem.updateMany({
      where: { projectId, id: { in: ids } },
      data: { linkedScriptId: testCaseId ?? null },
    });
    res.json({ updated: count });
  } catch (err) {
    next(err);
  }
});

// ── POST /bulk-set-automation-status ─────────────────────────────────────
router.post('/bulk-set-automation-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const { ids, automationStatus } = req.body as { ids: string[]; automationStatus: string };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: 'ids array required' }); return; }
    if (!['IN_SCOPE', 'NOT_APPLICABLE'].includes(automationStatus)) {
      res.status(400).json({ error: 'automationStatus must be IN_SCOPE or NOT_APPLICABLE' }); return;
    }
    const { count } = await prisma.tcItem.updateMany({
      where: { projectId, id: { in: ids } },
      data: { automationStatus },
    });
    res.json({ updated: count });
  } catch (err) {
    next(err);
  }
});

// ── GET /export — download all TcItems as Excel ──────────────────────────
router.get('/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;

    const items = await prisma.tcItem.findMany({
      where: { projectId },
      include: {
        linkedScript: { select: { id: true, tcId: true, title: true } },
      },
      orderBy: [{ module: 'asc' }, { srNo: 'asc' }, { createdAt: 'asc' }],
    });

    // Also fetch Script records to resolve the .robot filename for linked scripts
    const linkedScriptIds = [...new Set(items.map((i) => i.linkedScriptId).filter(Boolean))] as string[];
    const scriptFilenames = new Map<string, string>(); // testCaseId → Script.filename
    if (linkedScriptIds.length > 0) {
      const scripts = await prisma.script.findMany({
        where: { projectId, testCaseId: { in: linkedScriptIds } },
        select: { testCaseId: true, filename: true },
      });
      for (const s of scripts) {
        if (s.testCaseId) {
          const basename = s.filename.includes('/') ? s.filename.split('/').pop()! : s.filename;
          scriptFilenames.set(s.testCaseId, basename);
        }
      }
    }

    const headers = [
      'Test Case ID', 'Module', 'Feature', 'Test Case Title',
      'Test Case Description', 'Steps', 'Expected Result',
      'Automation Scope', 'RF Script ID', 'Script Title',
    ];

    const rows = items.map((item) => ({
      'Test Case ID':          item.srNo ?? '',
      'Module':                item.module ?? '',
      'Feature':               item.feature ?? '',
      'Test Case Title':       item.title,
      'Test Case Description': item.description ?? '',
      'Steps':                 item.steps ?? '',
      'Expected Result':       item.expectedResult ?? '',
      'Automation Scope':      item.automationStatus === 'NOT_APPLICABLE' ? 'No' : 'Yes',
      'RF Script ID':          item.linkedScriptId ? (scriptFilenames.get(item.linkedScriptId) ?? '') : '',
      'Script Title':          item.linkedScript?.title ?? '',
    }));

    const ws = xlsx.utils.json_to_sheet(rows, { header: headers });
    ws['!cols'] = [14, 18, 28, 40, 50, 60, 50, 16, 40, 40].map((w) => ({ wch: w }));
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'TC Library');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="tc-library-export.xlsx"');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

// ── GET /template — download Excel import template ────────────────────────
router.get('/template', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const headers = ['Test Case ID', 'Module', 'Feature', 'Test Case Title', 'Test Case Description', 'Step', 'Expected Result', 'Automation Scope', 'RF Script ID'];
    const samples = [
      {
        'Test Case ID': 'AIR-TC-001',
        'Module': 'CPM',
        'Feature': 'Geo Hierarchy',
        'Test Case Title': 'Modify Geo hierarchy (Country)',
        'Test Case Description': 'Admin User / User with privilege can Modify the Geo Hierarchy',
        'Step': '1. Admin or user with privileges will login to CPM UI\n2. User navigates to Geo Hierarchy',
        'Expected Result': 'Admin User / User with privilege should be able to modify the Geo Hierarchy.',
        'Automation Scope': 'Yes',
        'RF Script ID': 'TC01_Modify_Geo_Hierarchy.robot',
      },
    ];

    const ws = xlsx.utils.json_to_sheet(samples, { header: headers });
    ws['!cols'] = [14, 20, 25, 40, 50, 60, 50, 16, 16].map((w) => ({ wch: w }));
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Test Cases');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="tc-import-template.xlsx"');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

// ── POST /import — parse Excel and bulk-create TcItems ───────────────────
router.post('/import', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    if (!req.file) { res.status(400).json({ error: 'Excel file required (field: file)' }); return; }

    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });

    const findVal = (row: Record<string, unknown>, keys: string[]): string => {
      const norm: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) norm[k.toLowerCase().trim()] = v;
      for (const k of keys) {
        const v = norm[k.toLowerCase().trim()];
        if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
      }
      return '';
    };

    // Only these canonical columns are used; all other columns in the Excel are ignored.
    const tcIdKeys     = ['test case id', 'testcaseid', 'tc id', 'tc_id', 'sr. no', 'sr.no', 'sr no', 'srno', 's.no', 'sno', 'serial', 'no', '#'];
    const moduleKeys   = ['module'];
    const featureKeys  = ['feature'];
    const titleKeys    = ['test case title', 'title', 'test case name', 'tc title', 'name'];
    const descKeys     = ['test case description', 'description', 'objective', 'desc'];
    const stepsKeys    = ['step', 'steps', 'test steps', 'test step'];
    const expectedKeys = ['expected result', 'expected results', 'expected outcome', 'expected'];
    const rfScriptKeys      = ['rf script id', 'rfscriptid', 'rf_script_id', 'script id', 'scriptid', 'rf script', 'rfscript'];
    const automationScopeKeys = ['automation scope', 'automationscope', 'automation_scope', 'include in automation', 'eligible for automation'];

    // Collect rows from ALL sheets so multi-sheet workbooks are fully imported
    const allRows: Record<string, unknown>[] = [];
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      allRows.push(...rows);
    }

    // Forward-fill TC ID, Module, Feature, and Title to handle merged-cell Excel layouts
    let lastTcId    = '';
    let lastModule  = '';
    let lastFeature = '';
    let lastTitle   = '';

    type RawRow = {
      projectId: string; srNo: string | null; module: string | null; feature: string | null;
      title: string; description: string | null; steps: string | null; expectedResult: string | null;
      automationStatus: string; _rfScriptId: string | null;
    };

    let skippedEmpty = 0;

    const data = allRows
      .map((row): RawRow | null => {
        const tcId    = findVal(row, tcIdKeys)     || lastTcId;
        const module  = findVal(row, moduleKeys)   || lastModule;
        const feature = findVal(row, featureKeys)  || lastFeature;
        const title   = findVal(row, titleKeys)    || lastTitle;

        if (!title) { skippedEmpty++; return null; }

        lastTcId    = tcId;
        lastModule  = module;
        lastFeature = feature;
        lastTitle   = title;

        const scopeRaw = findVal(row, automationScopeKeys).toLowerCase();
        const automationStatus = ['no', 'n', 'false', '0'].includes(scopeRaw) ? 'NOT_APPLICABLE' : 'IN_SCOPE';

        return {
          projectId,
          srNo:             tcId || null,
          module:           module || null,
          feature:          feature || null,
          title,
          description:      findVal(row, descKeys)     || null,
          steps:            findVal(row, stepsKeys)    || null,
          expectedResult:   findVal(row, expectedKeys) || null,
          automationStatus,
          _rfScriptId:      findVal(row, rfScriptKeys) || null,
        };
      })
      .filter(Boolean) as RawRow[];

    // Deduplicate: prefer srNo as the unique key (most reliable); fall back to module|feature|title
    const seen = new Set<string>();
    const duplicateRows: string[] = [];
    const deduped = data.filter((d) => {
      const key = d.srNo ? `srno:${d.srNo}` : `${d.module ?? ''}|${d.feature ?? ''}|${d.title}`;
      if (seen.has(key)) {
        duplicateRows.push(d.srNo ? `${d.srNo} — ${d.title}` : d.title);
        return false;
      }
      seen.add(key);
      return true;
    });

    if (deduped.length === 0) {
      res.status(400).json({ error: 'No valid rows found. Check that "Test Case Title" column is present.' });
      return;
    }

    // Load existing DB records to split deduped into insert vs update
    const existingItems = await prisma.tcItem.findMany({
      where: { projectId },
      select: { id: true, srNo: true, module: true, feature: true, title: true },
    });
    const existingMap = new Map<string, string>(); // dedup-key → TcItem.id
    for (const e of existingItems) {
      const key = e.srNo ? `srno:${e.srNo}` : `${e.module ?? ''}|${e.feature ?? ''}|${e.title}`;
      existingMap.set(key, e.id);
    }

    const toInsert: RawRow[] = [];
    const toUpdate: (RawRow & { _existingId: string })[] = [];

    for (const d of deduped) {
      const key = d.srNo ? `srno:${d.srNo}` : `${d.module ?? ''}|${d.feature ?? ''}|${d.title}`;
      const existingId = existingMap.get(key);
      if (existingId) {
        toUpdate.push({ ...d, _existingId: existingId });
      } else {
        toInsert.push(d);
      }
    }

    // Resolve RF Script column values → TestCase.id (linkedScriptId FK target)
    // Primary: Script.filename match (stable — what resources put in the sheet)
    // Fallback: TestCase.tcId match for backwards compatibility
    const allRows2 = [...toInsert, ...toUpdate];
    const rfValues = [...new Set(allRows2.map((d) => d._rfScriptId).filter(Boolean))] as string[];
    const scriptMap = new Map<string, string>(); // rfValue → TestCase.id
    if (rfValues.length > 0) {
      const scriptsByFilename = await prisma.script.findMany({
        where: {
          projectId,
          OR: rfValues.flatMap((v) => [
            { filename: v },
            { filename: { endsWith: '/' + v } },
          ]),
        },
        select: { filename: true, testCaseId: true },
      });
      for (const s of scriptsByFilename) {
        if (s.testCaseId) {
          const basename = s.filename.includes('/') ? s.filename.split('/').pop()! : s.filename;
          scriptMap.set(basename, s.testCaseId);
          scriptMap.set(s.filename, s.testCaseId);
        }
      }
      const unmapped = rfValues.filter((v) => !scriptMap.has(v));
      if (unmapped.length > 0) {
        const tcsByTcId = await prisma.testCase.findMany({
          where: { projectId, tcId: { in: unmapped } },
          select: { id: true, tcId: true },
        });
        for (const tc of tcsByTcId) scriptMap.set(tc.tcId, tc.id);
      }
    }

    // Insert new rows
    const insertData = toInsert.map(({ _rfScriptId, ...rest }) => ({
      ...rest,
      linkedScriptId: _rfScriptId ? (scriptMap.get(_rfScriptId) ?? null) : null,
    }));
    if (insertData.length > 0) {
      await prisma.tcItem.createMany({ data: insertData });
    }

    // Update existing rows (upsert — overwrite all mutable fields)
    await Promise.all(
      toUpdate.map(({ _rfScriptId, _existingId, ...rest }) =>
        prisma.tcItem.update({
          where: { id: _existingId },
          data: {
            ...rest,
            linkedScriptId: _rfScriptId ? (scriptMap.get(_rfScriptId) ?? null) : null,
          },
        })
      )
    );

    const rfNotFound = rfValues.filter((v) => !scriptMap.has(v));
    const totalLinked = [...insertData, ...toUpdate].filter((d) => {
      const rf = d._rfScriptId ?? null;
      return rf ? scriptMap.has(rf) : false;
    }).length;

    res.status(201).json({
      imported:      insertData.length,
      updated:       toUpdate.length,
      linked:        totalLinked,
      skippedEmpty,
      duplicateRows,
      rfNotFound,
      totalRows:     allRows.length,
      alreadyExists: 0,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
