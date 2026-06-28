import { useState, useEffect } from 'react';
import type { TestCase } from '../../types';

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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(tc.title);
    setDescription(tc.description ?? '');
  }, [tc.id]);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave(tc.tcId, {
        title: title.trim(),
        description: description.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  return (
    <div
      onClick={onClose}
      onKeyDown={handleKeyDown}
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
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border2)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '480px',
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
          }}
        >
          <span style={{ fontSize: '14px' }}>✏️</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
              Edit Script
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

        {/* Body */}
        <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <div style={LABEL}>Title</div>
            <input
              autoFocus
              style={INPUT}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Script title"
            />
          </div>

          <div>
            <div style={LABEL}>Description (optional)</div>
            <textarea
              style={{ ...INPUT, resize: 'vertical', minHeight: '80px' }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of what this script covers"
            />
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            justifyContent: 'flex-end',
            padding: '12px 18px',
            borderTop: '1px solid var(--border)',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '7px 16px',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: 'var(--text-dim)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            style={{
              padding: '7px 20px',
              background: 'var(--cyan-dim)',
              border: '1px solid rgba(37,99,171,0.35)',
              borderRadius: '6px',
              color: 'var(--cyan)',
              fontSize: '12px',
              fontWeight: 700,
              cursor: saving || !title.trim() ? 'not-allowed' : 'pointer',
              opacity: saving || !title.trim() ? 0.5 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
