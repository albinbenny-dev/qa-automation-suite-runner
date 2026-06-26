import fs from 'fs';
import { prisma } from '../lib/prisma.js';
// @ts-ignore — pdf-parse has incomplete typings
import pdfParse from 'pdf-parse';
import * as xlsx from 'xlsx';
import mammoth from 'mammoth';

export async function getLibraryContext(projectId: string): Promise<string> {
  const docs = await prisma.requirementDoc.findMany({
    where: { projectId, isActive: true },
    orderBy: { uploadedAt: 'asc' },
  });

  const parts: string[] = [];

  for (const doc of docs) {
    try {
      const text = await parseDocFile(doc.filePath, doc.fileType);
      if (text.trim()) {
        parts.push(`=== ${doc.filename} ===\n${text.trim()}`);
      }
    } catch {
      console.warn(`[reqLibraryLoader] Failed to parse "${doc.filename}" (${doc.id})`);
    }
  }

  return parts.join('\n\n');
}

async function parseDocFile(filePath: string, mimeType: string): Promise<string> {
  if (!fs.existsSync(filePath)) return '';

  if (mimeType === 'application/pdf') {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel'
  ) {
    const workbook = xlsx.readFile(filePath);
    return workbook.SheetNames.map((name) => {
      const ws = workbook.Sheets[name];
      return `[Sheet: ${name}]\n${xlsx.utils.sheet_to_csv(ws)}`;
    }).join('\n\n');
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  ) {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    return fs.readFileSync(filePath, 'utf-8');
  }

  return '';
}
