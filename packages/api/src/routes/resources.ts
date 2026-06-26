'use strict';
import { Router, RequestHandler } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import fs from 'fs';
import path from 'path';
import {
  saveResourceFile,
  deleteResourceFile,
  listResourceFiles,
  resourcesDir,
  extractRobotKeywordsWithLines,
  BINARY_EXTS,
} from '../services/scriptFileService.js';

const router = Router({ mergeParams: true });
const SCRIPTS_ROOT = process.env.SCRIPTS_ROOT ?? '/scripts';

router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── Helpers ───────────────────────────────────────────────────────────────

/** The project's slug — used as the filesystem directory name under /scripts. */
function projectSlug(req: any): string {
  return req.project?.slug ?? req.params.projectId;
}

/**
 * Full container path for a resource file:
 *   /scripts/{slug}/resources/{relative_filename}
 * This is what RF scripts should use in Resource/Variables/Library declarations.
 */
function containerPath(slug: string, filename: string): string {
  return `${SCRIPTS_ROOT}/${slug}/resources/${filename}`;
}

/** Container path for a folder (no trailing slash). */
function containerFolderPath(slug: string, folderPath: string): string {
  return folderPath
    ? `${SCRIPTS_ROOT}/${slug}/resources/${folderPath}`
    : `${SCRIPTS_ROOT}/${slug}/resources`;
}

// ── Multer — text + binary files up to 50 MB ─────────────────────────────

const ALLOWED_RESOURCE_EXTS = new Set([
  '.robot', '.resource', '.py', '.yaml', '.yml', '.txt', '.csv', '.tsv', '.json', '.xml',
  '.xlsx', '.xls', '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp',
]);

const resourceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
    if (ALLOWED_RESOURCE_EXTS.has(ext)) cb(null, true);
    else cb(new Error(`File type not allowed. Allowed: ${[...ALLOWED_RESOURCE_EXTS].join(', ')}`));
  },
});

// ── GET / — list resource files ───────────────────────────────────────────

router.get('/', (async (req, res) => {
  const { projectId } = req.params;
  const slug = projectSlug(req);
  try {
    const fsMeta = listResourceFiles(slug);
    const rows = await prisma.projectResource.findMany({ where: { projectId } });
    const dbMap = new Map(rows.map((r) => [r.filename, r]));

    const result = fsMeta.map((f) => {
      const row = dbMap.get(f.filename);
      return {
        id:            row?.id ?? f.filename,
        filename:      f.filename,
        originalName:  row?.originalName ?? path.basename(f.filename),
        size:          f.size,
        uploadedAt:    row?.uploadedAt.toISOString() ?? new Date(0).toISOString(),
        containerPath: containerPath(slug, f.filename),
        isBinary:      f.isBinary,
      };
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

// ── POST /mkdir — create a new folder ────────────────────────────────────

router.post('/mkdir', (async (req, res) => {
  const { projectId } = req.params;
  const slug = projectSlug(req);
  const { path: folderPath } = req.body as { path?: string };
  if (!folderPath || typeof folderPath !== 'string') {
    res.status(400).json({ error: 'path is required' });
    return;
  }
  const segments = folderPath.split('/').filter(Boolean);
  if (segments.some(s => s === '..' || s === '.')) {
    res.status(400).json({ error: 'Invalid folder path' });
    return;
  }
  const normalized = segments.join('/');
  const fullPath = path.join(resourcesDir(slug), normalized);
  try {
    fs.mkdirSync(fullPath, { recursive: true });
    const keepFile = path.join(fullPath, '.gitkeep');
    if (!fs.existsSync(keepFile)) fs.writeFileSync(keepFile, '', 'utf-8');
    res.json({
      ok: true,
      path: normalized,
      containerPath: containerFolderPath(slug, normalized),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

// ── POST / — upload a resource file ──────────────────────────────────────

router.post('/', resourceUpload.single('file'), (async (req, res) => {
  const { projectId } = req.params;
  const slug = projectSlug(req);
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const originalName = req.file.originalname;
  const basename = originalName.replace(/[^a-zA-Z0-9._\- ()]/g, '_');
  const rawFolder = ((req.body as Record<string, string>).folder ?? '').trim();
  const folder = rawFolder
    .split('/').filter(Boolean)
    .filter(s => s !== '..' && s !== '.')
    .join('/');
  const filename = folder ? `${folder}/${basename}` : basename;

  try {
    saveResourceFile(slug, filename, req.file.buffer);

    const isBinary = BINARY_EXTS.has(path.extname(originalName).toLowerCase());
    const record = await prisma.projectResource.upsert({
      where:  { projectId_filename: { projectId, filename } },
      update: { originalName, size: req.file.size, uploadedAt: new Date() },
      create: { projectId, filename, originalName, size: req.file.size },
    });

    res.status(201).json({
      id:            record.id,
      filename:      record.filename,
      originalName:  record.originalName,
      size:          record.size,
      uploadedAt:    record.uploadedAt.toISOString(),
      containerPath: containerPath(slug, filename),
      isBinary,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

// ── GET /:filename/content — read resource file text ─────────────────────
// Supports nested paths: Resource/PageKeywords/Common.robot

router.get(/^\/(.+)\/content$/, (async (req, res) => {
  const { projectId: _projectId } = req.params as unknown as { projectId: string };
  const filename = (req.params as unknown as Record<string, string>)[0];
  const slug = projectSlug(req);
  const ext = path.extname(filename).toLowerCase();
  if (BINARY_EXTS.has(ext)) {
    res.status(415).json({ error: 'Binary file — use the download endpoint instead.' });
    return;
  }
  const base = path.resolve(resourcesDir(slug));
  const filePath = path.resolve(path.join(resourcesDir(slug), filename));
  if (!filePath.startsWith(base + path.sep) && filePath !== base) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Resource file not found' });
    return;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

// ── PUT /:filename/content — save resource file text ─────────────────────

router.put(/^\/(.+)\/content$/, (async (req, res) => {
  const { projectId } = req.params as unknown as { projectId: string };
  const filename = (req.params as unknown as Record<string, string>)[0];
  const slug = projectSlug(req);
  const { content } = req.body as { content?: string };
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content is required' });
    return;
  }
  const base = path.resolve(resourcesDir(slug));
  const filePath = path.resolve(path.join(resourcesDir(slug), filename));
  if (!filePath.startsWith(base + path.sep) && filePath !== base) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Resource file not found' });
    return;
  }
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    await prisma.projectResource.updateMany({
      where: { projectId, filename },
      data: { size: Buffer.byteLength(content, 'utf-8') },
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

// ── GET /:filename/download — download any resource file (incl. binary) ──

router.get(/^\/(.+)\/download$/, (async (req, res) => {
  const filename = (req.params as unknown as Record<string, string>)[0];
  const slug = projectSlug(req);
  const base = path.resolve(resourcesDir(slug));
  const filePath = path.resolve(path.join(resourcesDir(slug), filename));
  if (!filePath.startsWith(base + path.sep) && filePath !== base) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Resource file not found' });
    return;
  }
  try {
    res.download(filePath, path.basename(filename));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

// ── POST /init-defaults — auto-create starter resource files ─────────────

const DEFAULT_RESOURCES: Array<{ filename: string; content: string }> = [
  {
    filename: 'common_keywords.robot',
    content: `*** Settings ***
Library    Browser

*** Keywords ***
Login As User
    [Arguments]    \${username}    \${password}
    Navigate To    \${LOGIN_URL}
    Fill Text      id=username    \${username}
    Fill Text      id=password    \${password}
    Click          id=submit-btn
    Wait For Elements State    css=.dashboard-header    visible    \${TIMEOUT}

Accept Cookie Banner
    Run Keyword And Ignore Error    Click    css=.cookie-accept

Wait For Page Ready
    [Arguments]    \${state}=networkidle
    Wait For Load State    \${state}
`,
  },
  {
    filename: 'variables.robot',
    content: `*** Variables ***
\${BASE_URL}          \${EMPTY}
\${LOGIN_URL}         \${BASE_URL}/login
\${TC_USERNAME}       \${EMPTY}
\${TC_PASSWORD}       \${EMPTY}
\${TIMEOUT}           30s
\${BROWSER}           chromium
\${SCREENSHOT_DIR}    \${OUTPUTDIR}
`,
  },
  {
    filename: 'navigation_helpers.robot',
    content: `*** Settings ***
Library    Browser

*** Keywords ***
Go To Dashboard
    Navigate To    \${BASE_URL}/dashboard
    Wait For Load State    networkidle

Go To Settings
    Navigate To    \${BASE_URL}/settings
    Wait For Load State    networkidle

Go To Login
    Navigate To    \${LOGIN_URL}
    Wait For Elements State    id=username    visible    \${TIMEOUT}
`,
  },
  {
    filename: 'assertions.robot',
    content: `*** Settings ***
Library    Browser
Library    String

*** Keywords ***
Assert Page Title Contains
    [Arguments]    \${expected}
    \${title}=    Get Title
    Should Contain    \${title}    \${expected}

Assert URL Contains
    [Arguments]    \${fragment}
    \${url}=    Get Url
    Should Contain    \${url}    \${fragment}

Assert Element Text Equals
    [Arguments]    \${locator}    \${expected}
    \${text}=    Get Text    \${locator}
    Should Be Equal    \${text}    \${expected}

Assert Element Visible
    [Arguments]    \${locator}
    Wait For Elements State    \${locator}    visible    \${TIMEOUT}

Assert Element Hidden
    [Arguments]    \${locator}
    Wait For Elements State    \${locator}    hidden    \${TIMEOUT}
`,
  },
];

router.post('/init-defaults', (async (req, res) => {
  const { projectId } = req.params;
  const slug = projectSlug(req);
  const created: string[] = [];
  const skipped: string[] = [];

  try {
    for (const { filename, content } of DEFAULT_RESOURCES) {
      const filePath = path.join(resourcesDir(slug), filename);
      if (fs.existsSync(filePath)) {
        skipped.push(filename);
        continue;
      }
      const buf = Buffer.from(content, 'utf-8');
      saveResourceFile(slug, filename, buf);
      await prisma.projectResource.upsert({
        where:  { projectId_filename: { projectId, filename } },
        update: { originalName: filename, size: buf.length, uploadedAt: new Date() },
        create: { projectId, filename, originalName: filename, size: buf.length },
      });
      created.push(filename);
    }
    res.json({ created, skipped });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

// ── GET /health — resource health stats ──────────────────────────────────

router.get('/health', (async (req, res) => {
  const { projectId } = req.params;
  const slug = projectSlug(req);
  try {
    const resources = listResourceFiles(slug);
    const scriptDir = path.join(SCRIPTS_ROOT, projectId);

    let scriptCount = 0;
    const keywordUsage: Record<string, number> = {};
    if (fs.existsSync(scriptDir)) {
      const robotFiles = fs.readdirSync(scriptDir).filter(f => f.endsWith('.robot'));
      scriptCount = robotFiles.length;
      for (const rf of robotFiles) {
        const content = fs.readFileSync(path.join(scriptDir, rf), 'utf-8');
        for (const r of resources) {
          const base = r.filename.replace(/\.robot$/, '');
          if (content.includes(`resources/${r.filename}`) || content.includes(base)) {
            keywordUsage[r.filename] = (keywordUsage[r.filename] ?? 0) + 1;
          }
        }
      }
    }

    const healthData = resources
      .filter(r => !r.isBinary)
      .map(r => {
        const filePath = path.join(resourcesDir(slug), r.filename);
        const stat = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf-8');
        const keywordMatches = content.match(/^[A-Za-z][^\n]+\n(?:    |\t)/gm) ?? [];
        return {
          filename:      r.filename,
          size:          r.size,
          lastUpdated:   stat.mtime.toISOString(),
          keywordCount:  keywordMatches.length,
          usedInScripts: keywordUsage[r.filename] ?? 0,
        };
      });

    res.json({ scriptCount, resources: healthData });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

// ── GET /keywords/index — keyword-name → {filename, line} map ────────────

router.get('/keywords/index', (async (req, res) => {
  const slug = projectSlug(req);
  try {
    const projectRoot = path.join(SCRIPTS_ROOT, slug);
    const index: Record<string, { filename: string; line: number }> = {};

    function walk(dir: string) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        const ext = path.extname(entry.name).toLowerCase();
        if (ext !== '.robot' && ext !== '.resource') continue;
        const relPath = path.relative(projectRoot, full).replace(/\\/g, '/');
        try {
          const content = fs.readFileSync(full, 'utf-8');
          for (const kw of extractRobotKeywordsWithLines(content)) {
            if (!index[kw.name]) {
              index[kw.name] = { filename: relPath, line: kw.line };
            }
          }
        } catch { /* skip unreadable files */ }
      }
    }

    walk(projectRoot);
    res.json(index);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

// ── POST /rmdir — delete a folder and all its contents ───────────────────

router.post('/rmdir', (async (req, res) => {
  const { projectId } = req.params;
  const slug = projectSlug(req);
  const { path: folderPath } = req.body as { path?: string };
  if (!folderPath || typeof folderPath !== 'string') {
    res.status(400).json({ error: 'path is required' });
    return;
  }
  const segments = folderPath.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some(s => s === '..' || s === '.')) {
    res.status(400).json({ error: 'Invalid folder path' });
    return;
  }
  const normalized = segments.join('/');
  const fullPath = path.join(resourcesDir(slug), normalized);
  const resDir = resourcesDir(slug);
  if (!fullPath.startsWith(resDir + path.sep) && fullPath !== resDir) {
    res.status(400).json({ error: 'Invalid folder path' });
    return;
  }
  try {
    await prisma.projectResource.deleteMany({
      where: { projectId, filename: { startsWith: normalized + '/' } },
    });
    fs.rmSync(fullPath, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

// ── POST /move — move a resource file to a different folder ───────────────

router.post('/move', (async (req, res) => {
  const { projectId } = req.params;
  const slug = projectSlug(req);
  const { filename, destination } = req.body as { filename?: string; destination?: string };
  if (!filename) {
    res.status(400).json({ error: 'filename is required' });
    return;
  }
  const destFolder = (destination ?? '').trim();
  const basename = filename.split('/').pop()!;
  const newFilename = destFolder ? `${destFolder}/${basename}` : basename;

  if (newFilename === filename) {
    res.json({ ok: true, filename: newFilename });
    return;
  }

  const resDir = resourcesDir(slug);
  const srcPath = path.join(resDir, filename);
  const dstPath = path.join(resDir, newFilename);

  if (!srcPath.startsWith(resDir + path.sep) || !dstPath.startsWith(resDir + path.sep)) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }

  try {
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });
    fs.renameSync(srcPath, dstPath);
    const stat = fs.statSync(dstPath);
    await prisma.projectResource.updateMany({
      where: { projectId, filename },
      data: { filename: newFilename, size: stat.size },
    });
    res.json({ ok: true, filename: newFilename, containerPath: containerPath(slug, newFilename) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

// ── DELETE /:filename — remove a resource file ────────────────────────────

router.delete(/^\/(.+)$/, (async (req, res) => {
  const { projectId } = req.params as unknown as { projectId: string };
  const filename = (req.params as unknown as Record<string, string>)[0];
  const slug = projectSlug(req);
  const base = path.resolve(resourcesDir(slug));
  const resolvedPath = path.resolve(path.join(resourcesDir(slug), filename));
  if (!resolvedPath.startsWith(base + path.sep) && resolvedPath !== base) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }
  try {
    deleteResourceFile(slug, filename);
    await prisma.projectResource.deleteMany({ where: { projectId, filename } });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

export default router;
