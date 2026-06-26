import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

const SCRIPTS_ROOT = process.env.SCRIPTS_ROOT ?? '/scripts';

// Project root — the top-level directory for a project (holds full folder structure for hierarchy imports)
function projectRoot(slug: string): string {
  return path.join(SCRIPTS_ROOT, slug);
}

// Legacy flat scripts subdir — single-file uploads still land here
function projectDir(slug: string): string {
  return path.join(SCRIPTS_ROOT, slug, 'scripts');
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

// Resolve the on-disk path for a script filename.
// Hierarchy imports store filename as a relative path (e.g. TestCases/foo/TC01.robot).
// Flat uploads store just the basename (e.g. TC01.robot) under the scripts/ subdir.
function resolveScriptPath(slug: string, filename: string): string {
  const rootPath = path.join(projectRoot(slug), filename);
  if (fs.existsSync(rootPath)) return rootPath;
  return path.join(projectDir(slug), filename); // fallback to legacy flat location
}

export function saveScript(slug: string, filename: string, content: string): void {
  // Hierarchy filenames (contain path separators) go under project root; flat filenames go under scripts/ subdir
  const dest = filename.includes('/') || filename.includes(path.sep)
    ? path.join(projectRoot(slug), filename)
    : path.join(projectDir(slug), filename);
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, content, 'utf-8');
}

export function readScript(slug: string, filename: string): string {
  const filePath = resolveScriptPath(slug, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Script file not found: ${filename}`);
  return fs.readFileSync(filePath, 'utf-8');
}

export function deleteScript(slug: string, filename: string): void {
  const filePath = resolveScriptPath(slug, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export interface ScriptFileMeta {
  filename: string;
  size: number;
  modifiedAt: string;
}

// Dirs that should never be scanned for scripts
const SCAN_SKIP_DIRS = new Set([
  '__pycache__', '.git', 'node_modules', '.venv', 'venv', '.idea', '.github',
  'log', 'logs', 'rerun_results', 'rerun',
]);

function shouldSkipDir(name: string): boolean {
  return SCAN_SKIP_DIRS.has(name) || name.startsWith('.') || /^downloads_/i.test(name);
}

// Recursively find all .robot files under a directory, returning relative paths from baseDir.
function scanRobotFiles(dir: string, baseDir: string): ScriptFileMeta[] {
  if (!fs.existsSync(dir)) return [];
  const results: ScriptFileMeta[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {
        results.push(...scanRobotFiles(path.join(dir, entry.name), baseDir));
      }
    } else if (entry.isFile() && entry.name.endsWith('.robot')) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(baseDir, abs).replace(/\\/g, '/');
      const stat = fs.statSync(abs);
      results.push({ filename: rel, size: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
  }
  return results;
}

export function listScriptFiles(slug: string): ScriptFileMeta[] {
  const root = projectRoot(slug);
  return scanRobotFiles(root, root);
}

export function getScriptFileMeta(slug: string, filename: string): ScriptFileMeta | null {
  const filePath = resolveScriptPath(slug, filename);
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return { filename, size: stat.size, modifiedAt: stat.mtime.toISOString() };
}

export function exportZip(slug: string, filenames?: string[]): Buffer {
  const zip = new AdmZip();
  const root = projectRoot(slug);

  // Add all .robot files (or only the requested subset), preserving folder structure
  const all = listScriptFiles(slug);
  const toExport = filenames
    ? all.filter((m) => filenames.includes(m.filename) || filenames.includes(path.basename(m.filename)))
    : all;

  for (const meta of toExport) {
    const abs = path.join(root, meta.filename);
    if (fs.existsSync(abs)) {
      zip.addFile(meta.filename, fs.readFileSync(abs));
    }
  }

  // Include the full resource tree (non-.robot files)
  const addDirToZip = (dir: string, zipPrefix: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) {
          addDirToZip(path.join(dir, entry.name), `${zipPrefix}${entry.name}/`);
        }
      } else if (entry.isFile() && !entry.name.endsWith('.robot')) {
        const abs = path.join(dir, entry.name);
        zip.addFile(`${zipPrefix}${entry.name}`, fs.readFileSync(abs));
      }
    }
  };

  // Only recurse into known resource dirs to avoid bundling huge venv/node_modules
  for (const subdir of ['Resource', 'resources', 'TextFiles', 'PageObjects']) {
    addDirToZip(path.join(root, subdir), `${subdir}/`);
  }

  return zip.toBuffer();
}

// ── Resource file helpers ─────────────────────────────────────────────────

export function resourcesDir(projectId: string): string {
  return path.join(SCRIPTS_ROOT, projectId, 'resources');
}

export function saveResourceFile(projectId: string, filename: string, buffer: Buffer): void {
  const filePath = path.join(resourcesDir(projectId), filename);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, buffer);
}

export function deleteResourceFile(projectId: string, filename: string): void {
  const filePath = path.join(resourcesDir(projectId), filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export const BINARY_EXTS = new Set(['.xlsx', '.xls', '.pdf', '.pyc', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.tar', '.gz']);
const SKIP_DIRS = new Set(['__pycache__', '.git', 'node_modules', 'venv', '.venv']);

export function listResourceFiles(identifier: string): { filename: string; size: number; isBinary: boolean }[] {
  const dir = resourcesDir(identifier);
  if (!fs.existsSync(dir)) return [];

  function scan(current: string, prefix: string): { filename: string; size: number; isBinary: boolean }[] {
    return fs.readdirSync(current).flatMap((entry) => {
      const full = path.join(current, entry);
      const stat = fs.statSync(full);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if (stat.isDirectory()) {
        if (SKIP_DIRS.has(entry)) return [];
        return scan(full, rel);
      }
      const isBinary = BINARY_EXTS.has(path.extname(entry).toLowerCase());
      return [{ filename: rel, size: stat.size, isBinary }];
    });
  }

  return scan(dir, '');
}

export function readResourceFile(projectId: string, filename: string): string {
  const filePath = path.join(resourcesDir(projectId), filename);
  if (!fs.existsSync(filePath)) throw new Error(`Resource file not found: ${filename}`);
  return fs.readFileSync(filePath, 'utf-8');
}

export interface RFKeywordLocation {
  name: string;
  line: number; // 1-based
}

/**
 * Rewrites relative Variables / Resource / Library paths in a .robot file to absolute
 * container paths (/scripts/{slug}/resources/...) when the referenced file exists in
 * the project's resources directory. Only operates within the *** Settings *** section.
 */
export function rewriteRobotResourcePaths(
  content: string,
  slug: string,
): { content: string; rewrites: string[] } {
  const resDir = resourcesDir(slug);
  const projectRoot = path.join(SCRIPTS_ROOT, slug);
  const rewrites: string[] = [];

  // Matches RF settings directives: indent + keyword + separator (2+ spaces or tab) + first token + rest
  const DIRECTIVE_RE = /^(\s*)(Variables|Resource|Library|Resource\s+File)(\s{2,}|\t+)(\S+)(.*)/i;

  let inSettings = false;

  const result = content.split('\n').map((line) => {
    const trimmed = line.trim();

    // Track which section we're in
    if (/^\*{3}/.test(trimmed)) {
      inSettings = /\*{3}\s*Settings\s*\*{3}/i.test(trimmed);
      return line;
    }
    if (!inSettings || trimmed === '' || trimmed.startsWith('#')) return line;

    const m = line.match(DIRECTIVE_RE);
    if (!m) return line;

    const [, indent, directive, sep, pathToken, rest] = m;

    // Already an absolute /scripts/ path — leave it alone
    if (pathToken.startsWith('/scripts/')) return line;

    // Library without a file extension and no path separator is a Python module name — skip
    const hasPathSep = pathToken.includes('/') || pathToken.includes('\\');
    const hasFileExt = /\.(py|robot|resource|txt)$/i.test(pathToken);
    if (!hasFileExt && !hasPathSep) return line;

    // Normalise separators, strip leading ../ and ./
    let rel = pathToken.replace(/\\/g, '/');
    while (rel.startsWith('../')) rel = rel.slice(3);
    while (rel.startsWith('./')) rel = rel.slice(2);

    // Strip a leading resources/ folder name (case-insensitive) since we know where it lives
    const relUnderRes = rel.replace(/^[Rr]esources?\//, '');

    // Try candidates in order of specificity
    const candidates: [string, string][] = [
      [path.join(resDir, relUnderRes), relUnderRes],          // under resources/, sans prefix
      [path.join(projectRoot, rel), rel],                     // from project root as-is
      [path.join(resDir, path.basename(pathToken)), path.basename(pathToken)], // bare filename
    ];

    let found: string | null = null;
    for (const [absCandidate, relCandidate] of candidates) {
      if (fs.existsSync(absCandidate)) {
        found = relCandidate;
        break;
      }
    }

    if (!found) return line;

    const absPath = `/scripts/${slug}/resources/${found}`;
    rewrites.push(`${pathToken} → ${absPath}`);
    return `${indent}${directive}${sep}${absPath}${rest}`;
  });

  return { content: result.join('\n'), rewrites };
}

/** Extracts Robot Framework keyword names with their 1-based line numbers from file content. */
export function extractRobotKeywordsWithLines(content: string): RFKeywordLocation[] {
  const results: RFKeywordLocation[] = [];
  let inKeywords = false;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('*** Keywords ***')) { inKeywords = true; continue; }
    if (trimmed.startsWith('***')) { inKeywords = false; continue; }
    if (inKeywords && line.length > 0 && line[0] !== ' ' && line[0] !== '\t' && trimmed.length > 0 && !trimmed.startsWith('#')) {
      results.push({ name: trimmed, line: i + 1 });
    }
  }
  return results;
}
