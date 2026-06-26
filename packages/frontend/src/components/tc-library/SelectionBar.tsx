import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

interface SelectionBarProps {
  selectedCount: number;
  useCaseOptions: string[];
  onMove: (targetUseCaseTag: string) => void;
  onAddToSuite: (suiteName: string) => void;
  onClear: () => void;
  onSendToExecution: () => void;
  onDelete: () => void;
  visible: boolean;
}

export default function SelectionBar({
  selectedCount,
  useCaseOptions,
  onMove,
  onAddToSuite,
  onClear,
  onSendToExecution,
  onDelete,
  visible,
}: SelectionBarProps) {
  const [moveTarget, setMoveTarget] = useState('');
  const [suiteInput, setSuiteInput] = useState('');
  const [newUCName, setNewUCName] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const allOptions = useCaseOptions;

  function handleMoveTargetChange(val: string) {
    if (val === '__new__') {
      setCreateModalOpen(true);
      setMoveTarget('');
    } else {
      setMoveTarget(val);
    }
  }

  function handleMove() {
    if (!moveTarget) return;
    onMove(moveTarget);
    setMoveTarget('');
  }

  function handleCreateAndMove() {
    const trimmed = newUCName.trim();
    if (!trimmed) return;
    onMove(trimmed);
    setNewUCName('');
    setCreateModalOpen(false);
  }

  function handleAddToSuite() {
    const trimmed = suiteInput.trim();
    if (!trimmed) return;
    onAddToSuite(trimmed);
    setSuiteInput('');
  }

  if (!visible) return null;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 16px',
          background: 'var(--violet-dim)',
          border: '1px solid rgba(244,123,32,0.35)',
          borderRadius: 'var(--radius)',
          gap: '10px',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        {/* Selected count */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div
            style={{
              width: '18px',
              height: '18px',
              borderRadius: '4px',
              background: 'var(--violet)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              color: 'white',
              flexShrink: 0,
            }}
          >
            ✓
          </div>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--violet)' }}>
            {selectedCount} selected
          </span>
        </div>

        <Divider />

        {/* Move to UseCase */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-mid)', whiteSpace: 'nowrap' }}>
            UseCase:
          </span>
          <select
            value={moveTarget}
            onChange={(e) => handleMoveTargetChange(e.target.value)}
            className="input-field"
            style={{
              padding: '5px 10px',
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--violet)',
              background: 'var(--surface2)',
              borderColor: 'rgba(244,123,32,0.3)',
              minWidth: '150px',
            }}
          >
            <option value="">— move to —</option>
            {allOptions.map((uc) => (
              <option key={uc} value={uc}>{uc}</option>
            ))}
            <option value="__new__">+ Create New…</option>
          </select>
          <button
            onClick={handleMove}
            disabled={!moveTarget}
            style={{
              padding: '5px 12px',
              background: moveTarget
                ? 'linear-gradient(135deg, var(--violet), var(--6d-orange-deep))'
                : 'var(--surface3)',
              border: 'none',
              borderRadius: '5px',
              color: moveTarget ? 'white' : 'var(--text-dim)',
              fontSize: '11px',
              fontWeight: 700,
              cursor: moveTarget ? 'pointer' : 'default',
              opacity: moveTarget ? 1 : 0.5,
            }}
          >
            ↗ Move
          </button>
        </div>

        <Divider />

        {/* Suite tagging */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-mid)', whiteSpace: 'nowrap' }}>
            ⚡ Suite:
          </span>
          <input
            className="input-field"
            value={suiteInput}
            onChange={(e) => setSuiteInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddToSuite()}
            placeholder="e.g. Smoke"
            style={{
              padding: '5px 10px',
              fontSize: '11px',
              width: '110px',
              borderColor: 'rgba(245,158,11,0.3)',
            }}
          />
          <button
            onClick={handleAddToSuite}
            disabled={!suiteInput.trim()}
            style={{
              padding: '5px 12px',
              background: suiteInput.trim() ? 'rgba(245,158,11,0.15)' : 'var(--surface3)',
              border: suiteInput.trim() ? '1px solid rgba(245,158,11,0.4)' : '1px solid var(--border)',
              borderRadius: '5px',
              color: suiteInput.trim() ? 'var(--amber)' : 'var(--text-dim)',
              fontSize: '11px',
              fontWeight: 700,
              cursor: suiteInput.trim() ? 'pointer' : 'default',
              opacity: suiteInput.trim() ? 1 : 0.5,
            }}
          >
            + Tag
          </button>
        </div>

        <Divider />

        <button
          onClick={onClear}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            color: 'var(--text-dim)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            textDecoration: 'underline',
            whiteSpace: 'nowrap',
          }}
        >
          Clear
        </button>

        <Divider />

        {/* Bulk delete */}
        <button
          onClick={onDelete}
          style={{
            padding: '5px 12px',
            background: 'rgba(220,38,38,0.08)',
            border: '1px solid rgba(220,38,38,0.3)',
            borderRadius: '5px',
            color: 'var(--fail)',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          🗑 Delete {selectedCount}
        </button>

        {/* Send to Execution — pushed to right */}
        <button
          onClick={onSendToExecution}
          style={{
            marginLeft: 'auto',
            padding: '7px 18px',
            background: 'linear-gradient(135deg, var(--violet), var(--cyan))',
            border: 'none',
            borderRadius: '6px',
            color: 'white',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'var(--font-ui)',
            whiteSpace: 'nowrap',
          }}
        >
          ▶ Send to Execution
        </button>
      </div>

      {/* Create New UseCase modal */}
      <Dialog.Root open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(4px)',
              zIndex: 9998,
            }}
          />
          <Dialog.Content
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%,-50%)',
              background: 'var(--surface)',
              border: '1px solid rgba(244,123,32,0.3)',
              borderRadius: '14px',
              padding: '28px',
              width: '380px',
              boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
              zIndex: 9999,
            }}
          >
            <Dialog.Title
              style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text)', marginBottom: '6px' }}
            >
              Create New UseCase
            </Dialog.Title>
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--text-dim)',
                marginBottom: '16px',
              }}
            >
              The selected TCs will be moved to this new group.
            </p>
            <input
              className="input-field"
              value={newUCName}
              onChange={(e) => setNewUCName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateAndMove()}
              placeholder="e.g. Refund Flow"
              style={{ width: '100%', marginBottom: '14px', padding: '10px 14px', fontSize: '13px' }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Dialog.Close asChild>
                <button className="tb-btn tb-btn-ghost">Cancel</button>
              </Dialog.Close>
              <button
                onClick={handleCreateAndMove}
                disabled={!newUCName.trim()}
                className="tb-btn"
                style={{
                  background: newUCName.trim()
                    ? 'linear-gradient(135deg, var(--violet), var(--6d-orange-deep))'
                    : 'var(--surface3)',
                  border: 'none',
                  color: newUCName.trim() ? 'white' : 'var(--text-dim)',
                  fontWeight: 700,
                  opacity: newUCName.trim() ? 1 : 0.6,
                }}
              >
                Create &amp; Move
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function Divider() {
  return <div style={{ width: '1px', height: '18px', background: 'rgba(244,123,32,0.3)', flexShrink: 0 }} />;
}
