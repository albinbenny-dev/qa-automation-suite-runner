import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import AdmZip from 'adm-zip';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { requireAdmin } from '../middleware/rbac.js';
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

/**
 * After script records are deleted, remove any TestCase that now has no
 * remaining scripts, and unlink any TcItems that pointed to it.
 */
async function cleanOrphanedTestCases(testCaseIds: (string | null)[]): Promise<void> {
  const ids = [...new Set(testCaseIds.filter(Boolean) as string[])];
  if (ids.length === 0) return;
  for (const tcId of ids) {
    const remaining = await prisma.script.count({ where: { testCaseId: tcId } });
    if (remaining === 0) {
      // Unlink any TC Library items that referenced this Script Library entry
      await prisma.tcItem.updateMany({
        where: { linkedScriptId: tcId },
        data: { linkedScriptId: null },
      }).catch(() => {});
      await prisma.testCase.delete({ where: { id: tcId } }).catch(() => {});
    }
  }
}

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

// ── GET /project-file/content — return arbitrary project file text ─────────

router.get('/project-file/content', requireProjectAccess as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.project;
    const relPath = (req.query['path'] as string | undefined) ?? '';
    if (!relPath) { res.status(400).json({ error: 'path is required' }); return; }
    const abs = resolveProjectPath(slug, relPath);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.status(404).json({ error: 'File not found' }); return; }
    const content = fs.readFileSync(abs, 'utf8');
    res.json({ content, path: relPath });
  } catch (err) { next(err); }
});

// ── PUT /project-file/content — save arbitrary project file text ────────────

router.put('/project-file/content', requireAdmin as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug, id: projectId } = req.project;
    const relPath = (req.query['path'] as string | undefined) ?? '';
    if (!relPath) { res.status(400).json({ error: 'path is required' }); return; }
    const { content } = req.body as { content?: string };
    if (typeof content !== 'string') { res.status(400).json({ error: 'content is required' }); return; }
    const abs = resolveProjectPath(slug, relPath);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.status(404).json({ error: 'File not found' }); return; }
    fs.writeFileSync(abs, content, 'utf8');
    await prisma.script.updateMany({ where: { projectId, filename: relPath }, data: { content } }).catch(() => {});
    res.json({ saved: relPath });
  } catch (err) { next(err); }
});

// ── GET /project-file/search — full-text search across project files ─────────

router.get('/project-file/search', requireProjectAccess as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.project;
    const q = ((req.query['q'] as string | undefined) ?? '').trim();
    if (q.length < 2) { res.json({ results: [] }); return; }

    const extFilter = req.query['ext'] as string | undefined;
    const allowedExts = extFilter ? extFilter.split(',').map(e => e.trim().toLowerCase()) : null;

    const binaryExts = new Set(['.png','.jpg','.jpeg','.gif','.bmp','.ico','.woff','.woff2','.ttf','.eot','.pdf','.zip','.tar','.gz','.exe','.dll','.so','.pyc']);
    const searchRoot = process.env.SCRIPTS_ROOT ?? '/scripts';
    const root = path.join(searchRoot, slug);

    if (!fs.existsSync(root)) { res.json({ results: [] }); return; }

    // Collect all files recursively
    const allFiles: string[] = [];
    const walk = (dir: string) => {
      if (allFiles.length >= 50) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (allFiles.length >= 50) break;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(fullPath); }
        else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (binaryExts.has(ext)) continue;
          if (allowedExts && !allowedExts.includes(ext)) continue;
          allFiles.push(fullPath);
        }
      }
    };
    walk(root);

    const results: { path: string; matches: { line: number; text: string }[] }[] = [];
    const qLower = q.toLowerCase();

    for (const filePath of allFiles) {
      let text: string;
      try { text = fs.readFileSync(filePath, 'utf8'); } catch { continue; }
      const lines = text.split('\n');
      const matches: { line: number; text: string }[] = [];
      for (let i = 0; i < lines.length && matches.length < 10; i++) {
        if (lines[i].toLowerCase().includes(qLower)) {
          matches.push({ line: i + 1, text: lines[i].slice(0, 200) });
        }
      }
      if (matches.length > 0) {
        const relPath = path.relative(root, filePath).replace(/\\/g, '/');
        results.push({ path: relPath, matches });
      }
    }

    res.json({ results });
  } catch (err) { next(err); }
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

// DELETE /project-file?path=<relative>  ← must be before /:id to avoid param shadowing
router.delete('/project-file', requireProjectAccess as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug, id: projectId } = req.project;
    const relPath = (req.query['path'] as string | undefined) ?? '';
    if (!relPath) { res.status(400).json({ error: 'path is required' }); return; }
    const abs = resolveProjectPath(slug, relPath);
    if (!fs.existsSync(abs)) { res.status(404).json({ error: 'File not found' }); return; }
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      fs.rmSync(abs, { recursive: true, force: true });
      const prefix = relPath.endsWith('/') ? relPath : relPath + '/';
      const scripts: Array<{ id: string; testCaseId: string | null }> = await prisma.script.findMany({
        where: { projectId, filename: { startsWith: prefix } },
        select: { id: true, testCaseId: true },
      });
      if (scripts.length > 0) {
        await prisma.script.deleteMany({ where: { id: { in: scripts.map((s: { id: string }) => s.id) } } });
        await cleanOrphanedTestCases(scripts.map((s: { testCaseId: string | null }) => s.testCaseId));
      }
      await prisma.projectResource.deleteMany({ where: { projectId, filename: { startsWith: prefix } } }).catch(() => {});
    } else {
      fs.unlinkSync(abs);
      const scripts: Array<{ id: string; testCaseId: string | null }> = await prisma.script.findMany({
        where: { projectId, filename: relPath },
        select: { id: true, testCaseId: true },
      });
      if (scripts.length > 0) {
        await prisma.script.deleteMany({ where: { id: { in: scripts.map((s: { id: string }) => s.id) } } });
        await cleanOrphanedTestCases(scripts.map((s: { testCaseId: string | null }) => s.testCaseId));
      }
      await prisma.projectResource.deleteMany({ where: { projectId, filename: relPath } }).catch(() => {});
    }
    res.json({ deleted: relPath });
  } catch (err) { next(err); }
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
      const tcItemId   = (req.body?.tcItemId   as string | undefined) || null;
      const autoCreateTCs = req.body?.autoCreateTCs === 'true';

      const rawContent = req.file.buffer.toString('utf-8');
      let filename = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');

      // ── TC Library link mode: create a Script Library entry + link the TcItem ──
      if (tcItemId) {
        const tcItem = await prisma.tcItem.findFirst({ where: { id: tcItemId, projectId } });
        if (!tcItem) {
          res.status(400).json({ error: 'TC Library item not found in this project' });
          return;
        }

        // Generate a unique TC ID for the new Script Library entry
        const existingIds = await prisma.testCase.findMany({ where: { projectId }, select: { tcId: true } });
        const prefix = slug.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase() || 'TC';
        let counter = existingIds.reduce((max, { tcId }) => {
          const m = tcId.match(/(\d+)$/);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0);
        counter++;
        const newTcId = `${prefix}-${String(counter).padStart(3, '0')}`;

        // Use the TcItem's feature as the use-case group (falls back to Uncategorised)
        const useCaseTag = tcItem.feature?.trim() || null;
        const folderName = useCaseTag ?? 'Uncategorised';

        const libEntry = await prisma.testCase.create({
          data: {
            projectId,
            tcId: newTcId,
            title: tcItem.title,
            description: tcItem.description ?? undefined,
            expectedResult: '',
            type: 'UI',
            status: 'DRAFT',
            ...(useCaseTag ? { useCaseTag } : {}),
          },
        });

        // Build filename and save the .robot file under the feature folder
        filename = buildSystemFilename(libEntry.tcId, libEntry.title, req.file.originalname);
        filename = `TestCases/${folderName}/${filename}`;
        saveScript(slug, filename, rawContent);

        const script = await prisma.script.create({
          data: {
            projectId,
            testCaseId: libEntry.id,
            filename,
            content: rawContent,
            scriptType: 'ROBOT',
            isCustomUpload: true,
          },
        });

        // Link the TcItem to the new Script Library entry
        await prisma.tcItem.update({
          where: { id: tcItemId },
          data: { linkedScriptId: libEntry.id },
        });

        res.status(201).json({
          id: script.id,
          filename: script.filename,
          scriptType: 'ROBOT',
          testCaseId: libEntry.id,
          tcItemId,
          isCustomUpload: true,
          createdAt: script.createdAt,
          tcCreated: 0,
        });
        return;
      }

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
      } else if (autoCreateTCs) {
        // Standalone import — place under TestCases/Uncategorised/ to keep it visible in the project tree
        filename = `TestCases/Uncategorised/${filename}`;
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

      // Auto-create test cases from *** Test Cases *** section when in standalone mode
      let tcCreated = 0;
      if (autoCreateTCs && !testCaseId) {
        const tcNames: string[] = [];
        let inTcSection = false;
        for (const line of rawContent.split('\n')) {
          if (/^\*+\s*Test Cases\s*\**/i.test(line.trim())) { inTcSection = true; continue; }
          if (/^\*+\s/.test(line.trim()) && inTcSection) { inTcSection = false; continue; }
          if (inTcSection && line.trim() && !line.trim().startsWith('#') && !/^\s/.test(line)) {
            tcNames.push(line.trim());
          }
        }
        const existingIds = await prisma.testCase.findMany({ where: { projectId }, select: { tcId: true } });
        const uploadPrefix = req.project.slug.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase() || 'TC';
        let uploadCounter = existingIds.reduce((max, { tcId }) => {
          const m = tcId.match(/(\d+)$/);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0);
        for (const name of tcNames) {
          const existing = await prisma.testCase.findFirst({ where: { projectId, title: name } });
          if (!existing) {
            uploadCounter++;
            await prisma.testCase.create({
              data: {
                projectId,
                tcId: `${uploadPrefix}-${String(uploadCounter).padStart(3, '0')}`,
                title: name, type: 'UI', status: 'DRAFT', expectedResult: '',
                scripts: { connect: { id: script.id } },
              },
            });
            tcCreated++;
          }
        }
      }

      res.status(201).json({
        id: script.id,
        filename: script.filename,
        scriptType: 'ROBOT',
        testCaseId: script.testCaseId,
        isCustomUpload: true,
        createdAt: script.createdAt,
        tcCreated,
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

    const buffer = exportZip(req.project.slug, filenames);
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

// ── GET /file-tree — return full project folder tree for the Project Files panel ──────────────

const SCRIPTS_ROOT_FT = process.env.SCRIPTS_ROOT ?? '/scripts';

const TREE_SKIP_DIRS = new Set([
  '__pycache__', '.git', 'node_modules', '.venv', 'venv', '.idea', '.github',
  'log', 'logs', 'rerun_results', 'rerun',
]);
const TREE_SKIP_EXTS = new Set(['.html', '.xml', '.pyc', '.pyo']);
const TREE_SKIP_FILES = new Set(['log.html', 'output.xml', 'report.html', 'debug.xml', 'xunit.xml']);

interface FileTreeNode {
  name: string;
  path: string; // relative to project root
  type: 'file' | 'dir';
  children?: FileTreeNode[];
  ext?: string;
}

function buildFileTree(dir: string, baseDir: string): FileTreeNode[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const nodes: FileTreeNode[] = [];
  for (const entry of entries) {
    const rel = path.relative(baseDir, path.join(dir, entry.name)).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (TREE_SKIP_DIRS.has(entry.name) || entry.name.startsWith('.') || /^downloads_/i.test(entry.name)) continue;
      const children = buildFileTree(path.join(dir, entry.name), baseDir);
      nodes.push({ name: entry.name, path: rel, type: 'dir', children });
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (TREE_SKIP_EXTS.has(ext) || TREE_SKIP_FILES.has(entry.name)) continue;
      nodes.push({ name: entry.name, path: rel, type: 'file', ext });
    }
  }
  // dirs first, then files, each sorted alphabetically
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

router.get('/file-tree', requireProjectAccess as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.project;
    const root = path.join(SCRIPTS_ROOT_FT, slug);
    const tree = buildFileTree(root, root);
    res.json({ tree, root: slug });
  } catch (err) { next(err); }
});

// ── Project file management endpoints ────────────────────────────────────────

// Helper: resolve + validate a relative path stays inside the project root
function resolveProjectPath(slug: string, relPath: string): string {
  const root = path.join(SCRIPTS_ROOT_FT, slug);
  const abs = path.resolve(path.join(root, relPath));
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw Object.assign(new Error('Invalid path'), { status: 400 });
  }
  return abs;
}

// GET /project-file/download?path=<relative>
router.get('/project-file/download', requireProjectAccess as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug, id: projectId } = req.project;
    const relPath = (req.query['path'] as string | undefined) ?? '';
    if (!relPath) { res.status(400).json({ error: 'path is required' }); return; }
    const abs = resolveProjectPath(slug, relPath);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.status(404).json({ error: 'File not found' }); return; }
    res.download(abs, path.basename(abs));
  } catch (err) { next(err); }
});

// POST /project-file/move  { from: string, to: string }
router.post('/project-file/move', requireProjectAccess as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug, id: projectId } = req.project;
    const { from, to } = req.body as { from?: string; to?: string };
    if (!from || !to) { res.status(400).json({ error: 'from and to are required' }); return; }
    const absFrom = resolveProjectPath(slug, from);
    const absTo   = resolveProjectPath(slug, to);
    if (!fs.existsSync(absFrom)) { res.status(404).json({ error: 'Source not found' }); return; }
    if (fs.existsSync(absTo)) { res.status(409).json({ error: 'Destination already exists' }); return; }
    const isDir = fs.statSync(absFrom).isDirectory();
    fs.mkdirSync(path.dirname(absTo), { recursive: true });
    fs.renameSync(absFrom, absTo);

    if (isDir) {
      // Update filenames for every script under the moved directory
      const fromPrefix = from.endsWith('/') ? from : from + '/';
      const toPrefix   = to.endsWith('/') ? to : to + '/';
      const affected = await prisma.script.findMany({
        where: { projectId, filename: { startsWith: fromPrefix } },
        select: { id: true, filename: true },
      });
      for (const s of affected) {
        const newFilename = toPrefix + s.filename.slice(fromPrefix.length);
        await prisma.script.update({ where: { id: s.id }, data: { filename: newFilename } }).catch(() => {});
      }
      // If a TestCases sub-folder was renamed, sync useCaseTag for all TCs in that folder
      const fromParts = from.split('/');
      const toParts   = to.split('/');
      if (fromParts.length === 2 && /^TestCases$/i.test(fromParts[0]) && toParts.length === 2) {
        await prisma.testCase.updateMany({
          where: { projectId, useCaseTag: fromParts[1] },
          data: { useCaseTag: toParts[1] },
        }).catch(() => {});
      }
    } else {
      await prisma.script.updateMany({ where: { projectId, filename: from }, data: { filename: to } }).catch(() => {});
      // If a .robot file was moved between TestCases sub-folders, sync its TestCase's useCaseTag
      const fromParts = from.split('/');
      const toParts   = to.split('/');
      if (
        fromParts.length >= 3 && /^TestCases$/i.test(fromParts[0]) &&
        toParts.length >= 3 && /^TestCases$/i.test(toParts[0]) &&
        fromParts[1] !== toParts[1]
      ) {
        const script = await prisma.script.findFirst({ where: { projectId, filename: to } });
        if (script?.testCaseId) {
          await prisma.testCase.update({
            where: { id: script.testCaseId },
            data: { useCaseTag: toParts[1] },
          }).catch(() => {});
        }
      }
    }
    res.json({ from, to });
  } catch (err) { next(err); }
});

// POST /project-file/mkdir  { folder: string }
router.post('/project-file/mkdir', requireProjectAccess as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.project;
    const folder = ((req.body?.folder as string | undefined) ?? '').replace(/^\/+|\/+$/g, '');
    if (!folder) { res.status(400).json({ error: 'folder is required' }); return; }
    const abs = resolveProjectPath(slug, folder);
    if (fs.existsSync(abs)) { res.status(409).json({ error: 'Folder already exists' }); return; }
    fs.mkdirSync(abs, { recursive: true });
    res.status(201).json({ folder });
  } catch (err) { next(err); }
});

// POST /project-file/upload  (multipart: file + path)
const projectFileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
router.post('/project-file/upload', requireProjectAccess as RequestHandler, projectFileUpload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'file is required' }); return; }
    const { slug, id: projectId } = req.project;
    const folder = ((req.body?.folder as string | undefined) ?? '').replace(/^\/+|\/+$/g, '');
    const filename = req.file.originalname.replace(/[^a-zA-Z0-9._\-() ]/g, '_');
    const relPath = folder ? `${folder}/${filename}` : filename;
    const abs = resolveProjectPath(slug, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, req.file.buffer);
    // Register in DB if it's a non-robot file
    if (!filename.endsWith('.robot')) {
      await prisma.projectResource.upsert({
        where: { projectId_filename: { projectId, filename: relPath } },
        create: { projectId, filename: relPath, originalName: filename, size: req.file.size },
        update: { size: req.file.size },
      }).catch(() => {});
    }
    res.status(201).json({ path: relPath, filename, size: req.file.size });
  } catch (err) { next(err); }
});

// ── POST /import-folder — receive zip upload, extract, parse .robot files, auto-create test cases

const folderUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

router.post('/import-folder', requireProjectAccess as RequestHandler, folderUpload.single('folder'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'A zip file is required (field: folder)' }); return; }
    const { slug, id: projectId } = req.project;
    const zip = new AdmZip(req.file.buffer);
    const entries = zip.getEntries();
    const scriptsRoot = process.env.SCRIPTS_ROOT ?? '/scripts';

    // Everything lands under the project root — preserving the original folder structure so that
    // relative Resource/Library paths in .robot files continue to resolve correctly at runtime.
    const projectRootDir = path.join(scriptsRoot, slug);
    fs.mkdirSync(projectRootDir, { recursive: true });

    const results: { filename: string; testCasesCreated: number }[] = [];
    const warnings: string[] = [];

    // Pre-fetch max tcId number so we can generate sequential IDs across all files
    const existingTcIds = await prisma.testCase.findMany({ where: { projectId }, select: { tcId: true } });
    const tcPrefix = slug.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase() || 'TC';
    let tcCounter = existingTcIds.reduce((max, { tcId }) => {
      const m = tcId.match(/(\d+)$/);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);

    // ── Noise filters ──────────────────────────────────────────────────────
    // Dirs to skip entirely
    const SKIP_DIRS = new Set([
      '__pycache__', '.git', 'node_modules', '.venv', 'venv', '.idea', '.github',
      'log', 'logs', 'rerun_results', 'rerun',
    ]);
    // File extensions that are RF run artifacts or compiled bytecode — never useful
    const SKIP_EXTS = new Set(['.html', '.xml', '.pyc', '.pyo']);
    // Specific artifact filenames (belt-and-suspenders for .html/.xml above)
    const SKIP_FILES = new Set(['log.html', 'output.xml', 'report.html', 'debug.xml', 'xunit.xml', 'output2.xml']);

    const shouldSkipSegment = (seg: string) =>
      SKIP_DIRS.has(seg) || seg.startsWith('.') || /^downloads_/i.test(seg);

    // ── Strip single top-level root folder if the whole zip is inside one ──
    const topLevel = entries
      .filter((e) => !e.isDirectory)
      .map((e) => e.entryName.replace(/\\/g, '/').split('/')[0])
      .reduce<string | null>((acc, seg) => (acc === undefined || acc === seg ? seg : null), undefined as unknown as null);
    const stripPrefix = topLevel ? topLevel + '/' : '';

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const rawName = entry.entryName.replace(/\\/g, '/');
      const segments = rawName.split('/');

      // Skip any path that passes through a noisy directory
      if (segments.some((seg) => shouldSkipSegment(seg))) continue;

      // Strip single root folder prefix
      const entryName = rawName.startsWith(stripPrefix) ? rawName.slice(stripPrefix.length) : rawName;
      if (!entryName) continue;

      const filename = path.basename(entryName);
      const ext = path.extname(filename).toLowerCase();

      // Skip run-artifact file types and known noisy filenames
      if (SKIP_EXTS.has(ext) || SKIP_FILES.has(filename)) continue;

      // Destination: preserve the full relative path under the project root
      const destPath = path.join(projectRootDir, entryName);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, entry.getData());

      // Only .robot files inside TestCases get DB script records + TC auto-creation.
      // All other files (resource .robot files, xlsx, yaml, etc.) are written to disk above and skipped here.
      const isTestScript = filename.endsWith('.robot') &&
        /\/(TestCases)\//i.test('/' + entryName);

      if (!isTestScript) continue;

      // ── .robot test script ────────────────────────────────────────────────
      const content = entry.getData().toString('utf-8');

      // Derive use-case group from folder structure.
      // e.g. "TestCases/Primary Sales & Return/TC01.robot" → "Primary Sales & Return"
      const pathParts = entryName.split('/');
      const useCaseTag: string | null =
        pathParts.length >= 3 && /^TestCases$/i.test(pathParts[0])
          ? pathParts[1]
          : null;

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

      // Upsert script — filename is the full relative path (e.g. TestCases/Primary Sales/TC01.robot)
      const script = await prisma.script.upsert({
        where: { projectId_filename: { projectId, filename: entryName } },
        create: { projectId, filename: entryName, content, scriptType: 'ROBOT' },
        update: { content },
      });

      // Auto-create test cases, grouped under the use-case derived from the folder name
      let tcCreated = 0;
      for (const name of tcNames) {
        const existing = await prisma.testCase.findFirst({
          where: {
            projectId,
            title: name,
            // Scope duplicate-name check to the same use-case folder so that
            // the same TC name under different folders creates separate records.
            ...(useCaseTag ? { useCaseTag } : {}),
          },
          include: { scripts: { select: { id: true } } },
        });
        if (!existing) {
          tcCounter++;
          await prisma.testCase.create({
            data: {
              projectId,
              tcId: `${tcPrefix}-${String(tcCounter).padStart(3, '0')}`,
              title: name, type: 'UI', status: 'DRAFT', expectedResult: '',
              ...(useCaseTag ? { useCaseTag } : {}),
              scripts: { connect: { id: script.id } },
            },
          });
          tcCreated++;
        } else {
          // TC already exists — ensure it is linked to this script and backfill useCaseTag
          const alreadyLinked = existing.scripts.some((s) => s.id === script.id);
          if (!alreadyLinked) {
            await prisma.testCase.update({ where: { id: existing.id }, data: { scripts: { connect: { id: script.id } } } });
          }
          if (useCaseTag && !existing.useCaseTag) {
            await prisma.testCase.update({ where: { id: existing.id }, data: { useCaseTag } });
          }
        }
      }
      results.push({ filename: entryName, testCasesCreated: tcCreated });
    }

    res.json({ imported: results, warnings });
  } catch (err) { next(err); }
});

export default router;
