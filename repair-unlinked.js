const { PrismaClient } = require('@prisma/client');
const fs = require('fs'), path = require('path');
const prisma = new PrismaClient();

async function repair() {
  const projectId = 'cmquqaxp40003m8n21vdb36zb';
  const slug = 'airtel-ventas-lab';
  const scriptsRoot = '/scripts';
  const prefix = 'AIRTEL';

  const unlinked = await prisma.script.findMany({ where: { projectId, testCaseId: null } });
  console.log('Unlinked scripts:', unlinked.length);

  const existingIds = await prisma.testCase.findMany({ where: { projectId }, select: { tcId: true } });
  let counter = existingIds.reduce((max, { tcId }) => {
    const m = tcId.match(/(\d+)$/);
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 0);
  console.log('Starting tcId counter at:', counter);

  let created = 0, linked = 0;
  for (const script of unlinked) {
    const filePath = path.join(scriptsRoot, slug, script.filename);
    if (!fs.existsSync(filePath)) { console.log('Missing file:', script.filename); continue; }

    const content = fs.readFileSync(filePath, 'utf8');
    let inTC = false;
    const names = [];
    for (const l of content.split('\n')) {
      if (/^\*\*\* Test Cases/.test(l.trim())) { inTC = true; continue; }
      if (/^\*\*\*/.test(l.trim()) && inTC) break;
      if (inTC && l.trim() && !/^\s/.test(l) && !l.trim().startsWith('#')) names.push(l.trim());
    }

    const parts = script.filename.replace(/\\/g, '/').split('/');
    const useCaseTag = parts.length >= 3 && /^TestCases$/i.test(parts[0]) ? parts[1] : null;

    // Fallback: if no TC names found, use the filename stem as the TC title
    const effectiveNames = names.length > 0 ? names : [path.basename(script.filename, '.robot').replace(/_/g, ' ')];

    for (const name of effectiveNames) {
      const existing = await prisma.testCase.findFirst({ where: { projectId, title: name } });
      if (!existing) {
        counter++;
        const padded = String(counter).padStart(3, '0');
        const tc = await prisma.testCase.create({
          data: {
            projectId,
            tcId: prefix + '-' + padded,
            title: name,
            type: 'UI',
            status: 'DRAFT',
            expectedResult: '',
            ...(useCaseTag ? { useCaseTag } : {}),
          },
        });
        await prisma.script.update({ where: { id: script.id }, data: { testCaseId: tc.id } });
        created++;
        console.log('Created:', tc.tcId, name.slice(0, 70));
      } else {
        await prisma.script.update({ where: { id: script.id }, data: { testCaseId: existing.id } });
        linked++;
        console.log('Linked to existing:', existing.tcId);
      }
    }
  }
  console.log('Done — TCs created:', created, '| linked to existing:', linked);
  await prisma.$disconnect();
}

repair().catch(e => { console.error(e.message); process.exit(1); });
