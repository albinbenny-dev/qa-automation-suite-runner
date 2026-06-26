/**
 * PatternExtractor: builds a project-level PatternMemory from verified scripts.
 *
 * Called automatically after any script passes a run. Reads all verified scripts,
 * extracts the login block, common locators, and avoid patterns from heal history,
 * then persists the result as Project.patternMemory.
 *
 * The PatternMemory is injected into every subsequent script generation so the
 * agent doesn't repeat the same login/locator mistakes it has already fixed.
 */

import { prisma } from '../lib/prisma.js';
import { readScript } from './scriptFileService.js';

// ── Public types (imported by scriptAgent.ts) ──────────────────────────────

export interface PatternMemoryLocator {
  selector: string;
  label: string;   // inferred semantic name
  frequency: number;
}

export interface PatternMemoryLoginBlock {
  codeSnippet: string;  // raw code lines (capped at 1500 chars)
  sourceScriptId: string;
  sourceTcTitle: string;
}

export interface PatternMemory {
  version: 1;
  updatedAt: string;
  scriptCount: number;
  loginBlock?: PatternMemoryLoginBlock;
  provenLocators: PatternMemoryLocator[];
  avoidPatterns: string[];
}

// ── Login block extraction ──────────────────────────────────────────────────

function extractRobotLoginBlock(content: string): string | null {
  const lines = content.split('\n');
  let inKeywords = false;
  let inLoginKw = false;
  const block: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('*** Keywords ***')) { inKeywords = true; continue; }
    if (trimmed.startsWith('***')) {
      // Entering a new section — if we collected a login block, we're done
      if (inLoginKw && block.length > 0) break;
      inKeywords = false; inLoginKw = false;
      continue;
    }
    if (!inKeywords) continue;

    // Keyword names start at column 0 (no leading whitespace)
    if (line.length > 0 && line[0] !== ' ' && line[0] !== '\t' && trimmed.length > 0 && !trimmed.startsWith('#')) {
      if (inLoginKw && block.length > 0) break; // previous login kw collected
      const lower = trimmed.toLowerCase();
      inLoginKw = lower.includes('login') || lower.includes('sign in') || lower.includes('authenticate');
      if (inLoginKw) block.push(line);
      else block.length = 0; // reset, different keyword
      continue;
    }

    if (inLoginKw) block.push(line);
  }

  if (block.length < 2) return null;
  return block.join('\n');
}

function extractPlaywrightLoginBlock(content: string): string | null {
  const lines = content.split('\n');
  // Anchor: line that fills the password field
  const pwIdx = lines.findIndex(
    (l) => (l.includes('.fill(') || l.includes('Fill(')) &&
      (l.toLowerCase().includes('password') || l.includes('TC_PASSWORD')),
  );
  if (pwIdx === -1) return null;

  const start = Math.max(0, pwIdx - 10);
  const end = Math.min(lines.length - 1, pwIdx + 10);
  return lines.slice(start, end + 1).join('\n');
}

// ── Locator extraction ──────────────────────────────────────────────────────

function extractLocators(content: string, isRobot: boolean): string[] {
  if (isRobot) {
    // Robot Browser library selectors: css=, id=, role=, text=
    const pattern = /\b(?:css|id|role|text|xpath)=[^\s'"}\n]{4,}/g;
    const raw = content.match(pattern) ?? [];
    return [...new Set(raw)].filter((l) => !l.includes('${') && l.length < 100);
  }

  // Playwright: getByTestId / getByRole / getByLabel / locator
  const result: string[] = [];
  const patterns: [RegExp, string][] = [
    [/getByTestId\(['"`]([^'"`]+)['"`]\)/g, 'getByTestId'],
    [/getByRole\(['"`]([^'"`]+)['"`]/g, 'getByRole'],
    [/getByLabel\(['"`]([^'"`]+)['"`]\)/g, 'getByLabel'],
    [/\.locator\(['"`]([^'"`]+)['"`]\)/g, 'locator'],
  ];
  for (const [re] of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const snippet = m[0].slice(0, 80);
      result.push(snippet);
    }
  }
  return [...new Set(result)];
}

function inferLabel(selector: string): string {
  const lower = selector.toLowerCase();
  if (lower.includes('username') || lower.includes('email')) return 'loginUsername';
  if (lower.includes('password')) return 'loginPassword';
  if (lower.includes('submit') || lower.includes('login-btn') || lower.includes('sign-in-btn')) return 'loginSubmit';
  if (lower.includes('dashboard')) return 'dashboardIndicator';
  if (lower.includes('logout') || lower.includes('sign-out')) return 'logoutButton';
  // Strip prefixes for a readable label
  return selector.replace(/^(?:css=|id=|getBy\w+\(['"`]|['"`]\).*)/, '').slice(0, 40);
}

// ── Main export ─────────────────────────────────────────────────────────────

export async function updatePatternMemory(projectId: string): Promise<void> {
  const scripts = await prisma.script.findMany({
    where: {
      projectId,
      verificationStatus: { in: ['VERIFIED', 'MANUAL_REVIEW'] },
    },
    include: { testCase: { select: { title: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 40,
  });

  if (scripts.length === 0) return;

  // Load content from disk (fall back to DB column)
  const loaded: Array<{ id: string; content: string; title: string; isRobot: boolean }> = [];
  for (const s of scripts) {
    let content = s.content;
    try { content = readScript(projectId, s.filename); } catch { /* use DB */ }
    if (!content?.trim()) continue;
    loaded.push({
      id: s.id,
      content,
      title: s.testCase?.title ?? s.filename,
      isRobot: s.scriptType === 'ROBOT',
    });
  }

  if (loaded.length === 0) return;

  // ── Login block: first script that yields a non-trivial snippet ──
  let loginBlock: PatternMemory['loginBlock'];
  for (const s of loaded) {
    const snippet = s.isRobot
      ? extractRobotLoginBlock(s.content)
      : extractPlaywrightLoginBlock(s.content);
    if (snippet && snippet.trim().length > 30) {
      loginBlock = {
        codeSnippet: snippet.trim().slice(0, 1500),
        sourceScriptId: s.id,
        sourceTcTitle: s.title,
      };
      break;
    }
  }

  // ── Proven locators: keep those appearing in ≥2 scripts ──
  const freq = new Map<string, number>();
  for (const s of loaded) {
    for (const loc of extractLocators(s.content, s.isRobot)) {
      freq.set(loc, (freq.get(loc) ?? 0) + 1);
    }
  }
  const provenLocators: PatternMemoryLocator[] = [...freq.entries()]
    .filter(([, f]) => f >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([selector, frequency]) => ({ selector, label: inferLabel(selector), frequency }));

  // ── Avoid patterns: approved/auto-applied heals from last 60 days ──
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const heals = await prisma.heal.findMany({
    where: {
      projectId,
      status: { in: ['APPROVED', 'AUTO_APPLIED'] },
      updatedAt: { gte: since },
      summary: { not: null },
    },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    select: { type: true, summary: true },
  });
  const avoidPatterns = heals
    .map((h) => `[${h.type}] ${h.summary}`)
    .filter((p): p is string => Boolean(p));

  const memory: PatternMemory = {
    version: 1,
    updatedAt: new Date().toISOString(),
    scriptCount: loaded.length,
    loginBlock,
    provenLocators,
    avoidPatterns,
  };

  await prisma.project.update({
    where: { id: projectId },
    data: { patternMemory: JSON.stringify(memory) },
  });

  console.log(`[pattern-extractor] Updated patternMemory for project ${projectId}: ${loaded.length} scripts, ${provenLocators.length} proven locators`);
}
