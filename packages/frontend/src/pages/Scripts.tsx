import React, { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import FileTree from '../components/scripts/FileTree';
import ExecutionMonitor from '../components/scripts/ExecutionMonitor';
import EditorTabs, { type EditorTab } from '../components/scripts/EditorTabs';
import { useProject, useProjectEnvConfigs } from '../hooks/useProjects';
import { useRBAC } from '../hooks/useRBAC';
import { useCreateIndividualRun, useRun } from '../hooks/useRuns';
import { useTestCases, useUseCases } from '../hooks/useTestCases';
import {
  useScripts,
  useSaveScriptContent,
  useDeleteScript,
  useUploadScript,
  useProjectFileTree,
  useDeleteProjectFile,
  useMoveProjectFile,
  useUploadProjectFile,
  useCreateProjectFolder,
  downloadProjectFile,
  type FileTreeNode,
} from '../hooks/useScripts';
import { useSaveResource } from '../hooks/useResources';
import { useExecutionStore } from '../stores/executionStore';
import { api } from '../lib/api';
import type { Script, TestCase } from '../types';

// ── Domain constants ────────────────────────────────────────────────────────

const AIRTEL_USE_CASES = [
  'Primary Sales', 'Stock Management', 'Dealer Onboarding & KYC',
  'Sales API', 'Secondary Sales', 'Distributor API',
];
const UC_COLORS: Record<string, string> = {
  'Primary Sales':           'var(--violet)',
  'Stock Management':        'var(--amber)',
  'Dealer Onboarding & KYC': 'var(--emerald)',
  'Sales API':               'var(--cyan)',
  'Secondary Sales':         'var(--rose)',
  'Distributor API':         'var(--sky)',
};
const UC_FALLBACKS = ['--violet', '--cyan', '--emerald', '--amber', '--rose', '--sky'];

function ucColor(name: string, idx: number) {
  return UC_COLORS[name] ?? `var(${UC_FALLBACKS[idx % UC_FALLBACKS.length]})`;
}

function buildGroups(allTCs: TestCase[], useCases: string[]) {
  const map = new Map<string, TestCase[]>();
  AIRTEL_USE_CASES.forEach((uc) => map.set(uc, []));
  useCases.filter((uc) => !AIRTEL_USE_CASES.includes(uc)).forEach((uc) => map.set(uc, []));
  for (const tc of allTCs) {
    const key = tc.useCaseTag ?? 'Uncategorised';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(tc);
  }
  return Array.from(map.entries())
    .filter(([, tcs]) => tcs.length > 0)
    .map(([name, tcs], i) => ({
      name,
      tcs: [...tcs].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
      color: ucColor(name, i),
    }));
}

// ── Types ───────────────────────────────────────────────────────────────────

const TYPE_CHIP: Record<string, { bg: string; color: string }> = {
  UI:  { bg: 'var(--rose-dim)',    color: 'var(--rose)' },
  API: { bg: 'var(--cyan-dim)',    color: 'var(--cyan)' },
  SIT: { bg: 'var(--emerald-dim)', color: 'var(--emerald)' },
};

// ── SimpleTCRow ──────────────────────────────────────────────────────────────

function SimpleTCRow({
  tc, isScripted, onOpen,
}: {
  tc: TestCase;
  isScripted: boolean;
  onOpen: () => void;
}) {
  const chip = TYPE_CHIP[tc.type] ?? { bg: 'var(--surface3)', color: 'var(--text-dim)' };

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px 6px 24px',
        borderBottom: '1px solid var(--border)',
        background: isScripted ? 'rgba(42,157,143,0.04)' : 'transparent',
      }}
    >
      {/* Status icon */}
      <span
        style={{
          width: 15, height: 15, borderRadius: 3,
          background: isScripted ? 'var(--emerald-dim)' : 'rgba(120,120,120,0.18)',
          border: isScripted ? '1px solid rgba(42,157,143,0.35)' : '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, color: isScripted ? 'var(--emerald)' : 'var(--text-dim)',
          fontWeight: 700, flexShrink: 0,
        }}
      >
        {isScripted ? '✓' : ''}
      </span>

      {/* Title + TC ID */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 11,
          fontWeight: isScripted ? 400 : 600,
          color: isScripted ? 'var(--text-dim)' : 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {tc.title}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', marginTop: 1 }}>
          {tc.tcId}
        </div>
      </div>

      {/* Type badge */}
      <span style={{
        fontSize: 8, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
        background: chip.bg, color: chip.color,
        flexShrink: 0, fontFamily: 'var(--font-ui)',
      }}>
        {tc.type}
      </span>

      {/* Open button for scripted */}
      {isScripted ? (
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          title="Open script in editor"
          style={{
            width: 20, height: 20, borderRadius: 3,
            background: 'rgba(37,99,171,0.1)', border: '1px solid rgba(37,99,171,0.2)',
            color: 'var(--cyan)', fontSize: 10, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >↗</button>
      ) : (
        <div style={{ width: 20, flexShrink: 0 }} />
      )}
    </div>
  );
}

// ── EmptyEditor ─────────────────────────────────────────────────────────────

function EmptyEditor() {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 12, color: 'rgba(226,232,240,0.3)', userSelect: 'none',
    }}>
      <div style={{ fontSize: 48, lineHeight: 1 }}>⌨</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'rgba(226,232,240,0.5)' }}>
        No file open
      </div>
      <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 280, lineHeight: 1.6 }}>
        Select a TC row on the left to open its script, or import a .robot file.
      </div>
    </div>
  );
}

// ── Shared modal shell ───────────────────────────────────────────────────────

const MODAL_OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1000,
  background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const MODAL_BOX: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 10, width: 480, maxWidth: '92vw',
  boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
};
const MODAL_HEADER: React.CSSProperties = {
  padding: '14px 18px', borderBottom: '1px solid var(--border)',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
};
const MODAL_BODY: React.CSSProperties = { padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 };
const MODAL_FOOTER: React.CSSProperties = {
  padding: '12px 18px', borderTop: '1px solid var(--border)',
  display: 'flex', justifyContent: 'flex-end', gap: 8,
};
const LABEL_STYLE: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-mid)', marginBottom: 4, display: 'block' };
const BTN_CANCEL: React.CSSProperties = {
  padding: '7px 16px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-mid)', fontSize: 12,
  fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-ui)',
};

// ── ImportScriptModal ─────────────────────────────────────────────────────────

type ImportMode   = 'link' | 'standalone';
type UploadType   = 'file' | 'folder';

interface ImportScriptModalProps {
  projectId: string;
  testCases: TestCase[];        // ALL test cases (not pre-filtered)
  scriptedTcIds: Set<string>;  // TCs that already have a script
  preSelectedTcId?: string;
  initialUploadType?: UploadType;
  onClose: () => void;
  onDone?: () => void;
}

function ImportScriptModal({
  projectId, testCases, scriptedTcIds,
  preSelectedTcId, initialUploadType = 'file',
  onClose, onDone,
}: ImportScriptModalProps) {
  const [importMode, setImportMode]   = useState<ImportMode>(preSelectedTcId ? 'link' : 'standalone');
  const [uploadType, setUploadType]   = useState<UploadType>(initialUploadType);

  // ── File upload state ──────────────────────────────────────────────────────
  const [file, setFile]               = useState<File | null>(null);
  const [selectedTcId, setSelectedTcId] = useState(preSelectedTcId ?? '');
  const [search, setSearch]           = useState('');
  const [busy, setBusy]               = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload  = useUploadScript(projectId);

  // ── Folder import state ────────────────────────────────────────────────────
  const [folderFile, setFolderFile]   = useState<File | null>(null);
  const [folderBusy, setFolderBusy]   = useState(false);
  const [folderResult, setFolderResult] = useState<{
    imported: { filename: string; testCasesCreated: number }[];
    warnings: string[];
    warnings: string[];
  } | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const filteredTCs = useMemo(() => {
    const q = search.toLowerCase();
    return testCases
      .filter((tc) => tc.title.toLowerCase().includes(q) || tc.tcId.toLowerCase().includes(q))
      .slice(0, 60);
  }, [testCases, search]);

  async function handleFileImport() {
    if (!file) { toast.error('Select a .robot file first'); return; }
    setBusy(true);
    try {
      if (importMode === 'link') {
        // Link to existing TC (replace script if TC already has one)
        const tcId = selectedTcId || undefined;
        await upload.mutateAsync({ file, testCaseId: tcId });
        const linked = tcId ? testCases.find((tc) => tc.id === tcId) : null;
        if (linked) {
          const wasScripted = scriptedTcIds.has(linked.id);
          toast.success(`${wasScripted ? 'Replaced script for' : 'Linked to'} ${linked.tcId}`);
        } else {
          toast.success(`Imported ${file.name} (unlinked)`);
        }
      } else {
        // Standalone — auto-create TCs from *** Test Cases *** section
        const result = await upload.mutateAsync({ file, autoCreateTCs: true });
        const tcCreated = (result as { tcCreated?: number }).tcCreated ?? 0;
        toast.success(`Imported ${file.name}${tcCreated > 0 ? ` · ${tcCreated} TC${tcCreated > 1 ? 's' : ''} created` : ''}`);
      }
      onDone?.();
      onClose();
    } catch {
      toast.error('Import failed');
    }
    setBusy(false);
  }

  async function handleFolderImport() {
    if (!folderFile) { toast.error('Select a .zip file first'); return; }
    setFolderBusy(true);
    try {
      const fd = new FormData();
      fd.append('folder', folderFile);
      const token = localStorage.getItem('qai-token') ?? '';
      const res = await fetch(`/api/projects/${projectId}/scripts/import-folder`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error((err as { error?: string }).error ?? 'Import failed');
      }
      const data = await res.json() as {
        imported: { filename: string; testCasesCreated: number }[];
        warnings: string[];
        warnings: string[];
      };
      setFolderResult(data);
      onDone?.();
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Import failed');
    }
    setFolderBusy(false);
  }

  const SEG_BTN = (active: boolean, accent = 'var(--violet)'): React.CSSProperties => ({
    flex: 1, padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
    fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
    border: active ? `1.5px solid ${accent}` : '1.5px solid var(--border)',
    background: active ? accent : 'var(--surface)',
    color: active ? '#fff' : 'var(--text-dim)',
    boxShadow: active ? `0 0 8px ${accent}55` : 'none',
    transition: 'all 0.15s', textAlign: 'center' as const,
  });

  const INPUT_STYLE_SM: React.CSSProperties = {
    width: '100%', padding: '7px 10px', background: 'var(--surface2)',
    border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)',
    fontSize: 11, outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-ui)',
  };

  const modeDesc = importMode === 'link'
    ? 'Choose a TC to link this script to. If the TC already has a script it will be replaced.'
    : 'TCs will be auto-created from the *** Test Cases *** section in the uploaded script.';

  return (
    <div style={MODAL_OVERLAY} onClick={onClose}>
      <div style={{ ...MODAL_BOX, maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div style={MODAL_HEADER}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>⬆ Import Script</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={MODAL_BODY}>

          {/* ── Upload type ─────────────────────────────────────────────── */}
          <div>
            <span style={LABEL_STYLE}>Upload Type</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={SEG_BTN(uploadType === 'file', 'var(--cyan)')}
                onClick={() => setUploadType('file')}>📄 Single .robot file</button>
              <button style={SEG_BTN(uploadType === 'folder', 'var(--cyan)')}
                onClick={() => setUploadType('folder')}>📦 Use Case Folder (.zip)</button>
            </div>
          </div>

          {/* ── Mode — only for single file ─────────────────────────────── */}
          {uploadType === 'file' && (
            <div>
              <span style={LABEL_STYLE}>Import Mode</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={SEG_BTN(importMode === 'link', 'var(--violet)')}
                  onClick={() => setImportMode('link')}>Link to existing TC</button>
                <button style={SEG_BTN(importMode === 'standalone', 'var(--violet)')}
                  onClick={() => setImportMode('standalone')}>Import standalone</button>
              </div>
              <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '5px 0 0', lineHeight: 1.5 }}>{modeDesc}</p>
            </div>
          )}

          {/* ── File picker (single file) ────────────────────────────────── */}
          {uploadType === 'file' && (
            <div>
              <span style={LABEL_STYLE}>Script File <span style={{ color: '#f87171', fontWeight: 400 }}>*</span></span>
              <button onClick={() => fileRef.current?.click()} style={{
                width: '100%', padding: '18px 12px',
                border: `2px dashed ${file ? 'var(--emerald)' : 'var(--border)'}`,
                borderRadius: 8, background: file ? 'rgba(42,157,143,0.06)' : 'transparent',
                cursor: 'pointer', color: file ? 'var(--text)' : 'var(--text-dim)',
                fontSize: 12, fontFamily: 'var(--font-ui)', textAlign: 'center', transition: 'all 0.15s',
              }}>
                {file ? `📄 ${file.name}` : '+ Click to select a .robot file'}
              </button>
              <input ref={fileRef} type="file" accept=".robot" style={{ display: 'none' }}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
          )}

          {/* ── TC selector — link mode only ─────────────────────────────── */}
          {uploadType === 'file' && importMode === 'link' && (
            <div>
              <span style={LABEL_STYLE}>Test Case <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(optional)</span></span>
              <input type="text" placeholder="Search by title or TC ID…" value={search}
                onChange={(e) => setSearch(e.target.value)} style={INPUT_STYLE_SM} />
              <div style={{ maxHeight: 160, overflowY: 'auto', marginTop: 4, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface2)' }}>
                <div onClick={() => setSelectedTcId('')} style={{
                  padding: '7px 10px', cursor: 'pointer', fontSize: 11,
                  background: !selectedTcId ? 'rgba(37,99,171,0.18)' : 'transparent',
                  color: !selectedTcId ? 'var(--cyan)' : 'var(--text-dim)',
                  borderBottom: '1px solid var(--border)',
                }}>None — upload as unlinked script</div>
                {filteredTCs.map((tc) => {
                  const hasScript = scriptedTcIds.has(tc.id);
                  const isSelected = selectedTcId === tc.id;
                  return (
                    <div key={tc.id} onClick={() => setSelectedTcId(tc.id)} style={{
                      padding: '7px 10px', cursor: 'pointer', fontSize: 11,
                      background: isSelected ? 'rgba(37,99,171,0.18)' : 'transparent',
                      color: isSelected ? 'var(--cyan)' : 'var(--text-mid)',
                      display: 'flex', gap: 8, alignItems: 'center',
                      borderBottom: '1px solid var(--border)',
                    }}>
                      <span style={{ color: 'var(--text-dim)', flexShrink: 0, fontSize: 10 }}>{tc.tcId}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tc.title}</span>
                      {hasScript && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                          background: 'rgba(245,158,11,0.15)', color: 'var(--amber)', flexShrink: 0,
                        }}>⟳ replace</span>
                      )}
                    </div>
                  );
                })}
                {filteredTCs.length === 0 && search && (
                  <div style={{ padding: '8px 10px', color: 'var(--text-dim)', fontSize: 11 }}>No matches</div>
                )}
              </div>
            </div>
          )}

          {/* ── Folder zip picker ────────────────────────────────────────── */}
          {uploadType === 'folder' && !folderResult && (
            <div>
              <span style={LABEL_STYLE}>Use Case Zip <span style={{ color: '#f87171', fontWeight: 400 }}>*</span></span>
              <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '0 0 8px', lineHeight: 1.6 }}>
                Upload a <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--cyan)' }}>.zip</code> of one use case.{' '}
                <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--emerald)' }}>.robot</code> files become scripts with auto-created TCs.
                All other files (xlsx, csv, png, .resource, .py…) are preserved under <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-mid)' }}>resources/</code> with their folder structure intact.
              </p>
              <button onClick={() => folderRef.current?.click()} style={{
                width: '100%', padding: '22px 12px',
                border: `2px dashed ${folderFile ? 'var(--cyan)' : 'var(--border)'}`,
                borderRadius: 8, background: folderFile ? 'rgba(34,211,238,0.05)' : 'transparent',
                cursor: 'pointer', color: folderFile ? 'var(--text)' : 'var(--text-dim)',
                fontSize: 12, fontFamily: 'var(--font-ui)', textAlign: 'center', transition: 'all 0.15s',
              }}>
                {folderFile
                  ? `📦 ${folderFile.name} (${(folderFile.size / 1024).toFixed(1)} KB)`
                  : '+ Click to select a .zip file'}
              </button>
              <input ref={folderRef} type="file" accept=".zip" style={{ display: 'none' }}
                onChange={(e) => setFolderFile(e.target.files?.[0] ?? null)} />
            </div>
          )}

          {/* ── Folder result summary ────────────────────────────────────── */}
          {uploadType === 'folder' && folderResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                {[
                  { label: 'Scripts imported', value: folderResult.imported.length,
                    color: 'var(--emerald)', bg: 'rgba(42,157,143,0.1)', border: 'rgba(42,157,143,0.3)' },
                  { label: 'TCs created',
                    value: folderResult.imported.reduce((s, r) => s + r.testCasesCreated, 0),
                    color: 'var(--violet)', bg: 'rgba(139,92,246,0.1)', border: 'rgba(139,92,246,0.3)' },
                  { label: 'Warnings', value: folderResult.warnings?.length ?? 0,
                    color: 'var(--cyan)', bg: 'rgba(34,211,238,0.1)', border: 'rgba(34,211,238,0.3)' },
                ].map((tile) => (
                  <div key={tile.label} style={{
                    flex: 1, padding: '12px', borderRadius: 8, textAlign: 'center',
                    background: tile.bg, border: `1px solid ${tile.border}`,
                  }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: tile.color }}>{tile.value}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>{tile.label}</div>
                  </div>
                ))}
              </div>
              {folderResult.warnings.length > 0 && (
                <div style={{ padding: '10px 12px', borderRadius: 6, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', marginBottom: 4 }}>⚠ Warnings</div>
                  {folderResult.warnings.map((w, i) => (
                    <div key={i} style={{ fontSize: 10, color: 'var(--text-mid)', lineHeight: 1.6, fontFamily: 'var(--font-mono)' }}>{w}</div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>{/* /MODAL_BODY */}

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div style={MODAL_FOOTER}>
          {uploadType === 'folder' && folderResult ? (
            <button onClick={onClose} style={{
              padding: '7px 18px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-ui)', color: '#fff',
              background: 'linear-gradient(135deg, var(--emerald), var(--cyan))',
            }}>✓ Done</button>
          ) : uploadType === 'folder' ? (
            <>
              <button onClick={onClose} style={BTN_CANCEL}>Cancel</button>
              <button onClick={handleFolderImport} disabled={!folderFile || folderBusy} style={{
                padding: '7px 18px', borderRadius: 6, border: 'none',
                cursor: !folderFile || folderBusy ? 'not-allowed' : 'pointer',
                fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-ui)', color: '#fff',
                background: 'linear-gradient(135deg, var(--6d-orange), var(--cyan))',
                opacity: !folderFile || folderBusy ? 0.55 : 1, transition: 'opacity 0.15s',
              }}>{folderBusy ? 'Importing…' : '📦 Import Use Case'}</button>
            </>
          ) : (
            <>
              <button onClick={onClose} style={BTN_CANCEL}>Cancel</button>
              <button onClick={handleFileImport} disabled={!file || busy} style={{
                padding: '7px 18px', borderRadius: 6, border: 'none',
                cursor: !file || busy ? 'not-allowed' : 'pointer',
                fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-ui)', color: '#fff',
                background: 'linear-gradient(135deg, var(--violet), var(--cyan))',
                opacity: !file || busy ? 0.55 : 1, transition: 'opacity 0.15s',
              }}>{busy ? 'Importing…' : '⬆ Import'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

// ── RF Go-to-Definition helper ───────────────────────────────────────────────
function findRFKeywordAtPosition(
  model: any,
  position: { lineNumber: number; column: number },
  index: Record<string, { filename: string; line: number }>,
): string | null {
  if (!model || !position) return null;
  const lineContent: string = model.getLineContent(position.lineNumber);
  const col = position.column;
  const lineLower = lineContent.toLowerCase();
  const keywords = Object.keys(index).sort((a, b) => b.length - a.length);
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    let searchFrom = 0;
    while (true) {
      const idx = lineLower.indexOf(kwLower, searchFrom);
      if (idx === -1) break;
      const start = idx + 1;
      const end = idx + kw.length + 1;
      if (col >= start && col < end) return kw;
      searchFrom = idx + 1;
    }
  }
  return null;
}

export default function Scripts() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canWrite } = useRBAC();

  const { data: project } = useProject(slug);
  const projectId = project?.id;

  const { data: scripts = [], isLoading: scriptsLoading } = useScripts(projectId);
  const { data: tcData, isLoading: tcsLoading } = useTestCases(projectId, { limit: 500 });
  const { data: useCases = [] } = useUseCases(projectId);

  const save = useSaveScriptContent(projectId ?? '');
  const deleteScript = useDeleteScript(projectId ?? '');
  const createIndividualRun = useCreateIndividualRun(projectId ?? '');
  const { data: envConfigs = [] } = useProjectEnvConfigs(projectId);

  // ── Project file tree ────────────────────────────────────────────────────
  const { data: fileTreeData, isLoading: fileTreeLoading, refetch: refetchFileTree } = useProjectFileTree(projectId);
  const deleteProjectFile   = useDeleteProjectFile(projectId ?? '');
  const moveProjectFile     = useMoveProjectFile(projectId ?? '');
  const uploadProjectFile   = useUploadProjectFile(projectId ?? '');
  const createProjectFolder = useCreateProjectFolder(projectId ?? '');
  const [expandedTreeDirs, setExpandedTreeDirs]     = useState<Set<string>>(new Set(['TestCases', 'Resource', 'resources']));
  const [selectedFilePath, setSelectedFilePath]     = useState<string | null>(null);
  const [showSearch, setShowSearch]                 = useState(false);
  const [searchQuery, setSearchQuery]               = useState('');
  const [searchResults, setSearchResults]           = useState<{ path: string; matches: { line: number; text: string }[] }[]>([]);
  const [searchLoading, setSearchLoading]           = useState(false);
  const [deletingFilePath, setDeletingFilePath]     = useState<string | null>(null);
  const [draggedFilePath, setDraggedFilePath]       = useState<string | null>(null);
  const [dragOverDirPath, setDragOverDirPath]       = useState<string | null>(null);
  const [uploadTargetDir, setUploadTargetDir]       = useState<string>('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName]           = useState('');
  const projectFileUploadRef = useRef<HTMLInputElement>(null);
  const saveResource = useSaveResource(projectId ?? '');

  const { setSelected: setExecutionSelected } = useExecutionStore();

  // ── Derived data ─────────────────────────────────────────────────────────

  const allTCs = tcData?.testCases ?? [];

  const tcIdToScript = useMemo(() => {
    const m = new Map<string, Script>();
    for (const s of scripts) {
      if (s.testCaseId) m.set(s.testCaseId, s);
    }
    return m;
  }, [scripts]);

  const scriptedTcIds = useMemo(() => new Set(tcIdToScript.keys()), [tcIdToScript]);
  const pendingCount = allTCs.filter((tc) => !scriptedTcIds.has(tc.id)).length;

  const groups = useMemo(() => buildGroups(allTCs, useCases), [allTCs, useCases]);

  // ── Left panel state ─────────────────────────────────────────────────────

  const [leftTab, setLeftTab] = useState<'tcs' | 'projectfiles'>('tcs');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(AIRTEL_USE_CASES),
  );

  // ── Resizable left panel ─────────────────────────────────────────────────

  const [leftPanelWidth, setLeftPanelWidth] = useState(() => Math.floor((window.innerWidth - 180) * 0.35));
  const leftPanelWidthRef = useRef(Math.floor((window.innerWidth - 180) * 0.35));
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);
  const dividerRef = useRef<HTMLDivElement>(null);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = leftPanelWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useLayoutEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = e.clientX - dragStartXRef.current;
      const next = Math.min(Math.floor(window.innerWidth * 0.75), Math.max(240, dragStartWidthRef.current + delta));
      leftPanelWidthRef.current = next;
      if (dividerRef.current) {
        const panel = dividerRef.current.previousElementSibling as HTMLElement | null;
        if (panel) panel.style.width = `${next}px`;
      }
    };
    const onMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setLeftPanelWidth(leftPanelWidthRef.current);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // ── Execution Monitor state ────────────────────────────────────────────────

  const [showMonitor, setShowMonitor] = useState(false);
  const [monitorRunId, setMonitorRunId] = useState<string | null>(null);
  const [monitorScript, setMonitorScript] = useState('');

  // ── Quick-run state ───────────────────────────────────────────────────────

  const [quickRunId, setQuickRunId] = useState<string | null>(null);
  const [quickRunning, setQuickRunning] = useState(false);
  const { data: quickRunData } = useRun(projectId, quickRunId);
  const quickRunStatus = quickRunData?.status ?? null;

  // ── Host-browser run state ───────────────────────────────────────────────

  const [hostRunId, setHostRunId] = useState<string | null>(null);
  const [hostRunning, setHostRunning] = useState(false);
  const { data: hostRunData } = useRun(projectId, hostRunId);
  const hostRunStatus = hostRunData?.status ?? null;

  async function handleQuickRun() {
    if (!projectId || !activeScript?.testCaseId) return;
    const defaultEnv = envConfigs.find((e) => e.isDefault) ?? envConfigs[0];
    if (activeTabId && dirtyTabs.has(activeTabId)) {
      try {
        await save.mutateAsync({ scriptId: activeTabId, content: tabContents[activeTabId] ?? '' });
        setDirtyTabs((prev) => { const n = new Set(prev); n.delete(activeTabId); return n; });
      } catch {
        toast.error('Save failed — cannot run unsaved script.');
        return;
      }
    }
    setQuickRunning(true);
    setQuickRunId(null);
    try {
      const run = await createIndividualRun.mutateAsync({
        testCaseId: activeScript.testCaseId,
        environment: defaultEnv?.name ?? 'default',
      });
      setQuickRunId(run.id);
      setMonitorRunId(run.id);
      setMonitorScript(activeScript?.filename ?? 'script');
      setShowMonitor(true);
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to start run');
      setQuickRunning(false);
    }
  }

  async function handleHostBrowserRun() {
    if (!projectId || !activeScript?.testCaseId) return;
    const defaultEnv = envConfigs.find((e) => e.isDefault) ?? envConfigs[0];
    if (activeTabId && dirtyTabs.has(activeTabId)) {
      try {
        await save.mutateAsync({ scriptId: activeTabId, content: tabContents[activeTabId] ?? '' });
        setDirtyTabs((prev) => { const n = new Set(prev); n.delete(activeTabId); return n; });
      } catch {
        toast.error('Save failed — cannot run unsaved script.');
        return;
      }
    }
    const vncUrl = `http://${window.location.hostname}:6080/vnc.html?autoconnect=true&reconnect=true&reconnect_delay_ms=2000&resize=scale`;
    window.open(vncUrl, 'qa-vnc-viewer');
    setHostRunning(true);
    setHostRunId(null);
    try {
      const run = await createIndividualRun.mutateAsync({
        testCaseId: activeScript.testCaseId,
        environment: defaultEnv?.name ?? 'default',
        hostBrowser: true,
      });
      setHostRunId(run.id);
      setMonitorRunId(run.id);
      setMonitorScript(activeScript?.filename ?? 'script');
      setShowMonitor(true);
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to start host-browser run');
      setHostRunning(false);
    }
  }

  useEffect(() => {
    if (quickRunStatus && quickRunStatus !== 'PENDING' && quickRunStatus !== 'RUNNING') {
      setQuickRunning(false);
    }
  }, [quickRunStatus]);

  useEffect(() => {
    if (hostRunStatus && hostRunStatus !== 'PENDING' && hostRunStatus !== 'RUNNING') {
      setHostRunning(false);
    }
  }, [hostRunStatus]);

  // ── Import modals state ───────────────────────────────────────────────────

  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreTcId, setImportPreTcId] = useState('');
  const [importInitialUploadType, setImportInitialUploadType] = useState<'file' | 'folder'>('file');

  function handleOpenImport(tcId = '', uploadType: 'file' | 'folder' = 'file') {
    setImportPreTcId(tcId);
    setImportInitialUploadType(uploadType);
    setShowImportModal(true);
  }

  // ── Editor tab state ─────────────────────────────────────────────────────

  const [openTabs, setOpenTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabContents, setTabContents] = useState<Record<string, string>>({});
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());
  const [loadingContent, setLoadingContent] = useState(false);

  // ── Go-to-Definition refs ─────────────────────────────────────────────────
  const monacoEditorRef = useRef<any>(null);
  const pendingRevealLineRef = useRef<number | null>(null);
  const keywordIndexRef = useRef<Record<string, { filename: string; line: number }>>({});
  const rfLangRegisteredRef = useRef(false);
  const openResourceTabRef = useRef<(filename: string, line?: number) => void>(() => {});

  const activeTab = openTabs.find((t) => t.id === activeTabId) ?? null;
  const activeScript = activeTab?.kind === 'script' ? activeTab.script : null;
  const activeContent = activeTabId ? (tabContents[activeTabId] ?? '') : '';

  // Clear run badges when the user switches to a different script tab
  useEffect(() => {
    setQuickRunId(null); setQuickRunning(false);
    setHostRunId(null);  setHostRunning(false);
  }, [activeTabId]);

  // ── Open a tab ───────────────────────────────────────────────────────────

  const openTab = useCallback(
    async (script: Script) => {
      const tab: EditorTab = { kind: 'script', id: script.id, filename: script.filename, script };
      setActiveTabId(script.id);
      if (!openTabs.find((t) => t.id === script.id)) {
        setOpenTabs((prev) => [...prev, tab]);
      }
      if (!tabContents[script.id] && projectId) {
        setLoadingContent(true);
        try {
          const res = await api.get<{ content: string }>(
            `/projects/${projectId}/scripts/${script.id}/content`,
          );
          setTabContents((prev) => ({ ...prev, [script.id]: res.data.content }));
        } catch {
          toast.error('Failed to load script content');
        } finally {
          setLoadingContent(false);
        }
      }
    },
    [openTabs, tabContents, projectId],
  );

  const openResourceTab = useCallback(
    async (filename: string, revealLine?: number) => {
      if (revealLine) pendingRevealLineRef.current = revealLine;
      const tabId = `resource:${filename}`;
      const tab: EditorTab = { kind: 'resource', id: tabId, filename };
      setActiveTabId(tabId);
      if (!openTabs.find((t) => t.id === tabId)) {
        setOpenTabs((prev) => [...prev, tab]);
      }
      if (!tabContents[tabId] && projectId) {
        setLoadingContent(true);
        try {
          // Files now live in the project tree (/scripts/slug/), not the legacy resources dir
          const res = await api.get<{ content: string }>(
            `/projects/${projectId}/scripts/project-file/content?path=${encodeURIComponent(filename)}`,
          );
          setTabContents((prev) => ({ ...prev, [tabId]: res.data.content }));
        } catch {
          toast.error('Failed to load resource content');
        } finally {
          setLoadingContent(false);
        }
      }
    },
    [openTabs, tabContents, projectId],
  );

  // ── Global project file search ──────────────────────────────────────────

  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2 || !projectId) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.get<{ results: { path: string; matches: { line: number; text: string }[] }[] }>(
          `/projects/${projectId}/scripts/project-file/search?q=${encodeURIComponent(searchQuery)}`,
        );
        setSearchResults(res.data.results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, projectId]);

  // ── Open a project-file tab (any file under /scripts/slug/) ─────────────

  const EDITABLE_EXTS = new Set(['.robot', '.resource', '.yaml', '.yml', '.txt', '.py', '.json', '.csv', '.ini', '.cfg', '.toml', '.md']);

  const openProjectFileTab = useCallback(
    async (filePath: string) => {
      const ext = filePath.includes('.') ? '.' + filePath.split('.').pop()!.toLowerCase() : '';
      if (!EDITABLE_EXTS.has(ext)) { toast.error(`Cannot edit ${ext || 'this'} file type in the editor`); return; }
      const tabId = `pf:${filePath}`;
      const tab: EditorTab = { kind: 'projectfile', id: tabId, filename: filePath.split('/').pop() ?? filePath, path: filePath };
      setActiveTabId(tabId);
      if (!openTabs.find((t) => t.id === tabId)) {
        setOpenTabs((prev) => [...prev, tab]);
      }
      if (!tabContents[tabId] && projectId) {
        setLoadingContent(true);
        try {
          const res = await api.get<{ content: string }>(
            `/projects/${projectId}/scripts/project-file/content?path=${encodeURIComponent(filePath)}`,
          );
          setTabContents((prev) => ({ ...prev, [tabId]: res.data.content }));
        } catch {
          toast.error('Failed to load file');
        } finally {
          setLoadingContent(false);
        }
      }
    },
    [openTabs, tabContents, projectId],
  );

  // ── Close a tab ──────────────────────────────────────────────────────────

  const closeTab = useCallback(
    (id: string) => {
      setOpenTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (activeTabId === id) setActiveTabId(next.length > 0 ? next[next.length - 1].id : null);
        return next;
      });
      setTabContents((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setDirtyTabs((prev) => { const n = new Set(prev); n.delete(id); return n; });
    },
    [activeTabId],
  );

  // ── Save current tab ─────────────────────────────────────────────────────

  const saveActiveTab = useCallback(async () => {
    if (!activeTabId || !dirtyTabs.has(activeTabId)) return;
    const tab = openTabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    try {
      if (tab.kind === 'resource') {
        await saveResource.mutateAsync({ filename: tab.filename, content: tabContents[activeTabId] ?? '' });
      } else if (tab.kind === 'projectfile') {
        await api.put(`/projects/${projectId}/scripts/project-file/content?path=${encodeURIComponent(tab.path)}`, { content: tabContents[activeTabId] ?? '' });
      } else {
        await save.mutateAsync({ scriptId: activeTabId, content: tabContents[activeTabId] ?? '' });
      }
      setDirtyTabs((prev) => { const n = new Set(prev); n.delete(activeTabId); return n; });
      toast.success('Saved');
    } catch {
      toast.error('Save failed');
    }
  }, [activeTabId, dirtyTabs, tabContents, openTabs, save, saveResource]);

  // ── Ctrl+S ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveActiveTab();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveActiveTab]);

  useEffect(() => { openResourceTabRef.current = openResourceTab; }, [openResourceTab]);

  // Fetch keyword index whenever the project changes
  useEffect(() => {
    if (!projectId) return;
    api.get<Record<string, { filename: string; line: number }>>(`/projects/${projectId}/resources/keywords/index`)
      .then((res) => { keywordIndexRef.current = res.data; })
      .catch(() => {});
  }, [projectId]);

  // After switching to a resource tab, reveal the pending line once content is loaded
  useEffect(() => {
    const line = pendingRevealLineRef.current;
    if (!line || !activeTabId || !monacoEditorRef.current) return;
    if (!tabContents[activeTabId]) return;
    pendingRevealLineRef.current = null;
    setTimeout(() => {
      monacoEditorRef.current?.revealLineInCenter(line);
      monacoEditorRef.current?.setPosition({ lineNumber: line, column: 1 });
    }, 80);
  }, [activeTabId, tabContents]);

  // ── Open TC's script in editor ────────────────────────────────────────────

  function handleOpenTCScript(tcDbId: string) {
    const script = tcIdToScript.get(tcDbId);
    if (script) { openTab(script); }
  }

  function toggleGroupExpand(name: string) {
    setExpandedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name); else n.add(name);
      return n;
    });
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(script: Script) {
    if (!window.confirm(`Delete "${script.filename}"?`)) return;
    try {
      await deleteScript.mutateAsync(script.id);
      closeTab(script.id);
      toast.success('Deleted');
    } catch {
      toast.error('Delete failed');
    }
  }

  // ── Send to execution ─────────────────────────────────────────────────────

  function handleSendToExecution() {
    const tcIds = openTabs.map((t) => t.kind === 'script' ? t.script.testCaseId : null).filter((id): id is string => Boolean(id));
    if (tcIds.length === 0) { toast('No linked test cases in open tabs'); return; }
    setExecutionSelected(tcIds);
    navigate(`/projects/${slug}/execution`);
  }

  // ── Status bar ────────────────────────────────────────────────────────────

  const statusMeta = scripts.find((s) => s.id === activeTabId);
  const statusSize = statusMeta?.size ? `${(statusMeta.size / 1024).toFixed(1)} KB` : null;
  const statusDirty = dirtyTabs.has(activeTabId ?? '');

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Execution Monitor — floating resizable */}
      {showMonitor && monitorRunId && projectId && (
        <ExecutionMonitor
          runId={monitorRunId}
          projectId={projectId}
          scriptName={monitorScript}
          onClose={() => setShowMonitor(false)}
        />
      )}

      {/* Import script modal (single file + use case folder tabs) */}
      {showImportModal && projectId && (
        <ImportScriptModal
          projectId={projectId}
          testCases={allTCs}
          scriptedTcIds={scriptedTcIds}
          preSelectedTcId={importPreTcId}
          initialUploadType={importInitialUploadType}
          onClose={() => setShowImportModal(false)}
          onDone={() => {
            void qc.invalidateQueries({ queryKey: ['scripts', projectId] });
            void qc.invalidateQueries({ queryKey: ['file-tree', projectId] });
            void qc.invalidateQueries({ queryKey: ['test-cases', projectId] });
            setLeftTab('projectfiles');
          }}
        />
      )}

      {/* Topbar */}
      <Topbar
        breadcrumbs={[
          { label: 'Projects', href: '/projects' },
          { label: project?.name ?? slug ?? '', href: `/projects/${slug}/dashboard` },
          { label: '⌨ Scripts' },
        ]}
        actions={
          <>
            {canWrite && (
              <>
                <TbBtn variant="ghost" onClick={() => handleOpenImport()}>
                  ⬆ Import Script
                </TbBtn>
              </>
            )}
            <TbBtn variant="primary" onClick={handleSendToExecution}>
              → Send to Execution
            </TbBtn>
          </>
        }
      />

      {/* 2-column body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── LEFT PANEL ──────────────────────────────────────────────────── */}
        <div style={{
          width: leftPanelWidth, flexShrink: 0,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: 'var(--surface)',
        }}>
          {/* Accent stripe */}
          <div style={{ height: 3, background: 'linear-gradient(90deg, var(--violet), var(--cyan))', flexShrink: 0 }} />

          {/* Tab bar */}
          <div style={{
            display: 'flex', borderBottom: '1px solid var(--border)',
            flexShrink: 0, background: 'var(--surface2)',
          }}>
            {(['tcs', 'projectfiles'] as const).map((tab) => {
              const active = leftTab === tab;
              const label = tab === 'tcs' ? '📋 Test Cases' : '📁 Project Files';
              const accent = tab === 'tcs' ? 'var(--6d-orange)' : 'var(--cyan)';
              return (
                <button key={tab} onClick={() => setLeftTab(tab)} style={{
                  flex: 1, padding: '9px 10px', border: 'none', cursor: 'pointer',
                  background: active ? 'var(--surface)' : 'transparent',
                  borderBottom: active ? `2px solid ${accent}` : '2px solid transparent',
                  color: active ? 'var(--text)' : 'var(--text-dim)',
                  fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  transition: 'all 0.15s',
                }}>
                  {label}
                  {tab === 'tcs' && pendingCount > 0 && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10,
                      background: 'var(--violet)', color: 'white', lineHeight: '14px',
                    }}>{pendingCount}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── TEST CASES TAB ── */}
          {leftTab === 'tcs' && (
            <>
              {/* Stats bar */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
                borderBottom: '1px solid var(--border)', flexShrink: 0,
                background: 'var(--surface2)',
              }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                  background: 'rgba(42,157,143,0.12)', color: 'var(--emerald)',
                  border: '1px solid rgba(42,157,143,0.25)',
                }}>
                  ✓ {allTCs.length - pendingCount} scripted
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                  background: pendingCount > 0 ? 'var(--violet-dim)' : 'var(--surface3)',
                  color: pendingCount > 0 ? 'var(--violet)' : 'var(--text-dim)',
                  border: pendingCount > 0 ? '1px solid rgba(244,123,32,0.25)' : '1px solid var(--border)',
                }}>
                  ○ {pendingCount} pending
                </span>
              </div>

              {/* Groups */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {tcsLoading ? (
                  <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--text-dim)' }}>
                    Loading…
                  </div>
                ) : groups.length === 0 ? (
                  <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
                    No test cases yet.
                  </div>
                ) : (
                  groups.map((group) => {
                    const isOpen = expandedGroups.has(group.name);
                    const pending = group.tcs.filter((tc) => !scriptedTcIds.has(tc.id));
                    const done = group.tcs.length - pending.length;

                    return (
                      <div key={group.name}>
                        {/* Group header */}
                        <div
                          onClick={() => toggleGroupExpand(group.name)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '7px 10px', cursor: 'pointer',
                            background: `linear-gradient(90deg, ${group.color.replace('var(', 'rgba(').replace(')', ', 0.06)')} , transparent)`,
                            borderBottom: '1px solid var(--border)',
                            userSelect: 'none',
                          }}
                        >
                          {/* Chevron */}
                          <span style={{
                            fontSize: 10, color: 'var(--text-dim)', flexShrink: 0,
                            transition: 'transform 0.15s', display: 'inline-block',
                            transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                          }}>▼</span>

                          {/* Color dot */}
                          <span style={{
                            width: 7, height: 7, borderRadius: '50%',
                            background: group.color, flexShrink: 0, display: 'inline-block',
                          }} />

                          {/* Name */}
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {group.name}
                          </span>

                          {/* Progress chip */}
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: 9,
                            color: done === group.tcs.length ? 'var(--emerald)' : 'var(--text-dim)',
                            flexShrink: 0,
                          }}>
                            {done}/{group.tcs.length}
                          </span>
                        </div>

                        {/* TC rows */}
                        {isOpen && group.tcs.map((tc) => (
                          <SimpleTCRow
                            key={tc.id}
                            tc={tc}
                            isScripted={scriptedTcIds.has(tc.id)}
                            onOpen={() => handleOpenTCScript(tc.id)}
                          />
                        ))}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Bottom hint */}
              <div style={{
                padding: '8px 12px', borderTop: '1px solid var(--border)',
                flexShrink: 0, background: 'var(--surface2)',
              }}>
                <div style={{
                  textAlign: 'center', fontSize: 10,
                  color: pendingCount === 0 ? 'var(--emerald)' : 'var(--text-dim)',
                  fontFamily: 'var(--font-mono)', padding: '2px 0',
                }}>
                  {pendingCount === 0
                    ? '✓ All test cases have scripts'
                    : `Import .robot files to link them to pending TCs`}
                </div>
              </div>
            </>
          )}

          {/* ── PROJECT FILES TAB ── */}
          {leftTab === 'projectfiles' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              {/* Toolbar */}
              <div style={{
                padding: '7px 10px', borderBottom: '1px solid var(--border)',
                flexShrink: 0, display: 'flex', gap: 6, alignItems: 'center',
              }}>
                {canWrite && (
                  <button
                    onClick={() => handleOpenImport('', 'folder' as 'folder')}
                    style={{
                      flex: 1, padding: '6px 8px',
                      background: 'linear-gradient(90deg, rgba(42,157,143,0.8), rgba(34,211,238,0.7))',
                      border: 'none', borderRadius: 5, cursor: 'pointer',
                      color: '#fff', fontWeight: 700, fontSize: 11,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    }}
                  >📦 Import Folder</button>
                )}
                {canWrite && (
                  <>
                    <button
                      onClick={() => projectFileUploadRef.current?.click()}
                      title={`Upload file${uploadTargetDir ? ` to ${uploadTargetDir}/` : ' to root'}`}
                      style={{
                        padding: '6px 8px', background: 'rgba(99,102,241,0.1)',
                        border: '1px solid rgba(99,102,241,0.3)', borderRadius: 5,
                        cursor: 'pointer', color: '#a5b4fc', fontSize: 11, fontWeight: 700,
                      }}
                    >⬆ Upload</button>
                    <input
                      ref={projectFileUploadRef}
                      type="file"
                      style={{ display: 'none' }}
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        try {
                          const r = await uploadProjectFile.mutateAsync({ file: f, folder: uploadTargetDir });
                          toast.success(`Uploaded ${r.filename}`);
                        } catch { toast.error('Upload failed'); }
                        e.target.value = '';
                      }}
                    />
                  </>
                )}
                {canWrite && (
                  <button
                    onClick={() => { setShowNewFolderInput(v => !v); setNewFolderName(''); }}
                    title="Create new folder"
                    style={{
                      padding: '6px 8px', background: showNewFolderInput ? 'rgba(99,102,241,0.18)' : 'transparent',
                      border: `1px solid ${showNewFolderInput ? 'rgba(99,102,241,0.5)' : 'var(--border)'}`,
                      borderRadius: 5, cursor: 'pointer', color: '#a5b4fc', fontSize: 11, fontWeight: 700,
                    }}
                  >📁+</button>
                )}
                <button
                  onClick={() => void refetchFileTree()}
                  style={{
                    padding: '6px 8px', background: 'transparent',
                    border: '1px solid var(--border)', borderRadius: 5,
                    cursor: 'pointer', color: 'var(--text-dim)', fontSize: 13,
                  }}
                  title="Refresh"
                >⟳</button>
                <button
                  onClick={() => {
                    setShowSearch(v => {
                      if (v) { setSearchQuery(''); setSearchResults([]); }
                      return !v;
                    });
                  }}
                  title="Search files"
                  style={{
                    padding: '6px 8px', background: showSearch ? 'rgba(245,158,11,0.15)' : 'transparent',
                    border: `1px solid ${showSearch ? 'rgba(245,158,11,0.5)' : 'var(--border)'}`,
                    borderRadius: 5, cursor: 'pointer',
                    color: showSearch ? '#f59e0b' : 'var(--text-dim)', fontSize: 13,
                  }}
                >🔍</button>
              </div>
              {showNewFolderInput && (
                <div style={{
                  padding: '6px 10px', borderBottom: '1px solid var(--border)',
                  background: 'rgba(99,102,241,0.06)', display: 'flex', gap: 5, alignItems: 'center',
                }}>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                    📁 {uploadTargetDir ? `${uploadTargetDir}/` : ''}
                  </span>
                  <input
                    autoFocus
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter') {
                        const name = newFolderName.trim().replace(/[^a-zA-Z0-9._\- ]/g, '_');
                        if (!name) return;
                        const fullPath = uploadTargetDir ? `${uploadTargetDir}/${name}` : name;
                        try {
                          await createProjectFolder.mutateAsync(fullPath);
                          setExpandedTreeDirs(prev => new Set([...prev, fullPath.split('/')[0], fullPath]));
                          toast.success(`Created: ${fullPath}`);
                          setShowNewFolderInput(false); setNewFolderName('');
                        } catch { toast.error('Failed to create folder'); }
                      }
                      if (e.key === 'Escape') { setShowNewFolderInput(false); setNewFolderName(''); }
                    }}
                    placeholder="folder name  (Enter to create)"
                    style={{
                      flex: 1, padding: '4px 7px', fontSize: 10,
                      background: 'var(--surface)', border: '1px solid rgba(99,102,241,0.4)',
                      borderRadius: 4, color: 'var(--text)', outline: 'none',
                      fontFamily: 'var(--font-mono)',
                    }}
                  />
                  <button
                    onClick={async () => {
                      const name = newFolderName.trim().replace(/[^a-zA-Z0-9._\- ]/g, '_');
                      if (!name) return;
                      const fullPath = uploadTargetDir ? `${uploadTargetDir}/${name}` : name;
                      try {
                        await createProjectFolder.mutateAsync(fullPath);
                        setExpandedTreeDirs(prev => new Set([...prev, fullPath.split('/')[0], fullPath]));
                        toast.success(`Created: ${fullPath}`);
                        setShowNewFolderInput(false); setNewFolderName('');
                      } catch { toast.error('Failed to create folder'); }
                    }}
                    style={{
                      padding: '4px 8px', fontSize: 10, fontWeight: 700,
                      background: 'rgba(99,102,241,0.25)', border: '1px solid rgba(99,102,241,0.4)',
                      borderRadius: 4, cursor: 'pointer', color: '#a5b4fc',
                    }}
                  >Create</button>
                </div>
              )}
              {uploadTargetDir && (
                <div style={{ padding: '3px 10px', background: 'rgba(99,102,241,0.06)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 9, color: '#a5b4fc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    ⬆ Upload target: <strong>{uploadTargetDir}/</strong>
                  </span>
                  <button onClick={() => setUploadTargetDir('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 11, padding: '0 2px' }}>✕</button>
                </div>
              )}
              {/* Search panel */}
              {showSearch && (
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                  <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                    <input
                      autoFocus
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search across project files…"
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '5px 9px', fontSize: 11,
                        background: 'var(--surface)', border: '1px solid rgba(245,158,11,0.4)',
                        borderRadius: 4, color: 'var(--text)', outline: 'none',
                        fontFamily: 'var(--font-mono)',
                      }}
                    />
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                    {searchLoading ? (
                      <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 11 }}>Searching…</div>
                    ) : searchQuery.length >= 2 && searchResults.length === 0 ? (
                      <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 11 }}>No matches found.</div>
                    ) : (
                      searchResults.map(result => (
                        <div key={result.path} style={{ borderBottom: '1px solid var(--border)' }}>
                          <div
                            onClick={() => void openProjectFileTab(result.path)}
                            style={{
                              padding: '5px 10px', cursor: 'pointer',
                              color: '#f59e0b', fontSize: 11, fontFamily: 'var(--font-mono)',
                              fontWeight: 600, wordBreak: 'break-all',
                            }}
                          >{result.path}</div>
                          {result.matches.map((m, mi) => {
                            const parts = m.text.split(new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
                            return (
                              <div key={mi} style={{ padding: '2px 10px 2px 20px', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                                <span style={{ color: 'var(--text-dim)', fontSize: 10, flexShrink: 0, minWidth: 24, textAlign: 'right' }}>{m.line}</span>
                                <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                                  {parts.map((part, pi) =>
                                    part.toLowerCase() === searchQuery.toLowerCase()
                                      ? <mark key={pi} style={{ background: 'rgba(251,191,36,0.3)', color: '#fbbf24', borderRadius: 2, padding: '0 1px' }}>{part}</mark>
                                      : part
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
              {/* Tree */}
              {!showSearch && <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                {fileTreeLoading ? (
                  <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 12 }}>Loading…</div>
                ) : !fileTreeData?.tree.length ? (
                  <div style={{ padding: '24px 16px', textAlign: 'center' }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 12 }}>No project files yet</div>
                    {canWrite && (
                      <button onClick={() => handleOpenImport('', 'folder' as 'folder')} style={{
                        padding: '6px 14px', borderRadius: 5, border: 'none', cursor: 'pointer',
                        background: 'var(--cyan)', color: '#fff', fontWeight: 700, fontSize: 11,
                      }}>📦 Import Folder</button>
                    )}
                  </div>
                ) : (
                  (() => {
                    const FILE_ICONS: Record<string, string> = {
                      '.robot': '🤖', '.resource': '🔗', '.py': '🐍',
                      '.xlsx': '📊', '.xls': '📊', '.csv': '📋',
                      '.txt': '📄', '.yaml': '⚙', '.yml': '⚙', '.json': '⚙',
                    };
                    const BTN = (style?: React.CSSProperties): React.CSSProperties => ({
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-dim)', fontSize: 11, padding: '1px 4px',
                      borderRadius: 3, lineHeight: 1, flexShrink: 0, ...style,
                    });

                    const renderNode = (node: FileTreeNode, depth: number): React.ReactNode => {
                      const indent = depth * 14 + 10;
                      if (node.type === 'dir') {
                        const open = expandedTreeDirs.has(node.path);
                        const isDrop = dragOverDirPath === node.path;
                        const isUploadTarget = uploadTargetDir === node.path;
                        return (
                          <div key={node.path}>
                            <div
                              onClick={() => {
                                setExpandedTreeDirs(prev => { const s = new Set(prev); open ? s.delete(node.path) : s.add(node.path); return s; });
                                setUploadTargetDir(node.path);
                              }}
                              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverDirPath(node.path); }}
                              onDragLeave={(e) => { e.stopPropagation(); setDragOverDirPath(null); }}
                              onDrop={(e) => {
                                e.preventDefault(); e.stopPropagation();
                                const from = e.dataTransfer.getData('text/plain');
                                setDragOverDirPath(null);
                                if (!from || from.startsWith(node.path + '/')) return;
                                const to = `${node.path}/${from.split('/').pop()}`;
                                moveProjectFile.mutateAsync({ from, to })
                                  .then(() => toast.success(`Moved to ${node.name}/`))
                                  .catch(() => toast.error('Move failed'));
                              }}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 5,
                                paddingLeft: indent, paddingRight: 8, paddingTop: 4, paddingBottom: 4,
                                cursor: 'pointer', borderBottom: '1px solid var(--border)',
                                background: isDrop ? 'rgba(99,102,241,0.2)' : isUploadTarget ? 'rgba(99,102,241,0.07)' : 'transparent',
                                borderLeft: isDrop ? '2px solid #818cf8' : isUploadTarget ? '2px solid rgba(99,102,241,0.4)' : '2px solid transparent',
                                outline: isDrop ? '1px dashed #818cf8' : 'none',
                                fontSize: 11, fontWeight: 600, color: 'var(--text)',
                              }}
                            >
                              <span style={{ fontSize: 9, color: 'var(--text-dim)', width: 10 }}>{open ? '▾' : '▸'}</span>
                              <span>{open ? '📂' : '📁'}</span>
                              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
                              {canWrite && deletingFilePath === node.path ? (
                                <span style={{ display: 'flex', gap: 3, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                                  <span style={{ fontSize: 9, color: 'var(--fail)', whiteSpace: 'nowrap' }}>Delete?</span>
                                  <button onClick={(e) => { e.stopPropagation(); deleteProjectFile.mutateAsync(node.path).then(() => { setDeletingFilePath(null); toast.success('Deleted'); }).catch(() => toast.error('Delete failed')); }} style={{ ...BTN(), color: 'var(--rose)', fontWeight: 700, fontSize: 9, border: '1px solid rgba(220,38,38,0.3)', background: 'rgba(220,38,38,0.1)' }}>Yes</button>
                                  <button onClick={(e) => { e.stopPropagation(); setDeletingFilePath(null); }} style={{ ...BTN(), border: '1px solid var(--border)', fontSize: 9 }}>No</button>
                                </span>
                              ) : canWrite && (
                                <button onClick={(e) => { e.stopPropagation(); setDeletingFilePath(node.path); }} style={BTN()} title="Delete folder">✕</button>
                              )}
                            </div>
                            {open && node.children?.map(c => renderNode(c, depth + 1))}
                          </div>
                        );
                      }
                      // ── file node ──
                      const icon = FILE_ICONS[node.ext ?? ''] ?? '📄';
                      const isActive = selectedFilePath === node.path;
                      const isScript = node.ext === '.robot' || node.ext === '.resource';
                      const matchingScript = isScript ? scripts.find(s => s.filename === node.path || s.filename.endsWith('/' + node.name)) : undefined;
                      const isDeleting = deletingFilePath === node.path;
                      return (
                        <div
                          key={node.path}
                          draggable={canWrite}
                          onDragStart={(e) => { e.dataTransfer.setData('text/plain', node.path); setDraggedFilePath(node.path); }}
                          onDragEnd={() => setDraggedFilePath(null)}
                          onClick={() => {
                            setSelectedFilePath(node.path);
                            if (matchingScript) {
                              openTab(matchingScript);
                            } else {
                              void openProjectFileTab(node.path);
                            }
                          }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            paddingLeft: indent + 14, paddingRight: 6, paddingTop: 4, paddingBottom: 4,
                            cursor: canWrite ? 'grab' : 'pointer',
                            background: isActive ? 'rgba(34,211,238,0.08)' : 'transparent',
                            borderLeft: isActive ? '2px solid var(--cyan)' : '2px solid transparent',
                            borderBottom: '1px solid var(--border)',
                            color: isActive ? 'var(--text)' : 'var(--text-dim)',
                            fontSize: 11,
                            opacity: draggedFilePath === node.path ? 0.4 : 1,
                            transition: 'opacity 0.1s',
                          }}
                        >
                          <span>{icon}</span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
                          {isDeleting ? (
                            <span style={{ display: 'flex', gap: 3, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                              <span style={{ fontSize: 9, color: 'var(--fail)', whiteSpace: 'nowrap' }}>Delete?</span>
                              <button onClick={(e) => { e.stopPropagation(); deleteProjectFile.mutateAsync(node.path).then(() => { setDeletingFilePath(null); toast.success('Deleted'); }).catch(() => toast.error('Delete failed')); }} style={{ ...BTN(), color: 'var(--rose)', fontWeight: 700, fontSize: 9, border: '1px solid rgba(220,38,38,0.3)', background: 'rgba(220,38,38,0.1)' }}>Yes</button>
                              <button onClick={(e) => { e.stopPropagation(); setDeletingFilePath(null); }} style={{ ...BTN(), border: '1px solid var(--border)', fontSize: 9 }}>No</button>
                            </span>
                          ) : (
                            <span style={{ display: 'flex', gap: 1, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                              <button onClick={() => { downloadProjectFile(projectId ?? '', node.path); }} style={BTN({ color: 'var(--cyan)' })} title="Download">↓</button>
                              {canWrite && <button onClick={() => setDeletingFilePath(node.path)} style={BTN()} title="Delete">✕</button>}
                            </span>
                          )}
                        </div>
                      );
                    };
                    return fileTreeData.tree.map(n => renderNode(n, 0));
                  })()
                )}
              </div>}
            </div>
          )}

        </div>

        {/* ── DRAG DIVIDER ─────────────────────────────────────────────── */}
        <div
          ref={dividerRef}
          onMouseDown={handleDividerMouseDown}
          style={{
            width: 4, flexShrink: 0, cursor: 'col-resize',
            background: 'var(--border)',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--6d-orange)'; }}
          onMouseLeave={(e) => { if (!isDraggingRef.current) (e.currentTarget as HTMLDivElement).style.background = 'var(--border)'; }}
        />

        {/* ── RIGHT: Monaco Editor ───────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#06224A' }}>
          {openTabs.length === 0 ? (
            <EmptyEditor />
          ) : (
            <>
              <EditorTabs
                tabs={openTabs}
                activeId={activeTabId}
                dirtyIds={dirtyTabs}
                onActivate={setActiveTabId}
                onClose={closeTab}
              />

              {/* Editor action toolbar */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                padding: '4px 10px', gap: 6, flexShrink: 0,
                background: 'rgba(0,0,0,0.25)',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                minHeight: 32,
              }}>
                {activeTab?.kind === 'resource' && (() => {
                  const cp = `resources/${activeTab.filename}`;
                  return (
                    <span
                      style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginRight: 'auto', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={`Click to copy: ${cp}`}
                      onClick={() => navigator.clipboard.writeText(cp)}
                    >
                      {cp}
                    </span>
                  );
                })()}

                {/* ▶ Run button */}
                {activeScript?.testCaseId && (
                  <>
                    <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)', margin: '0 2px' }} />
                    <button
                      onClick={handleQuickRun}
                      disabled={quickRunning || quickRunStatus === 'PENDING' || quickRunStatus === 'RUNNING'}
                      title={`Run this script inside Docker against the default environment${envConfigs.find(e => e.isDefault) ? ` (${envConfigs.find(e => e.isDefault)!.name})` : ''}`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '3px 11px', borderRadius: 5, cursor: (quickRunning || quickRunStatus === 'RUNNING' || quickRunStatus === 'PENDING') ? 'not-allowed' : 'pointer',
                        fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                        border: '1px solid rgba(52,211,153,0.5)',
                        background: 'rgba(52,211,153,0.1)',
                        color: 'var(--emerald)',
                        opacity: (quickRunning || quickRunStatus === 'RUNNING' || quickRunStatus === 'PENDING') ? 0.6 : 1,
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        if (!quickRunning) {
                          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(52,211,153,0.2)';
                          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(52,211,153,0.8)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(52,211,153,0.1)';
                        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(52,211,153,0.5)';
                      }}
                    >
                      {(quickRunning || quickRunStatus === 'PENDING' || quickRunStatus === 'RUNNING')
                        ? <>⏳ Running…</>
                        : <>▶ Run</>}
                    </button>

                    {/* ▶ Run in Host Browser button */}
                    <button
                      onClick={handleHostBrowserRun}
                      disabled={hostRunning || hostRunStatus === 'PENDING' || hostRunStatus === 'RUNNING'}
                      title="Run in your host Chrome browser (requires Chrome running with --remote-debugging-port=9222)"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '3px 11px', borderRadius: 5,
                        cursor: (hostRunning || hostRunStatus === 'RUNNING' || hostRunStatus === 'PENDING') ? 'not-allowed' : 'pointer',
                        fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                        border: '1px solid rgba(96,165,250,0.5)',
                        background: 'rgba(96,165,250,0.1)',
                        color: 'var(--sky)',
                        opacity: (hostRunning || hostRunStatus === 'RUNNING' || hostRunStatus === 'PENDING') ? 0.6 : 1,
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        if (!hostRunning) {
                          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(96,165,250,0.2)';
                          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(96,165,250,0.8)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(96,165,250,0.1)';
                        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(96,165,250,0.5)';
                      }}
                    >
                      {(hostRunning || hostRunStatus === 'PENDING' || hostRunStatus === 'RUNNING')
                        ? <>⏳ Running in Host…</>
                        : <>🌐 Run in Host Browser</>}
                    </button>

                    {/* Inline result badge — Docker run */}
                    {quickRunId && !quickRunning && quickRunStatus && quickRunStatus !== 'PENDING' && quickRunStatus !== 'RUNNING' && (
                      <>
                        <span
                          title="Click to view full run results"
                          onClick={() => navigate(`/projects/${slug}/execution?runId=${quickRunId}`)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                            fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                            border: quickRunStatus === 'PASSED'
                              ? '1px solid rgba(52,211,153,0.5)'
                              : quickRunStatus === 'FAILED'
                              ? '1px solid rgba(248,113,113,0.5)'
                              : '1px solid rgba(255,255,255,0.15)',
                            background: quickRunStatus === 'PASSED'
                              ? 'rgba(52,211,153,0.1)'
                              : quickRunStatus === 'FAILED'
                              ? 'rgba(248,113,113,0.1)'
                              : 'rgba(255,255,255,0.05)',
                            color: quickRunStatus === 'PASSED'
                              ? 'var(--emerald)'
                              : quickRunStatus === 'FAILED'
                              ? 'var(--rose)'
                              : 'var(--text-dim)',
                          }}
                        >
                          {quickRunStatus === 'PASSED' ? '✅ PASSED' : quickRunStatus === 'FAILED' ? '❌ FAILED' : `⚠ ${quickRunStatus}`}
                          <span style={{ fontSize: 9, opacity: 0.7 }}>↗</span>
                        </span>
                        {quickRunId && (
                          <button
                            onClick={() => { setMonitorRunId(quickRunId); setMonitorScript(activeScript?.filename ?? ''); setShowMonitor(true); }}
                            title="Open execution monitor"
                            style={{
                              fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                              background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                              color: 'var(--text-dim)', fontFamily: 'var(--font-ui)',
                            }}
                          >
                            ◫ Monitor
                          </button>
                        )}
                      </>
                    )}

                    {/* Inline result badge — Host browser run */}
                    {hostRunId && !hostRunning && hostRunStatus && hostRunStatus !== 'PENDING' && hostRunStatus !== 'RUNNING' && (
                      <>
                        <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-ui)' }}>🌐</span>
                        <span
                          title="Click to view host-browser run results"
                          onClick={() => navigate(`/projects/${slug}/execution?runId=${hostRunId}`)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                            fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                            border: hostRunStatus === 'PASSED'
                              ? '1px solid rgba(96,165,250,0.5)'
                              : hostRunStatus === 'FAILED'
                              ? '1px solid rgba(248,113,113,0.5)'
                              : '1px solid rgba(255,255,255,0.15)',
                            background: hostRunStatus === 'PASSED'
                              ? 'rgba(96,165,250,0.1)'
                              : hostRunStatus === 'FAILED'
                              ? 'rgba(248,113,113,0.1)'
                              : 'rgba(255,255,255,0.05)',
                            color: hostRunStatus === 'PASSED'
                              ? 'var(--sky)'
                              : hostRunStatus === 'FAILED'
                              ? 'var(--rose)'
                              : 'var(--text-dim)',
                          }}
                        >
                          {hostRunStatus === 'PASSED' ? '✅ PASSED' : hostRunStatus === 'FAILED' ? '❌ FAILED' : `⚠ ${hostRunStatus}`}
                          <span style={{ fontSize: 9, opacity: 0.7 }}>↗</span>
                        </span>
                        <button
                          onClick={() => { setMonitorRunId(hostRunId); setMonitorScript(activeScript?.filename ?? ''); setShowMonitor(true); }}
                          title="Open host-browser execution monitor"
                          style={{
                            fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                            background: 'transparent', border: '1px solid rgba(96,165,250,0.2)',
                            color: 'var(--sky)', fontFamily: 'var(--font-ui)',
                          }}
                        >
                          ◫ Monitor
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>

              <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                {loadingContent && (
                  <div style={{
                    position: 'absolute', inset: 0, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(6,34,74,0.8)', zIndex: 10,
                    color: '#60a5fa', fontSize: 13,
                  }}>
                    Loading…
                  </div>
                )}
                <Editor
                  height="100%"
                  onMount={(editor, monaco) => {
                    monacoEditorRef.current = editor;

                    if (!rfLangRegisteredRef.current) {
                      rfLangRegisteredRef.current = true;
                      monaco.languages.register({ id: 'robotframework' });
                      monaco.languages.registerHoverProvider('robotframework', {
                        provideHover: (model: any, position: any) => {
                          const kw = findRFKeywordAtPosition(model, position, keywordIndexRef.current);
                          if (!kw) return null;
                          const def = keywordIndexRef.current[kw];
                          return {
                            contents: [
                              { value: `**${kw}**` },
                              { value: `Defined in \`${def.filename}\` — line ${def.line}` },
                              { value: '_Ctrl+Click or F12 to go to definition_' },
                            ],
                          };
                        },
                      });
                    }

                    // F12 — go to keyword definition
                    editor.addAction({
                      id: 'go-to-rf-keyword-definition',
                      label: 'Go to Keyword Definition (Robot Framework)',
                      keybindings: [monaco.KeyCode.F12],
                      run: (ed) => {
                        const pos = ed.getPosition();
                        if (!pos) return;
                        const kw = findRFKeywordAtPosition(ed.getModel(), pos, keywordIndexRef.current);
                        if (kw) openResourceTabRef.current(keywordIndexRef.current[kw].filename, keywordIndexRef.current[kw].line);
                      },
                    });

                    // Ctrl+H — Find and Replace
                    editor.addAction({
                      id: 'open-find-replace',
                      label: 'Find and Replace',
                      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH],
                      run: (ed) => {
                        ed.getAction('editor.action.startFindReplaceAction')?.run();
                      },
                    });

                    // Ctrl+Click — go to keyword definition
                    editor.onMouseDown((e) => {
                      if (!(e.event.ctrlKey || e.event.metaKey)) return;
                      if (e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) return;
                      const pos = e.target.position;
                      if (!pos) return;
                      const kw = findRFKeywordAtPosition(editor.getModel(), pos, keywordIndexRef.current);
                      if (kw) {
                        e.event.preventDefault();
                        openResourceTabRef.current(keywordIndexRef.current[kw].filename, keywordIndexRef.current[kw].line);
                      }
                    });
                  }}
                  language={(() => {
                    const fn = activeTab?.filename ?? '';
                    if (fn.endsWith('.robot') || fn.endsWith('.resource')) return 'robotframework';
                    if (fn.endsWith('.py')) return 'python';
                    if (fn.endsWith('.yaml') || fn.endsWith('.yml')) return 'yaml';
                    if (fn.endsWith('.json')) return 'json';
                    if (fn.endsWith('.csv') || fn.endsWith('.tsv')) return 'plaintext';
                    if (fn.endsWith('.ts') || fn.endsWith('.tsx')) return 'typescript';
                    return 'plaintext';
                  })()}
                  theme="vs-dark"
                  value={activeContent}
                  onChange={(v) => {
                    if (!activeTabId || v === undefined) return;
                    setTabContents((prev) => ({ ...prev, [activeTabId]: v }));
                    setDirtyTabs((prev) => new Set([...prev, activeTabId]));
                  }}
                  options={{
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    fontSize: 13, lineHeight: 20,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: 'on', tabSize: (activeTab?.kind === 'resource' || activeTab?.kind === 'projectfile') ? 4 : 2,
                    renderLineHighlight: 'line',
                    scrollbar: { verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
                    overviewRulerLanes: 0,
                    padding: { top: 12, bottom: 12 },
                  }}
                />
              </div>

              {/* Status bar */}
              <div style={{
                height: 24, background: 'rgba(0,0,0,0.3)',
                borderTop: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', padding: '0 12px', gap: 16,
                fontSize: 11, fontFamily: 'var(--font-mono)',
                color: 'rgba(226,232,240,0.5)', flexShrink: 0,
              }}>
                <span style={{ color: 'rgba(226,232,240,0.8)' }}>{activeTab?.filename ?? ''}</span>
                {activeTab?.kind === 'resource' ? (
                  <span style={{ color: 'var(--emerald)', fontWeight: 700 }}>🤖 Robot Framework</span>
                ) : activeScript?.scriptType === 'ROBOT' ? (
                  <span style={{ color: 'var(--emerald)', fontWeight: 700 }}>🤖 Robot Framework</span>
                ) : (
                  <>
                    <span>TypeScript</span>
                    <span>TS 5.0</span>
                  </>
                )}
                {statusSize && <span>{statusSize}</span>}
                {statusDirty
                  ? <span style={{ color: '#fbbf24' }}>● Modified</span>
                  : <span style={{ color: '#34d399' }}>✓ Saved</span>}
                <div style={{ flex: 1 }} />
                {statusDirty && (
                  <button
                    onClick={saveActiveTab}
                    disabled={save.isPending || saveResource.isPending}
                    style={{
                      background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.3)',
                      borderRadius: 4, color: '#60a5fa', cursor: 'pointer',
                      fontSize: 10, padding: '1px 8px', fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {(save.isPending || saveResource.isPending) ? 'Saving…' : '↑ Save (Ctrl+S)'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
