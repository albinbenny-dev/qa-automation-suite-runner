import { useState, useEffect, useRef } from 'react';
import type { TestCase, Script } from '../../types';
import { getToken } from '../../lib/auth';

interface EditTCModalProps {
  tc: TestCase;
  onSave: (tcId: string, patch: Partial<TestCase>) => Promise<void>;
  onClose: () => void;
}

const LABEL: React.CSSProperties = {
  fontSize: '9px',
  fontWeight: 700,
  letterSpacing: '0.8px',
  textTransform: 'uppercase',
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-dim)',
  marginBottom: '5px',
};

const INPUT: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface)',
  border: '1px solid var(--border2)',
  borderRadius: '6px',
  color: 'var(--text)',
  fontSize: '12px',
  padding: '7px 10px',
  outline: 'none',
  boxSizing: 'border-box',
};

export default function EditTCModal({ tc, onSave, onClose }: EditTCModalProps) {
  const [title, setTitle] = useState(tc.title);
  const [description, setDescription] = useState(tc.description ?? '');
  const [steps, setSteps] = useState<string[]>([...tc.steps]);
  const [expectedResult, setExpectedResult] = useState(tc.expectedResult ?? '');
  const [type, setType] = useState<TestCase['type']>(tc.type);
  const [priority, setPriority] = useState<TestCase['priority']>(tc.priority);
  const [status, setStatus] = useState<TestCase['status']>(tc.status);
  const [saving, setSaving] = useState(false);
  const [newStep, setNewStep] = useState('');
const [prerequisiteTcId, setPrerequisiteTcId] = useState<string | null>(tc.prerequisiteTcId ?? null);
  const [automatedTcs, setAutomatedTcs] = useState<Array<{ id: string; tcId: string; title: string }>>([]);
  const [prereqSearch, setPrereqSearch] = useState('');
  const [prereqOpen, setPrereqOpen] = useState(false);
  const prereqRef = useRef<HTMLDivElement>(null);

  // Sync if tc prop changes (unlikely but defensive)
  useEffect(() => {
    setTitle(tc.title);
    setDescription(tc.description ?? '');
    setSteps([...tc.steps]);
    setExpectedResult(tc.expectedResult ?? '');
    setType(tc.type);
    setPriority(tc.priority);
    setStatus(tc.status);
    setPrerequisiteTcId(tc.prerequisiteTcId ?? null);
  }, [tc.id]);

  // Fetch TCs that have a script (automated) for the prerequisite picker
  useEffect(() => {
    fetch(`/api/projects/${tc.projectId}/scripts`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((r) => r.json())
      .then((data: { scripts: Script[] }) => {
        const tcs = data.scripts
          .filter((s) => s.testCaseId && s.testCase)
          .map((s) => ({ id: s.testCaseId!, tcId: s.testCase!.tcId, title: s.testCase!.title }))
          .filter((t) => t.id !== tc.id); // exclude self
        // Deduplicate by tcId
        const seen = new Set<string>();
        setAutomatedTcs(tcs.filter((t) => { if (seen.has(t.id)) return false; seen.add(t.id); return true; }));
      })
      .catch(() => {}); // silently ignore — picker just stays empty
  }, [tc.id, tc.projectId]);

  // Close prerequisite dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (prereqRef.current && !prereqRef.current.contains(e.target as Node)) {
        setPrereqOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleStepChange(i: number, val: string) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? val : s)));
  }

  function handleRemoveStep(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleMoveStep(i: number, dir: 'up' | 'down') {
    setSteps((prev) => {
      const next = [...prev];
      const target = dir === 'up' ? i - 1 : i + 1;
      if (target < 0 || target >= next.length) return prev;
      [next[i], next[target]] = [next[target], next[i]];
      return next;
    });
  }

  function handleInsertAfter(i: number) {
    setSteps((prev) => {
      const next = [...prev];
      next.splice(i + 1, 0, '');
      return next;
    });
  }

  function handleAddStep() {
    const val = newStep.trim();
    if (!val) return;
    setSteps((prev) => [...prev, val]);
    setNewStep('');
  }

  function handleAddStepKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); handleAddStep(); }
  }

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave(tc.tcId, {
        title: title.trim(),
        description: description.trim() || undefined,
        steps,
        expectedResult: expectedResult.trim(),
        type,
        priority,
        status,
        prerequisiteTcId: prerequisiteTcId ?? null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    /* Backdrop */
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      {/* Panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border2)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '700px',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '14px' }}>✏️</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
              Edit Test Case
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
              {tc.tcId}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: '28px',
              height: '28px',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: 'var(--text-dim)',
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '18px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Title */}
          <div>
            <div style={LABEL}>Title</div>
            <input
              style={INPUT}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Test case title"
            />
          </div>

          {/* Description */}
          <div>
            <div style={LABEL}>Description (optional)</div>
            <textarea
              style={{ ...INPUT, resize: 'vertical', minHeight: '54px' }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of what this test covers"
            />
          </div>

          {/* Steps */}
          <div>
            <div style={LABEL}>Steps</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {steps.map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '10px',
                      color: 'var(--text-dim)',
                      paddingTop: '8px',
                      minWidth: '18px',
                      textAlign: 'right',
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}.
                  </span>
                  <textarea
                    style={{ ...INPUT, flex: 1, resize: 'vertical', minHeight: '38px' }}
                    value={step}
                    onChange={(e) => handleStepChange(i, e.target.value)}
                    rows={1}
                  />
                  {/* Step action buttons */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0, marginTop: '4px' }}>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      <button
                        onClick={() => handleMoveStep(i, 'up')}
                        disabled={i === 0}
                        title="Move step up"
                        style={{
                          width: '22px', height: '22px', flexShrink: 0,
                          background: 'var(--surface2)',
                          border: '1px solid var(--border)',
                          borderRadius: '4px',
                          color: i === 0 ? 'var(--border)' : 'var(--text-dim)',
                          fontSize: '10px', cursor: i === 0 ? 'default' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >▲</button>
                      <button
                        onClick={() => handleMoveStep(i, 'down')}
                        disabled={i === steps.length - 1}
                        title="Move step down"
                        style={{
                          width: '22px', height: '22px', flexShrink: 0,
                          background: 'var(--surface2)',
                          border: '1px solid var(--border)',
                          borderRadius: '4px',
                          color: i === steps.length - 1 ? 'var(--border)' : 'var(--text-dim)',
                          fontSize: '10px', cursor: i === steps.length - 1 ? 'default' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >▼</button>
                    </div>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      <button
                        onClick={() => handleInsertAfter(i)}
                        title="Insert step below"
                        style={{
                          width: '22px', height: '22px', flexShrink: 0,
                          background: 'rgba(37,99,171,0.08)',
                          border: '1px solid rgba(37,99,171,0.25)',
                          borderRadius: '4px',
                          color: 'var(--cyan)',
                          fontSize: '13px', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, lineHeight: 1,
                        }}
                      >+</button>
                      <button
                        onClick={() => handleRemoveStep(i)}
                        title="Remove step"
                        style={{
                          width: '22px', height: '22px', flexShrink: 0,
                          background: 'rgba(220,38,38,0.07)',
                          border: '1px solid rgba(220,38,38,0.2)',
                          borderRadius: '4px',
                          color: 'var(--fail)',
                          fontSize: '13px', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >×</button>
                    </div>
                  </div>
                </div>
              ))}

              {/* Add step row */}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                <input
                  style={{ ...INPUT, flex: 1 }}
                  value={newStep}
                  onChange={(e) => setNewStep(e.target.value)}
                  onKeyDown={handleAddStepKey}
                  placeholder="Add a step… (Enter to add)"
                />
                <button
                  onClick={handleAddStep}
                  style={{
                    padding: '6px 12px',
                    background: 'var(--cyan-dim)',
                    border: '1px solid rgba(37,99,171,0.3)',
                    borderRadius: '6px',
                    color: 'var(--cyan)',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  + Add
                </button>
              </div>
            </div>
          </div>

          {/* Expected Result */}
          <div>
            <div style={LABEL}>Expected Result</div>
            <textarea
              style={{ ...INPUT, resize: 'vertical', minHeight: '60px' }}
              value={expectedResult}
              onChange={(e) => setExpectedResult(e.target.value)}
              placeholder="What should happen when the test passes"
            />
          </div>

          {/* Prerequisite TC picker */}
          <div>
            <div style={LABEL}>Prerequisite TC (optional)</div>
            <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '6px' }}>
              Select an automated TC whose script covers the login + navigation setup for this test.
              The script generator will reuse that working script as the starting point.
            </div>
            <div ref={prereqRef} style={{ position: 'relative' }}>
              {/* Selected value display / trigger */}
              <div
                onClick={() => setPrereqOpen((o) => !o)}
                style={{
                  ...INPUT,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  userSelect: 'none',
                  color: prerequisiteTcId ? 'var(--text)' : 'var(--text-dim)',
                }}
              >
                <span style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {prerequisiteTcId
                    ? (() => {
                        const found = automatedTcs.find((t) => t.id === prerequisiteTcId);
                        return found ? `${found.tcId} — ${found.title}` : '(loading…)';
                      })()
                    : 'None — generate standalone script'}
                </span>
                <span style={{ fontSize: '10px', flexShrink: 0, marginLeft: '8px' }}>▾</span>
              </div>

              {/* Dropdown */}
              {prereqOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: '4px',
                    background: 'var(--surface)',
                    border: '1px solid var(--border2)',
                    borderRadius: '8px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    zIndex: 50,
                    overflow: 'hidden',
                    maxHeight: '220px',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {/* Search */}
                  <div style={{ padding: '8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                    <input
                      autoFocus
                      placeholder="Search automated TCs…"
                      value={prereqSearch}
                      onChange={(e) => setPrereqSearch(e.target.value)}
                      style={{ ...INPUT, fontSize: '11px', padding: '5px 8px' }}
                    />
                  </div>

                  {/* Options */}
                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    {/* None option */}
                    <div
                      onClick={() => { setPrerequisiteTcId(null); setPrereqOpen(false); setPrereqSearch(''); }}
                      style={{
                        padding: '8px 12px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        color: prerequisiteTcId === null ? 'var(--cyan)' : 'var(--text-dim)',
                        background: prerequisiteTcId === null ? 'var(--cyan-dim)' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      {prerequisiteTcId === null && <span>✓</span>}
                      None — generate standalone script
                    </div>

                    {automatedTcs.length === 0 ? (
                      <div style={{ padding: '10px 12px', fontSize: '11px', color: 'var(--text-dim)' }}>
                        No automated TCs found in this project yet.
                      </div>
                    ) : (
                      automatedTcs
                        .filter((t) =>
                          prereqSearch === '' ||
                          t.tcId.toLowerCase().includes(prereqSearch.toLowerCase()) ||
                          t.title.toLowerCase().includes(prereqSearch.toLowerCase())
                        )
                        .map((t) => (
                          <div
                            key={t.id}
                            onClick={() => { setPrerequisiteTcId(t.id); setPrereqOpen(false); setPrereqSearch(''); }}
                            style={{
                              padding: '8px 12px',
                              fontSize: '11px',
                              cursor: 'pointer',
                              background: prerequisiteTcId === t.id ? 'var(--cyan-dim)' : 'transparent',
                              color: prerequisiteTcId === t.id ? 'var(--cyan)' : 'var(--text)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              borderTop: '1px solid var(--border)',
                            }}
                          >
                            {prerequisiteTcId === t.id && <span>✓</span>}
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', flexShrink: 0 }}>
                              {t.tcId}
                            </span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {t.title}
                            </span>
                            <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: '8px', background: 'rgba(42,157,143,0.15)', color: 'var(--emerald)', padding: '1px 5px', borderRadius: '3px', border: '1px solid rgba(42,157,143,0.3)' }}>
                              ⚡ automated
                            </span>
                          </div>
                        ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Preview card when a prerequisite is selected */}
            {prerequisiteTcId && (() => {
              const found = automatedTcs.find((t) => t.id === prerequisiteTcId);
              if (!found) return null;
              return (
                <div
                  style={{
                    marginTop: '8px',
                    padding: '8px 12px',
                    background: 'var(--cyan-dim)',
                    border: '1px solid rgba(37,99,171,0.25)',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span style={{ fontSize: '12px' }}>⛓</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '1px' }}>Script generator will reuse setup from:</div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {found.tcId} — {found.title}
                    </div>
                  </div>
                  <button
                    onClick={() => setPrerequisiteTcId(null)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-dim)',
                      cursor: 'pointer',
                      fontSize: '13px',
                      padding: '2px 4px',
                      flexShrink: 0,
                    }}
                    title="Remove prerequisite"
                  >
                    ×
                  </button>
                </div>
              );
            })()}
          </div>

          {/* Type / Priority / Status row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <div>
              <div style={LABEL}>Type</div>
              <select
                style={{ ...INPUT }}
                value={type}
                onChange={(e) => setType(e.target.value as TestCase['type'])}
              >
                <option value="UI">UI</option>
                <option value="API">API</option>
                <option value="SIT">SIT</option>
              </select>
            </div>
            <div>
              <div style={LABEL}>Priority</div>
              <select
                style={{ ...INPUT }}
                value={priority}
                onChange={(e) => setPriority(e.target.value as TestCase['priority'])}
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </div>
            <div>
              <div style={LABEL}>Status</div>
              <select
                style={{ ...INPUT }}
                value={status}
                onChange={(e) => setStatus(e.target.value as TestCase['status'])}
              >
                <option value="DRAFT">Draft</option>
                <option value="APPROVED">Approved</option>
                <option value="DEPRECATED">Deprecated</option>
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            padding: '12px 18px',
            borderTop: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '7px 18px',
              background: 'var(--surface2)',
              border: '1px solid var(--border2)',
              borderRadius: '7px',
              color: 'var(--text-dim)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            style={{
              padding: '7px 22px',
              background: saving || !title.trim()
                ? 'var(--surface2)'
                : 'linear-gradient(135deg, var(--violet), var(--6d-orange-deep))',
              border: '1px solid transparent',
              borderRadius: '7px',
              color: saving || !title.trim() ? 'var(--text-dim)' : 'white',
              fontSize: '12px',
              fontWeight: 700,
              cursor: saving || !title.trim() ? 'default' : 'pointer',
              transition: 'opacity 0.15s',
            }}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
