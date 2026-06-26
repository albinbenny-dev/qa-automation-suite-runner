import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import AdmZip from 'adm-zip';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import {
  saveScript,
  readScript,
  deleteScript,
  getScriptFileMeta,
  exportZip,
  listScriptFiles,
} from '../services/scriptFileService.js';

const router = Router({ mergeParams: true });

router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── Zod schemas ────────────────────────────────────────────────────────────

const SaveContentSchema = z.object({
  content: z.string(),
});

// ── Multer for script uploads ──────────────────────────────────────────────

const scriptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    const ok = file.originalname.endsWith('.robot');
    if (ok) cb(null, true);
    else cb(new Error('Only .robot files are allowed'));
  },
});

// ── GET / — list scripts (DB + filesystem meta) ────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  try {
    const projectId = req.project.id;

    const scripts = await prisma.script.findMany({
      where: { projectId },
      include: {
        testCase: { select: { id: true, tcId: true, title: true, useCaseTag: true } },
        runResults: {
          select: { status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const enriched = scripts.map((s: (typeof scripts)[number]) => {
      const meta = getScriptFileMeta(req.project.slug, s.filename);
      return {
        id: s.id,
        projectId: s.projectId,
        testCaseId: s.testCaseId,
        filename: s.filename,
        scriptType: 'ROBOT',
        isCustomUpload: s.isCustomUpload,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        testCase: s.testCase,
        lastRunStatus: s.runResults[0]?.status ?? null,
        size: meta?.size ?? null,
        modifiedAt: meta?.modifiedAt ?? null,
      };
    });

    res.json({ scripts: enriched });
  } catch (err) {
    console.error('[scripts] GET /', err);
    res.status(500).json({ error: 'Failed to list scripts' });
  }
});

// ── GET /:id/content — return raw script content ───────────────────────────

router.get('/:id/content', async (req: Request, res: Response) => {
  try {
    const script = await prisma.script.findFirst({
      where: { id: req.params.id, projectId: req.project.id },
    });

    if (!script) {
      res.status(404).json({ error: 'Script not found' });
      return;
    }

    // Prefer filesystem (always fresh); fall back to DB content
    let content = script.content;
    try {
      content = readScript(req.project.slug, script.filename);
    } catch {
      // file may not exist if volume was reset — fall back to DB
    }

    res.json({ content });
  } catch (err) {
    console.error('[scripts] GET /:id/content', err);
    res.status(500).json({ error: 'Failed to read script content' });
  }
});

// ── PUT /:id/content — save edited content ─────────────────────────────────

router.put('/:id/content', async (req: Request, res: Response) => {
  try {
    const parsed = SaveContentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'content field is required' });
      return;
    }

    const script = await prisma.script.findFirst({
      where: { id: req.params.id, projectId: req.project.id },
    });

    if (!script) {
      res.status(404).json({ error: 'Script not found' });
      return;
    }

    const { content } = parsed.data;

    // Update DB and filesystem
    await prisma.script.update({
      where: { id: script.id },
      data: { content, updatedAt: new Date() },
    });
    saveScript(req.project.slug, script.filename, content);

    res.json({ ok: true });
  } catch (err) {
    console.error('[scripts] PUT /:id/content', err);
    res.status(500).json({ error: 'Failed to save script content' });
  }
});

// ── DELETE /:id ────────────────────────────────────────────────────────────

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const script = await prisma.script.findFirst({
      where: { id: req.params.id, projectId: req.project.id },
    });

    if (!script) {
      res.status(404).json({ error: 'Script not found' });
      return;
    }

    await prisma.script.delete({ where: { id: script.id } });
    deleteScript(req.project.slug, script.filename);

    res.json({ ok: true });
  } catch (err) {
    console.error('[scripts] DELETE /:id', err);
    res.status(500).json({ error: 'Failed to delete script' });
  }
});

// ── POST /upload — upload a custom .robot file ─────────────────────────────

function buildSystemFilename(tcId: string, title: string, originalname: string): string {
  const ext = '.robot';
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${tcId}-${slug}${ext}`;
}

router.post(
  '/upload',
  (req: Request, res: Response, next: NextFunction) => {
    scriptUpload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        res.status(400).json({ error: `Upload error: ${err.message}` });
        return;
      }
      if (err instanceof Error) {
        res.status(400).json({ error: err.message });
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded. Use multipart/form-data with field "file"' });
        return;
      }

      const projectId = req.project.id;
      const slug = req.project.slug;
      const testCaseId = (req.body?.testCaseId as string | undefined) || null;

      const rawContent = req.file.buffer.toString('utf-8');
      let filename = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');

      if (testCaseId) {
        const tc = await prisma.testCase.findFirst({ where: { id: testCaseId, projectId } });
        if (!tc) {
          res.status(400).json({ error: 'Test case not found in this project' });
          return;
        }
        filename = buildSystemFilename(tc.tcId, tc.title, req.file.originalname);
        const existing = await prisma.script.findFirst({ where: { projectId, testCaseId } });
        if (existing) {
          await prisma.script.delete({ where: { id: existing.id } });
          deleteScript(slug, existing.filename);
        }
      }

      saveScript(slug, filename, rawContent);

      const script = await prisma.script.create({
        data: {
          projectId,
          testCaseId,
          filename,
          content: rawContent,
          scriptType: 'ROBOT',
          isCustomUpload: true,
        },
      });

      res.status(201).json({
        id: script.id,
        filename: script.filename,
        scriptType: 'ROBOT',
        testCaseId: script.testCaseId,
        isCustomUpload: true,
        createdAt: script.createdAt,
      });
    } catch (err) {
      console.error('[scripts] POST /upload', err);
      res.status(500).json({ error: 'Upload failed' });
    }
  },
);

// ── GET /export/zip ────────────────────────────────────────────────────────

router.get('/export/zip', async (req: Request, res: Response) => {
  try {
    const projectId = req.project.id;

    // Optional: filter by comma-separated IDs via query param
    let filenames: string[] | undefined;
    const idsParam = req.query.ids as string | undefined;
    if (idsParam) {
      const ids = idsParam.split(',').filter(Boolean);
      const scripts = await prisma.script.findMany({
        where: { id: { in: ids }, projectId },
        select: { filename: true },
      });
      filenames = scripts.map((s: { filename: string }) => s.filename);
    }

    const buffer = await exportZip(req.project.slug, filenames);
    const name = `${req.project.slug}-scripts.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[scripts] GET /export/zip', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

// ── GET /mine-keywords — cross-script keyword mining ─────────────────────
// Analyses all .robot files in the project and returns keyword bodies that
// appear in 2+ scripts (candidates for extraction to resources/).

router.get('/mine-keywords', async (req: Request, res: Response) => {
  try {
    const slug = req.project.slug;
    const files = listScriptFiles(slug).filter(f => f.filename.endsWith('.robot'));

    // Parse keywords out of each file: a keyword is a non-indented line followed by indented lines
    const keywordBodies: Map<string, { body: string; files: string[] }> = new Map();

    for (const { filename } of files) {
      let content: string;
      try { content = readScript(slug, filename); } catch { continue; }

      const lines = content.split('\n');
      let inKeywords = false;
      let currentName = '';
      const currentBody: string[] = [];

      const flush = () => {
        if (!currentName || currentBody.length === 0) return;
        const body = currentBody.join('\n').trim();
        if (body.length < 20) return; // ignore trivially short keywords
        if (!keywordBodies.has(body)) {
          keywordBodies.set(body, { body, files: [filename] });
        } else {
          const entry = keywordBodies.get(body)!;
          if (!entry.files.includes(filename)) entry.files.push(filename);
        }
      };

      for (const line of lines) {
        if (line.trim() === '*** Keywords ***') { inKeywords = true; currentName = ''; currentBody.length = 0; continue; }
        if (line.startsWith('*** ') && line !== '*** Keywords ***') { flush(); inKeywords = false; currentName = ''; currentBody.length = 0; continue; }
        if (!inKeywords) continue;
        if (line && !line.startsWith(' ') && !line.startsWith('\t')) {
          flush(); currentName = line.trim(); currentBody.length = 0;
        } else if (currentName) {
          currentBody.push(line);
        }
      }
      flush();
    }

    const candidates = Array.from(keywordBodies.values())
      .filter(k => k.files.length >= 2)
      .map(k => ({ body: k.body.slice(0, 300), usedInFiles: k.files, count: k.files.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    res.json({ candidates, analysedFiles: files.length });
  } catch (err) {
    console.error('[scripts] GET /mine-keywords', err);
    res.status(500).json({ error: 'Keyword mining failed' });
  }
});

// ── POST /import-folder — receive zip upload, extract, parse .robot files, auto-create test cases

const folderUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

router.post('/import-folder', requireProjectAccess as RequestHandler, folderUpload.single('folder'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'A zip file is required (field: folder)' }); return; }
    const { projectId } = req.params;
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { slug: true } });
    const zip = new AdmZip(req.file.buffer);
    const entries = zip.getEntries();
    const scriptsRoot = process.env.SCRIPTS_ROOT ?? '/scripts';
    const scriptsDest = path.join(scriptsRoot, project.slug, 'scripts');
    const resourcesDest = path.join(scriptsRoot, project.slug, 'resources');
    fs.mkdirSync(scriptsDest, { recursive: true });
    fs.mkdirSync(resourcesDest, { recursive: true });

    const results: { filename: string; testCasesCreated: number }[] = [];
    const resourcesCopied: string[] = [];
    const warnings: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const entryName = entry.entryName.replace(/\\/g, '/');
      const filename = path.basename(entryName);

      // Resource files: anything under Resource/ or resource/ (non-.robot or keyword files)
      const isResourcePath = /\/(resource|Resource|resources|Resources)\//i.test('/' + entryName);
      if (isResourcePath) {
        // keep relative sub-path under resource dir
        const resourceBase = entryName.replace(/^.*?\/(resource|Resource|resources|Resources)\//i, '');
        const destPath = path.join(resourcesDest, resourceBase);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, entry.getData());
        await prisma.projectResource.upsert({
          where: { projectId_filename: { projectId, filename: resourceBase } },
          create: { projectId, filename: resourceBase, originalName: filename, size: entry.getData().length },
          update: { size: entry.getData().length },
        }).catch(() => {/* ignore if model differs */});
        resourcesCopied.push(resourceBase);
        continue;
      }

      // Test scripts: .robot files outside resource dirs
      if (!filename.endsWith('.robot')) continue;

      const content = entry.getData().toString('utf-8');
      const destPath = path.join(scriptsDest, filename);
      fs.writeFileSync(destPath, content, 'utf-8');

      // Parse test case names from *** Test Cases *** section
      const tcNames: string[] = [];
      let inTcSection = false;
      for (const line of content.split('\n')) {
        if (/^\*+\s*Test Cases\s*\**/i.test(line.trim())) { inTcSection = true; continue; }
        if (/^\*+\s/.test(line.trim()) && inTcSection) { inTcSection = false; continue; }
        if (inTcSection && line.trim() && !line.trim().startsWith('#') && !/^\s/.test(line)) {
          tcNames.push(line.trim());
        }
      }

      // Upsert script
      const script = await prisma.script.upsert({
        where: { projectId_filename: { projectId, filename } },
        create: { projectId, filename, content, scriptType: 'ROBOT' },
        update: { content },
      });

      // Create test cases
      let tcCreated = 0;
      for (const name of tcNames) {
        const existing = await prisma.testCase.findFirst({ where: { projectId, title: name } });
        if (!existing) {
          await prisma.testCase.create({
            data: { projectId, title: name, type: 'UI', status: 'DRAFT', scripts: { connect: { id: script.id } } },
          });
          tcCreated++;
        }
      }
      results.push({ filename, testCasesCreated: tcCreated });
    }

    res.json({ imported: results, resources: resourcesCopied, warnings });
  } catch (err) { next(err); }
});

export default router;
