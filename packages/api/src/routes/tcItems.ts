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
    const [total, linked] = await Promise.all([
      prisma.tcItem.count({ where: { projectId } }),
      prisma.tcItem.count({ where: { projectId, linkedScriptId: { not: null } } }),
    ]);
    res.json({ total, linked, unlinked: total - linked });
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
    const { srNo, module: mod, feature, title, description, steps, expectedResult, linkedScriptId } = req.body as Record<string, string | null>;

    const existing = await prisma.tcItem.findFirst({ where: { id, projectId } });
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

    const item = await prisma.tcItem.update({
      where: { id },
      data: {
        ...(srNo !== undefined ? { srNo: srNo ? Number(srNo) : null } : {}),
        ...(mod !== undefined ? { module: mod || null } : {}),
        ...(feature !== undefined ? { feature: feature || null } : {}),
        ...(title !== undefined ? { title: (title as string).trim() } : {}),
        ...(description !== undefined ? { description: description || null } : {}),
        ...(steps !== undefined ? { steps: steps || null } : {}),
        ...(expectedResult !== undefined ? { expectedResult: expectedResult || null } : {}),
        ...(linkedScriptId !== undefined ? { linkedScriptId: linkedScriptId || null } : {}),
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

// ── GET /template — download Excel import template ────────────────────────
router.get('/template', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const headers = ['SR. No', 'Module', 'Feature', 'Test Case Title', 'Test Case Description', 'Step', 'Expected Result'];
    const samples = [
      {
        'SR. No': 1,
        'Module': 'CPM',
        'Feature': 'Geo Hierarchy',
        'Test Case Title': 'Modify Geo hierarchy (Country)',
        'Test Case Description': 'Admin User / User with privilege can Modify the Geo Hie',
        'Step': '1. Admin or user with privileges will login to CPM UI\n2. User navigates to Geo Hierarchy',
        'Expected Result': 'Admin User / User with privilege should be able to modify the Geo Hierarchy.',
      },
    ];

    const ws = xlsx.utils.json_to_sheet(samples, { header: headers });
    ws['!cols'] = [8, 20, 25, 40, 50, 60, 50].map((w) => ({ wch: w }));
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
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws);

    const findVal = (row: Record<string, unknown>, keys: string[]): string => {
      const norm: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) norm[k.toLowerCase().trim()] = v;
      for (const k of keys) {
        const v = norm[k.toLowerCase().trim()];
        if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
      }
      return '';
    };

    const srKeys      = ['sr. no', 'sr.no', 'sr no', 'srno', 's.no', 'sno', 'serial', 'no', '#'];
    const moduleKeys  = ['module'];
    const featureKeys = ['feature'];
    const titleKeys   = ['test case title', 'title', 'test case name', 'tc title', 'name'];
    const descKeys    = ['test case description', 'description', 'objective', 'desc'];
    const stepsKeys   = ['step', 'steps', 'test steps', 'test step'];
    const expectedKeys = ['expected result', 'expected results', 'expected outcome', 'expected'];

    const data = rows
      .map((row) => {
        const title = findVal(row, titleKeys);
        if (!title) return null;
        const srRaw = findVal(row, srKeys);
        return {
          projectId,
          srNo:           srRaw ? Number(srRaw) || null : null,
          module:         findVal(row, moduleKeys) || null,
          feature:        findVal(row, featureKeys) || null,
          title,
          description:    findVal(row, descKeys) || null,
          steps:          findVal(row, stepsKeys) || null,
          expectedResult: findVal(row, expectedKeys) || null,
        };
      })
      .filter(Boolean) as {
        projectId: string; srNo: number | null; module: string | null; feature: string | null;
        title: string; description: string | null; steps: string | null; expectedResult: string | null;
      }[];

    if (data.length === 0) {
      res.status(400).json({ error: 'No valid rows found. Check that "Test Case Title" column is present.' });
      return;
    }

    await prisma.tcItem.createMany({ data });
    res.status(201).json({ imported: data.length });
  } catch (err) {
    next(err);
  }
});

export default router;
