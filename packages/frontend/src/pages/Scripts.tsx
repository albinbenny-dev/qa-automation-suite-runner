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
} from '../hooks/useScripts';
import {
  useResources,
  useUploadResource,
  useSaveResource,
  useDeleteResource,
  useCreateFolder,
  useDeleteFolder,
  useMoveResource,
  downloadResource,
} from '../hooks/useResources';
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
    .map(([name, tcs], i) => ({ name, tcs, color: ucColor(name, i) }));
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

// ── ImportScriptModal ────────────────────────────────────────────────────────

type ImportMode = 'link' | 'standalone';

interface ImportScriptModalProps {
  projectId: string;
  testCases: TestCase[];
  preSelectedTcId?: string;
  onClose: () => void;
}

function ImportScriptModal({ projectId, testCases, preSelectedTcId, onClose }: ImportScriptModalProps) {
  const [importMode, setImportMode] = useState<ImportMode>(preSelectedTcId ? 'link' : 'standalone');
  const [selectedTcId, setSelectedTcId] = useState(preSelectedTcId ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversionNote, setConversionNote] = useState<{ converted: boolean; filename: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useUploadScript(projectId);

  const filteredTCs = useMemo(() => {
    const q = search.toLowerCase();
    return testCases
      .filter((tc) => tc.title.toLowerCase().includes(q) || tc.tcId.toLowerCase().includes(q))
      .slice(0, 40);
  }, [testCases, search]);

  async function handleImport() {
    if (!file) {
      toast.error('Select a script file first');
      return;
    }
    setBusy(true);
    try {
      const tcId = importMode === 'link' ? (selectedTcId || undefined) : undefined;
      const result = await upload.mutateAsync({ file, testCaseId: tcId });
      if (result.converted) {
        setConversionNote({ converted: true, filename: result.filename });
      } else {
        const linked = tcId ? testCases.find((tc) => tc.id === tcId) : null;
        toast.success(linked ? `Imported and linked to ${linked.tcId}` : `Imported ${file.name}`);
        onClose();
      }
    } catch {
      toast.error('Import failed');
    }
    setBusy(false);
  }

  const INPUT_STYLE_SM: React.CSSProperties = {
    width: '100%', padding: '7px 10px', background: 'var(--surface2)',
    border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)',
    fontSize: 11, outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-ui)',
  };

  const MODE_OPTS: { value: ImportMode; label: string; desc: string }[] = [
    { value: 'link',       label: 'Link to existing TC',   desc: 'Choose a TC from your library to associate this script with.' },
    { value: 'standalone', label: 'Import standalone',     desc: 'No TC — custom script only.' },
  ];

  return (
    <div style={MODAL_OVERLAY} onClick={onClose}>
      <div style={MODAL_BOX} onClick={(e) => e.stopPropagation()}>
        <div style={MODAL_HEADER}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>⬆ Import Script</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={MODAL_BODY}>
          {/* Conversion result banner */}
          {conversionNote && (
            <div style={{
              padding: '10px 12px', borderRadius: 6,
              background: 'rgba(42,157,143,0.1)',
              border: '1px solid rgba(42,157,143,0.4)',
              fontSize: 11, lineHeight: 1.6,
            }}>
              <div style={{ fontWeight: 700, color: 'var(--emerald)', marginBottom: 4 }}>
                ✅ Converted: SeleniumLibrary → Browser library
              </div>
              <div style={{ color: 'var(--text-mid)' }}>
                Saved as <code style={{ fontFamily: 'var(--font-mono)' }}>{conversionNote.filename}</code> using RF Browser library (Playwright backend).
              </div>
              <button
                onClick={onClose}
                style={{ marginTop: 8, padding: '4px 12px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, background: 'var(--surface3)', color: 'var(--text-mid)', fontFamily: 'var(--font-ui)' }}
              >
                Done
              </button>
            </div>
          )}

          {!conversionNote && <>
            {/* Mode selector */}
            <div>
              <span style={LABEL_STYLE}>Import Mode</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {MODE_OPTS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setImportMode(opt.value)}
                    style={{
                      flex: 1, padding: '7px 6px', borderRadius: 6, cursor: 'pointer',
                      fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-ui)',
                      border: importMode === opt.value ? '1px solid rgba(139,92,246,0.6)' : '1px solid var(--border)',
                      background: importMode === opt.value ? 'rgba(139,92,246,0.12)' : 'transparent',
                      color: importMode === opt.value ? 'var(--violet)' : 'var(--text-dim)',
                      transition: 'all 0.15s', textAlign: 'center',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '5px 0 0', lineHeight: 1.5 }}>
                {MODE_OPTS.find(o => o.value === importMode)?.desc}
              </p>
            </div>

            {/* File picker */}
            <div>
              <span style={LABEL_STYLE}>
                Script File <span style={{ color: '#f87171', fontWeight: 400 }}>*</span>
                {file?.name.toLowerCase().endsWith('.robot') && (
                  <span style={{ marginLeft: 6, color: 'var(--emerald)', fontWeight: 400 }}>
                    🤖 Robot Framework — SeleniumLibrary will be auto-converted if detected
                  </span>
                )}
              </span>
              <button
                onClick={() => fileRef.current?.click()}
                style={{
                  width: '100%', padding: '18px 12px',
                  border: `2px dashed ${file ? 'var(--emerald)' : 'var(--border)'}`,
                  borderRadius: 8, background: file ? 'rgba(42,157,143,0.06)' : 'transparent',
                  cursor: 'pointer', color: file ? 'var(--text)' : 'var(--text-dim)',
                  fontSize: 12, fontFamily: 'var(--font-ui)', textAlign: 'center',
                  transition: 'all 0.15s',
                }}
              >
                {file ? `📄 ${file.name}` : '+ Click to select a .robot file'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".robot"
                style={{ display: 'none' }}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            {/* TC selector — only shown in 'link' mode */}
            {importMode === 'link' && (
              <div>
                <span style={LABEL_STYLE}>Link to Test Case <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(optional)</span></span>
                <input
                  type="text"
                  placeholder="Search by title or TC ID…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={INPUT_STYLE_SM}
                />
                <div style={{
                  maxHeight: 160, overflowY: 'auto', marginTop: 4,
                  border: '1px solid var(--border)', borderRadius: 6,
                  background: 'var(--surface2)',
                }}>
                  <div
                    onClick={() => setSelectedTcId('')}
                    style={{
                      padding: '7px 10px', cursor: 'pointer', fontSize: 11,
                      background: !selectedTcId ? 'rgba(37,99,171,0.18)' : 'transparent',
                      color: !selectedTcId ? 'var(--cyan)' : 'var(--text-dim)',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    None — upload as unlinked custom script
                  </div>
                  {filteredTCs.map((tc) => (
                    <div
                      key={tc.id}
                      onClick={() => setSelectedTcId(tc.id)}
                      style={{
                        padding: '7px 10px', cursor: 'pointer', fontSize: 11,
                        background: selectedTcId === tc.id ? 'rgba(37,99,171,0.18)' : 'transparent',
                        color: selectedTcId === tc.id ? 'var(--cyan)' : 'var(--text-mid)',
                        display: 'flex', gap: 8, alignItems: 'baseline',
                      }}
                    >
                      <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>{tc.tcId}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tc.title}</span>
                    </div>
                  ))}
                  {filteredTCs.length === 0 && search && (
                    <div style={{ padding: '8px 10px', color: 'var(--text-dim)', fontSize: 11 }}>No matches</div>
                  )}
                </div>
                {selectedTcId && (
                  <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '5px 0 0', lineHeight: 1.5 }}>
                    Any existing script for this test case will be replaced.
                  </p>
                )}
              </div>
            )}
          </>}
        </div>

        {!conversionNote && (
          <div style={MODAL_FOOTER}>
            <button onClick={onClose} style={BTN_CANCEL}>Cancel</button>
            <button
              onClick={handleImport}
              disabled={!file || busy}
              style={{
                padding: '7px 18px', borderRadius: 6, border: 'none',
                cursor: !file || busy ? 'not-allowed' : 'pointer',
                fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-ui)', color: '#fff',
                background: 'linear-gradient(135deg, var(--violet), var(--cyan))',
                opacity: !file || busy ? 0.55 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {busy ? (file?.name.toLowerCase().endsWith('.robot') ? 'Converting…' : 'Importing…') : '⬆ Import'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ImportFolderModal ─────────────────────────────────────────────────────────

interface ImportFolderResult {
  filesImported: number;
  tcsCreated: number;
  warnings: string[];
}

interface ImportFolderModalProps {
  projectId: string;
  onClose: () => void;
  onDone: () => void;
}

function ImportFolderModal({ projectId, onClose, onDone }: ImportFolderModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportFolderResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleImport() {
    if (!file) { toast.error('Select a zip file first'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('folder', file);
      const token = localStorage.getItem('qai-token') ?? '';
      const res = await fetch(`/api/projects/${projectId}/scripts/import-folder`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error ?? 'Import failed');
      }
      const data: ImportFolderResult = await res.json();
      setResult(data);
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Import failed');
    }
    setBusy(false);
  }

  if (result) {
    return (
      <div style={MODAL_OVERLAY} onClick={onClose}>
        <div style={MODAL_BOX} onClick={(e) => e.stopPropagation()}>
          <div style={MODAL_HEADER}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>📦 Folder Import Complete</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
          <div style={MODAL_BODY}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{
                  flex: 1, padding: '12px', borderRadius: 8, textAlign: 'center',
                  background: 'rgba(42,157,143,0.1)', border: '1px solid rgba(42,157,143,0.3)',
                }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--emerald)' }}>{result.filesImported}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>Scripts imported</div>
                </div>
                <div style={{
                  flex: 1, padding: '12px', borderRadius: 8, textAlign: 'center',
                  background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)',
                }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--violet)' }}>{result.tcsCreated}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>TCs linked/created</div>
                </div>
              </div>
              {result.warnings.length > 0 && (
                <div style={{ padding: '10px 12px', borderRadius: 6, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', marginBottom: 6 }}>⚠ Warnings</div>
                  {result.warnings.map((w, i) => (
                    <div key={i} style={{ fontSize: 10, color: 'var(--text-mid)', lineHeight: 1.6, fontFamily: 'var(--font-mono)' }}>{w}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div style={MODAL_FOOTER}>
            <button
              onClick={() => { onDone(); onClose(); }}
              style={{
                padding: '7px 18px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-ui)', color: '#fff',
                background: 'linear-gradient(135deg, var(--emerald), var(--cyan))',
              }}
            >
              ✓ Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={MODAL_OVERLAY} onClick={onClose}>
      <div style={MODAL_BOX} onClick={(e) => e.stopPropagation()}>
        <div style={MODAL_HEADER}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>📦 Import Folder</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={MODAL_BODY}>
          <div>
            <span style={LABEL_STYLE}>Zip File <span style={{ color: '#f87171', fontWeight: 400 }}>*</span></span>
            <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '0 0 8px', lineHeight: 1.6 }}>
              Upload a <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--cyan)' }}>.zip</code> archive containing <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--emerald)' }}>.robot</code> files. Each file will be imported as a script and linked to a matching test case where possible.
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                width: '100%', padding: '22px 12px',
                border: `2px dashed ${file ? 'var(--cyan)' : 'var(--border)'}`,
                borderRadius: 8, background: file ? 'rgba(34,211,238,0.05)' : 'transparent',
                cursor: 'pointer', color: file ? 'var(--text)' : 'var(--text-dim)',
                fontSize: 12, fontFamily: 'var(--font-ui)', textAlign: 'center',
                transition: 'all 0.15s',
              }}
            >
              {file ? `📦 ${file.name} (${(file.size / 1024).toFixed(1)} KB)` : '+ Click to select a .zip file'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".zip"
              style={{ display: 'none' }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        <div style={MODAL_FOOTER}>
          <button onClick={onClose} style={BTN_CANCEL}>Cancel</button>
          <button
            onClick={handleImport}
            disabled={!file || busy}
            style={{
              padding: '7px 18px', borderRadius: 6, border: 'none',
              cursor: !file || busy ? 'not-allowed' : 'pointer',
              fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-ui)', color: '#fff',
              background: 'linear-gradient(135deg, var(--violet), var(--cyan))',
              opacity: !file || busy ? 0.55 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {busy ? 'Importing…' : '📦 Import Folder'}
          </button>
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

  // ── Resources state ────────────────────────────────────────────────────────
  const { data: resources = [], isLoading: resourcesLoading } = useResources(projectId);
  const uploadResource = useUploadResource(projectId ?? '');
  const saveResource = useSaveResource(projectId ?? '');
  const deleteResource = useDeleteResource(projectId ?? '');
  const deleteFolder = useDeleteFolder(projectId ?? '');
  const moveResource = useMoveResource(projectId ?? '');
  const resourceFileRef = useRef<HTMLInputElement>(null);
  const createFolder = useCreateFolder(projectId ?? '');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [uploadFolder, setUploadFolder] = useState<string>('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [deletingResourceFile, setDeletingResourceFile] = useState<string | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);
  const [movingResource, setMovingResource] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [newFolderInput, setNewFolderInput] = useState('');
  const [selectedResourcePath, setSelectedResourcePath] = useState<string>('');
  const [pathCopied, setPathCopied] = useState(false);

  // Base container path shared by all resources
  const resourcesBase = useMemo(() => {
    for (const r of resources) {
      if (r.containerPath && r.filename) {
        return r.containerPath.slice(0, r.containerPath.length - r.filename.length - 1);
      }
    }
    return null;
  }, [resources]);
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

  const [leftTab, setLeftTab] = useState<'tcs' | 'scripts' | 'resources'>('tcs');
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
    if (!defaultEnv) {
      toast.error('No environment configured — add one in Project Settings first.');
      return;
    }
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
        environment: defaultEnv.name,
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
    if (!defaultEnv) {
      toast.error('No environment configured — add one in Project Settings first.');
      return;
    }
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
        environment: defaultEnv.name,
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
  const [showImportFolderModal, setShowImportFolderModal] = useState(false);

  function handleOpenImport(tcId = '') {
    setImportPreTcId(tcId);
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
          const res = await api.get<{ content: string }>(
            `/projects/${projectId}/resources/${filename}/content`,
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

      {/* Import script modal */}
      {showImportModal && projectId && (
        <ImportScriptModal
          projectId={projectId}
          testCases={allTCs.filter((tc) => !scriptedTcIds.has(tc.id))}
          preSelectedTcId={importPreTcId}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {/* Import folder modal */}
      {showImportFolderModal && projectId && (
        <ImportFolderModal
          projectId={projectId}
          onClose={() => setShowImportFolderModal(false)}
          onDone={() => void qc.invalidateQueries({ queryKey: ['scripts', projectId] })}
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
                <TbBtn variant="ghost" onClick={() => setShowImportFolderModal(true)}>
                  📦 Import Folder
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
            <button
              onClick={() => setLeftTab('tcs')}
              style={{
                flex: 1, padding: '9px 10px', border: 'none', cursor: 'pointer',
                background: leftTab === 'tcs' ? 'var(--surface)' : 'transparent',
                borderBottom: leftTab === 'tcs' ? '2px solid var(--6d-orange)' : '2px solid transparent',
                color: leftTab === 'tcs' ? 'var(--text)' : 'var(--text-dim)',
                fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                transition: 'all 0.15s',
              }}
            >
              📋 Test Cases
              {pendingCount > 0 && (
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10,
                  background: 'var(--violet)', color: 'white', lineHeight: '14px',
                }}>
                  {pendingCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setLeftTab('scripts')}
              style={{
                flex: 1, padding: '9px 10px', border: 'none', cursor: 'pointer',
                background: leftTab === 'scripts' ? 'var(--surface)' : 'transparent',
                borderBottom: leftTab === 'scripts' ? '2px solid var(--cyan)' : '2px solid transparent',
                color: leftTab === 'scripts' ? 'var(--text)' : 'var(--text-dim)',
                fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                transition: 'all 0.15s',
              }}
            >
              📄 Scripts
              {scripts.length > 0 && (
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10,
                  background: 'var(--surface3)', color: 'var(--text-dim)', lineHeight: '14px',
                }}>
                  {scripts.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setLeftTab('resources')}
              style={{
                flex: 1, padding: '9px 10px', border: 'none', cursor: 'pointer',
                background: leftTab === 'resources' ? 'var(--surface)' : 'transparent',
                borderBottom: leftTab === 'resources' ? '2px solid var(--emerald)' : '2px solid transparent',
                color: leftTab === 'resources' ? 'var(--text)' : 'var(--text-dim)',
                fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                transition: 'all 0.15s',
              }}
              title="Robot Framework resource files (keywords.robot, variables.robot)"
            >
              🗂 Resources
              {resources.length > 0 && (
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10,
                  background: 'rgba(42,157,143,0.18)', color: 'var(--emerald)', lineHeight: '14px',
                }}>
                  {resources.filter(r => !r.filename.endsWith('.gitkeep')).length}
                </span>
              )}
            </button>
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

          {/* ── SCRIPTS TAB ── */}
          {leftTab === 'scripts' && (
            <>
              {canWrite && (
                <div style={{
                  padding: '8px 10px', borderBottom: '1px solid var(--border)',
                  flexShrink: 0, display: 'flex', gap: 6,
                }}>
                  <button
                    onClick={() => handleOpenImport()}
                    style={{
                      flex: 1, padding: '6px 8px',
                      background: 'linear-gradient(90deg, rgba(42,157,143,0.8), rgba(34,211,238,0.7))',
                      border: 'none', borderRadius: 5, cursor: 'pointer',
                      color: '#fff', fontWeight: 700, fontSize: 11,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    }}
                  >
                    ⬆ Import Script
                  </button>
                  <button
                    onClick={() => setShowImportFolderModal(true)}
                    style={{
                      padding: '6px 8px', background: 'transparent',
                      border: '1px solid var(--border)', borderRadius: 5,
                      cursor: 'pointer', color: 'var(--text-mid)', fontSize: 11,
                    }}
                    title="Import a zip folder of .robot files"
                  >
                    📦
                  </button>
                </div>
              )}

              {scriptsLoading ? (
                <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 12 }}>Loading…</div>
              ) : (
                <FileTree
                  scripts={scripts}
                  activeId={activeTabId}
                  onSelect={openTab}
                  onDelete={handleDelete}
                  canDelete={canWrite}
                />
              )}
            </>
          )}

          {/* ── RESOURCES TAB ── */}
          {leftTab === 'resources' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              {/* Toolbar: New Folder + Upload */}
              {canWrite && (
                <div style={{ flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
                  {/* Absolute path display */}
                  {(() => {
                    const uploadTargetPath = resourcesBase
                      ? (uploadFolder ? `${resourcesBase}/${uploadFolder}` : resourcesBase)
                      : uploadFolder || '';
                    const displayPath = selectedResourcePath || uploadTargetPath || resourcesBase || '';
                    return (
                      <div style={{
                        padding: '6px 10px', borderBottom: '1px solid var(--border)',
                        background: 'rgba(42,157,143,0.06)',
                      }}>
                        <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                          {selectedResourcePath ? 'Selected path' : 'Upload target'}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span
                            style={{
                              flex: 1, fontFamily: 'var(--font-mono)', fontSize: 10,
                              color: 'var(--emerald)', fontWeight: 600,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}
                            title={displayPath}
                          >
                            {displayPath}
                          </span>
                          <button
                            onClick={() => {
                              if (!displayPath) return;
                              const finish = () => { setPathCopied(true); setTimeout(() => setPathCopied(false), 1500); };
                              try {
                                navigator.clipboard.writeText(displayPath).then(finish).catch(() => {
                                  const ta = document.createElement('textarea');
                                  ta.value = displayPath; ta.style.cssText = 'position:fixed;opacity:0';
                                  document.body.appendChild(ta); ta.select(); document.execCommand('copy');
                                  document.body.removeChild(ta); finish();
                                });
                              } catch {
                                const ta = document.createElement('textarea');
                                ta.value = displayPath; ta.style.cssText = 'position:fixed;opacity:0';
                                document.body.appendChild(ta); ta.select(); document.execCommand('copy');
                                document.body.removeChild(ta); finish();
                              }
                            }}
                            title="Copy path to clipboard"
                            style={{
                              flexShrink: 0, padding: '2px 7px', fontSize: 9, fontWeight: 700,
                              background: pathCopied ? 'rgba(42,157,143,0.25)' : 'rgba(42,157,143,0.1)',
                              border: `1px solid rgba(42,157,143,${pathCopied ? '0.5' : '0.25'})`,
                              borderRadius: 3, cursor: 'pointer',
                              color: pathCopied ? 'var(--emerald)' : 'var(--text-dim)',
                              transition: 'all 0.15s',
                            }}
                          >
                            {pathCopied ? '✓ copied' : '⎘ copy'}
                          </button>
                          {(uploadFolder || selectedResourcePath) && (
                            <button
                              onClick={() => { setUploadFolder(''); setSelectedResourcePath(''); }}
                              title="Reset to root"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 11, padding: '1px 3px', flexShrink: 0 }}
                            >✕</button>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{ padding: '6px 8px', display: 'flex', gap: 5 }}>
                    <button
                      onClick={() => { setShowNewFolder(v => !v); setNewFolderInput(''); }}
                      title="Create a new folder"
                      style={{
                        padding: '5px 7px', fontSize: 10, fontWeight: 700,
                        background: showNewFolder ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.08)',
                        border: '1px solid rgba(99,102,241,0.35)', borderRadius: 4, cursor: 'pointer',
                        color: '#a5b4fc', whiteSpace: 'nowrap',
                      }}
                    >
                      📁 New Folder
                    </button>
                    <button
                      onClick={() => resourceFileRef.current?.click()}
                      style={{
                        flex: 1, padding: '5px 7px',
                        background: 'linear-gradient(90deg, rgba(42,157,143,0.8), rgba(34,211,238,0.7))',
                        border: 'none', borderRadius: 4, cursor: 'pointer',
                        color: '#fff', fontWeight: 700, fontSize: 10, whiteSpace: 'nowrap',
                      }}
                    >
                      ⬆ Upload
                    </button>
                    <input
                      ref={resourceFileRef}
                      type="file"
                      accept=".robot,.py,.yaml,.yml,.txt,.csv,.tsv,.resource,.xlsx,.xls,.pdf,.jpg,.jpeg,.png,.gif,.bmp,.webp"
                      style={{ display: 'none' }}
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        try {
                          const result = await uploadResource.mutateAsync({ file: f, folder: uploadFolder });
                          toast.success(`Uploaded ${result.filename}`);
                          openResourceTab(result.filename);
                        } catch {
                          toast.error('Upload failed');
                        }
                        e.target.value = '';
                      }}
                    />
                  </div>

                  {/* New Folder inline form */}
                  {showNewFolder && (
                    <div style={{
                      padding: '6px 8px 8px', display: 'flex', gap: 5, alignItems: 'center',
                      background: 'rgba(99,102,241,0.06)', borderTop: '1px solid rgba(99,102,241,0.2)',
                    }}>
                      <span style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                        📁 {uploadFolder ? `${uploadFolder}/` : ''}
                      </span>
                      <input
                        autoFocus
                        value={newFolderInput}
                        onChange={e => setNewFolderInput(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            const name = newFolderInput.trim().replace(/[^a-zA-Z0-9._\-/]/g, '_');
                            if (!name) return;
                            const fullPath = uploadFolder ? `${uploadFolder}/${name}` : name;
                            try {
                              await createFolder.mutateAsync(fullPath);
                              setExpandedFolders(prev => new Set([...prev, fullPath.split('/')[0], fullPath]));
                              toast.success(`Created folder: ${fullPath}`);
                              setShowNewFolder(false);
                              setNewFolderInput('');
                            } catch { toast.error('Failed to create folder'); }
                          }
                          if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderInput(''); }
                        }}
                        placeholder="folder-name  (Enter to create)"
                        style={{
                          flex: 1, padding: '4px 7px', fontSize: 10,
                          background: 'var(--bg-2)', border: '1px solid rgba(99,102,241,0.4)',
                          borderRadius: 4, color: 'var(--text)', outline: 'none',
                          fontFamily: 'var(--font-mono)',
                        }}
                      />
                      <button
                        onClick={async () => {
                          const name = newFolderInput.trim().replace(/[^a-zA-Z0-9._\-/]/g, '_');
                          if (!name) return;
                          const fullPath = uploadFolder ? `${uploadFolder}/${name}` : name;
                          try {
                            await createFolder.mutateAsync(fullPath);
                            setExpandedFolders(prev => new Set([...prev, fullPath.split('/')[0], fullPath]));
                            toast.success(`Created folder: ${fullPath}`);
                            setShowNewFolder(false);
                            setNewFolderInput('');
                          } catch { toast.error('Failed to create folder'); }
                        }}
                        style={{
                          padding: '4px 8px', fontSize: 10, fontWeight: 700,
                          background: 'rgba(99,102,241,0.25)', border: '1px solid rgba(99,102,241,0.4)',
                          borderRadius: 4, cursor: 'pointer', color: '#a5b4fc',
                        }}
                      >
                        Create
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Resource file tree */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {resourcesLoading ? (
                  <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 12 }}>Loading…</div>
                ) : resources.length === 0 ? (
                  <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 11, lineHeight: 1.7 }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
                    <div style={{ marginBottom: 10 }}>
                      No resource files yet. Click <strong style={{ color: 'var(--emerald)' }}>✦ Init Defaults</strong> to auto-create starter files:
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-mid)', textAlign: 'left', display: 'inline-block' }}>
                      {['common_keywords.robot', 'variables.robot', 'navigation_helpers.robot', 'assertions.robot'].map(f => (
                        <div key={f} style={{ marginBottom: 2 }}>📄 {f}</div>
                      ))}
                    </div>
                  </div>
                ) : (() => {
                  type RTreeNode =
                    | { type: 'file'; name: string; path: string; resource: typeof resources[0] }
                    | { type: 'folder'; name: string; path: string; children: RTreeNode[] };

                  function buildTree(files: typeof resources): RTreeNode[] {
                    const root: RTreeNode[] = [];
                    for (const r of [...files].sort((a, b) => a.filename.localeCompare(b.filename))) {
                      const parts = r.filename.split('/');
                      let current = root;
                      let curPath = '';
                      for (let i = 0; i < parts.length - 1; i++) {
                        curPath = curPath ? `${curPath}/${parts[i]}` : parts[i];
                        let folder = current.find(n => n.type === 'folder' && n.name === parts[i]) as (RTreeNode & { type: 'folder' }) | undefined;
                        if (!folder) {
                          folder = { type: 'folder', name: parts[i], path: curPath, children: [] };
                          current.push(folder);
                        }
                        current = folder.children;
                      }
                      current.push({ type: 'file', name: parts[parts.length - 1], path: r.filename, resource: r });
                    }
                    return root;
                  }

                  const fileIcon = (name: string) => {
                    if (name.endsWith('.robot') || name.endsWith('.resource')) return '🤖';
                    if (name.endsWith('.py')) return '🐍';
                    if (name.endsWith('.yaml') || name.endsWith('.yml')) return '📋';
                    if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) return '📄';
                    return '📎';
                  };
                  const isEditable = (name: string) =>
                    ['.robot', '.resource', '.py', '.yaml', '.yml', '.csv', '.tsv', '.txt'].some(ext => name.endsWith(ext));

                  function renderTree(nodes: RTreeNode[], depth: number): React.ReactNode {
                    return nodes.map(node => {
                      if (node.type === 'folder') {
                        const isOpen = expandedFolders.has(node.path);
                        const isTarget = uploadFolder === node.path;
                        const isDragTarget = dragOverFolder === node.path;
                        return (
                          <React.Fragment key={node.path}>
                            <div
                              onClick={() => {
                                setExpandedFolders(prev => {
                                  const next = new Set(prev);
                                  isOpen ? next.delete(node.path) : next.add(node.path);
                                  return next;
                                });
                                setUploadFolder(node.path);
                                const fullPath = resourcesBase ? `${resourcesBase}/${node.path}` : node.path;
                                setSelectedResourcePath(fullPath);
                              }}
                              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverFolder(node.path); }}
                              onDragLeave={(e) => { e.stopPropagation(); setDragOverFolder(null); }}
                              onDrop={(e) => {
                                e.preventDefault(); e.stopPropagation();
                                const filename = e.dataTransfer.getData('text/plain');
                                setDragOverFolder(null);
                                if (!filename || filename.startsWith(node.path + '/')) return;
                                moveResource.mutateAsync({ filename, destination: node.path }).then(() => {
                                  closeTab(`resource:${filename}`);
                                  toast.success(`Moved to ${node.name}`);
                                }).catch(() => toast.error('Move failed'));
                              }}
                              title={resourcesBase ? `${resourcesBase}/${node.path}` : node.path}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: `5px 12px 5px ${12 + depth * 14}px`,
                                cursor: 'pointer', userSelect: 'none',
                                borderBottom: '1px solid var(--border)',
                                background: isDragTarget ? 'rgba(99,102,241,0.25)' : isTarget ? 'rgba(99,102,241,0.1)' : 'transparent',
                                borderLeft: isDragTarget ? '2px solid #818cf8' : isTarget ? '2px solid #818cf8' : '2px solid transparent',
                                outline: isDragTarget ? '1px dashed #818cf8' : 'none',
                              }}
                            >
                              <span style={{ fontSize: 9, color: 'var(--text-dim)', width: 10, flexShrink: 0 }}>
                                {isOpen ? '▾' : '▸'}
                              </span>
                              <span style={{ fontSize: 12 }}>{isOpen ? '📂' : '📁'}</span>
                              <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: isTarget ? '#a5b4fc' : 'var(--text)' }}>{node.name}</span>
                              {canWrite && (
                                deletingFolder === node.path ? (
                                  <div style={{ display: 'flex', gap: 3, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                                    <span style={{ fontSize: 9, color: 'var(--fail)', whiteSpace: 'nowrap' }}>Delete folder?</span>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        deleteFolder.mutateAsync(node.path).then(() => {
                                          setDeletingFolder(null);
                                          if (uploadFolder === node.path) setUploadFolder('');
                                          toast.success('Folder deleted');
                                        }).catch(() => toast.error('Delete failed'));
                                      }}
                                      style={{ background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.3)', cursor: 'pointer', color: 'var(--rose)', fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}
                                    >Yes</button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setDeletingFolder(null); }}
                                      style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 9, padding: '1px 5px', borderRadius: 3 }}
                                    >No</button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setDeletingFolder(node.path); }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 12, padding: '2px 4px', lineHeight: 1, borderRadius: 3 }}
                                    title="Delete folder"
                                  >✕</button>
                                )
                              )}
                            </div>
                            {isOpen && renderTree(node.children, depth + 1)}
                          </React.Fragment>
                        );
                      }
                      if (node.name === '.gitkeep') return null;
                      const r = node.resource;
                      const tabId = `resource:${r.filename}`;
                      const isActive = activeTabId === tabId;
                      const isBinary = r.isBinary ?? false;
                      const canEdit = !isBinary && isEditable(node.name);
                      return (
                        <div
                          key={node.path}
                          draggable={canWrite}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', r.filename);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onClick={() => {
                            setSelectedResourcePath(r.containerPath ?? (resourcesBase ? `${resourcesBase}/${r.filename}` : r.filename));
                            if (canEdit) openResourceTab(r.filename);
                          }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: `7px 12px 7px ${22 + depth * 14}px`,
                            cursor: canWrite ? 'grab' : canEdit ? 'pointer' : 'default',
                            background: isActive ? 'rgba(42,157,143,0.1)' : 'transparent',
                            borderBottom: '1px solid var(--border)',
                            borderLeft: isActive ? '2px solid var(--emerald)' : '2px solid transparent',
                            transition: 'all 0.12s',
                          }}
                        >
                          <span style={{ fontSize: 11 }}>{isBinary ? (node.name.endsWith('.pdf') ? '📑' : '📊') : fileIcon(node.name)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {node.name}
                            </div>
                            <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                              {r.size >= 1024 * 1024
                                ? `${(r.size / 1024 / 1024).toFixed(1)} MB`
                                : `${(r.size / 1024).toFixed(1)} KB`} · {new Date(r.uploadedAt).toLocaleDateString()}
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadResource(projectId ?? '', r.filename);
                              toast.success(`Downloading ${node.name}`);
                            }}
                            style={{
                              background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.25)',
                              cursor: 'pointer', color: 'var(--cyan)', fontSize: 10, padding: '2px 6px',
                              borderRadius: 3, fontWeight: 600, flexShrink: 0,
                            }}
                            title="Download file"
                          >↓</button>
                          {canWrite && movingResource === r.filename ? (
                            <div style={{ display: 'flex', gap: 3, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                              <span style={{ fontSize: 9, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>Move to:</span>
                              <select
                                autoFocus
                                defaultValue="__placeholder__"
                                onChange={(e) => {
                                  const dest = e.target.value === '__root__' ? '' : e.target.value;
                                  moveResource.mutateAsync({ filename: r.filename, destination: dest }).then(() => {
                                    setMovingResource(null);
                                    closeTab(`resource:${r.filename}`);
                                    toast.success('Moved');
                                  }).catch(() => toast.error('Move failed'));
                                }}
                                style={{ fontSize: 9, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 3px' }}
                              >
                                <option value="__placeholder__" disabled>Select folder…</option>
                                <option value="__root__">(root)</option>
                                {Array.from(new Set(resources.map(f => {
                                  const parts = f.filename.split('/');
                                  return parts.length > 1 ? parts.slice(0, -1).join('/') : null;
                                }).filter(Boolean) as string[])).sort().map(folder => (
                                  <option key={folder} value={folder}>{folder}</option>
                                ))}
                              </select>
                              <button
                                onClick={(e) => { e.stopPropagation(); setMovingResource(null); }}
                                style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 9, padding: '1px 5px', borderRadius: 3 }}
                              >✕</button>
                            </div>
                          ) : canWrite && (
                            deletingResourceFile === r.filename ? (
                              <div style={{ display: 'flex', gap: 3, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                                <span style={{ fontSize: 9, color: 'var(--fail)', whiteSpace: 'nowrap' }}>Delete?</span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteResource.mutateAsync(r.filename).then(() => {
                                      closeTab(`resource:${r.filename}`);
                                      setDeletingResourceFile(null);
                                      toast.success('Deleted');
                                    }).catch(() => toast.error('Delete failed'));
                                  }}
                                  style={{ background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.3)', cursor: 'pointer', color: 'var(--rose)', fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}
                                >Yes</button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setDeletingResourceFile(null); }}
                                  style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 9, padding: '1px 5px', borderRadius: 3 }}
                                >No</button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setMovingResource(r.filename); setDeletingResourceFile(null); }}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 10, padding: '2px 4px', lineHeight: 1, borderRadius: 3 }}
                                  title="Move file"
                                >⇄</button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setDeletingResourceFile(r.filename); setMovingResource(null); }}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 12, padding: '2px 4px', lineHeight: 1, borderRadius: 3 }}
                                  title="Delete resource file"
                                >✕</button>
                              </div>
                            )
                          )}
                        </div>
                      );
                    });
                  }

                  const rootDropActive = dragOverFolder === '__root__';
                  return (
                    <>
                      {canWrite && (
                        <div
                          onDragOver={(e) => { e.preventDefault(); setDragOverFolder('__root__'); }}
                          onDragLeave={() => setDragOverFolder(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            const filename = e.dataTransfer.getData('text/plain');
                            setDragOverFolder(null);
                            if (!filename || !filename.includes('/')) return;
                            moveResource.mutateAsync({ filename, destination: '' }).then(() => {
                              closeTab(`resource:${filename}`);
                              toast.success('Moved to root');
                            }).catch(() => toast.error('Move failed'));
                          }}
                          style={{
                            padding: '4px 12px',
                            fontSize: 9, color: rootDropActive ? '#a5b4fc' : 'var(--text-dim)',
                            background: rootDropActive ? 'rgba(99,102,241,0.15)' : 'transparent',
                            borderBottom: '1px solid var(--border)',
                            outline: rootDropActive ? '1px dashed #818cf8' : 'none',
                            textAlign: 'center',
                            transition: 'all 0.1s',
                          }}
                        >
                          {rootDropActive ? '📂 Drop here to move to root' : '↑ Drop here for root'}
                        </div>
                      )}
                      {renderTree(buildTree(resources), 0)}
                    </>
                  );
                })()}
              </div>
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
                  const r = resources.find(res => res.filename === activeTab.filename);
                  const cp = r?.containerPath ?? `resources/${activeTab.filename}`;
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
                  language={
                    activeScript?.filename?.endsWith('.robot') ? 'robotframework'
                    : activeTab?.kind === 'resource'
                      ? (activeTab.filename.endsWith('.py') ? 'python'
                        : activeTab.filename.endsWith('.yaml') || activeTab.filename.endsWith('.yml') ? 'yaml'
                        : activeTab.filename.endsWith('.csv') || activeTab.filename.endsWith('.tsv') ? 'plaintext'
                        : (activeTab.filename.endsWith('.robot') || activeTab.filename.endsWith('.resource')) ? 'robotframework'
                        : 'plaintext')
                    : 'typescript'
                  }
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
                    wordWrap: 'on', tabSize: activeTab?.kind === 'resource' ? 4 : 2,
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
