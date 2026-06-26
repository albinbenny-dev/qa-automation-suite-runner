import { useState } from 'react';
import toast from 'react-hot-toast';
import { useEmailConfig, useSaveEmailConfig } from '../../hooks/useReports';

const TRIGGER_OPTIONS = [
  { value: 'on_failure', label: 'On test failure', desc: 'Send when any test fails' },
  { value: 'on_completion', label: 'On run completion', desc: 'Send after every completed run' },
  { value: 'on_schedule', label: 'On scheduled run', desc: 'Send after scheduled runs only' },
];

interface EmailConfigProps {
  projectId: string;
}

export default function EmailConfig({ projectId }: EmailConfigProps) {
  const { data: config, isLoading } = useEmailConfig(projectId);
  const { mutateAsync: save, isPending: saving } = useSaveEmailConfig(projectId);

  const [newRecipient, setNewRecipient] = useState('');
  const [localRecipients, setLocalRecipients] = useState<string[] | null>(null);
  const [localEvents, setLocalEvents] = useState<string[] | null>(null);

  const recipients = localRecipients ?? config?.recipients ?? [];
  const events = localEvents ?? config?.triggerEvents ?? ['on_failure'];

  function addRecipient() {
    const email = newRecipient.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    if (recipients.includes(email)) return;
    setLocalRecipients([...recipients, email]);
    setNewRecipient('');
  }

  function removeRecipient(email: string) {
    setLocalRecipients(recipients.filter((r) => r !== email));
  }

  function toggleEvent(val: string) {
    if (events.includes(val)) {
      setLocalEvents(events.filter((e) => e !== val));
    } else {
      setLocalEvents([...events, val]);
    }
  }

  async function handleSave() {
    try {
      await save({ recipients, triggerEvents: events });
      setLocalRecipients(null);
      setLocalEvents(null);
      toast.success('Email configuration saved');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (isLoading) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Recipients */}
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: 'var(--text-dim)',
            marginBottom: 10,
          }}
        >
          Recipients
        </div>

        {/* Add recipient */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input
            type="email"
            placeholder="Add email address…"
            value={newRecipient}
            onChange={(e) => setNewRecipient(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRecipient()}
            style={{
              flex: 1,
              padding: '7px 12px',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 7,
              color: 'var(--text)',
              fontSize: 12,
              outline: 'none',
            }}
          />
          <button
            onClick={addRecipient}
            style={{
              padding: '7px 14px',
              background: 'rgba(37,99,171,0.15)',
              color: 'var(--cyan)',
              border: '1px solid rgba(37,99,171,0.3)',
              borderRadius: 7,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            + Add
          </button>
        </div>

        {/* Recipient chips */}
        {recipients.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>No recipients added yet.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {recipients.map((r) => (
              <div
                key={r}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px 4px 12px',
                  background: 'rgba(37,99,171,0.1)',
                  border: '1px solid rgba(37,99,171,0.25)',
                  borderRadius: 100,
                  fontSize: 12,
                  color: 'var(--cyan)',
                }}
              >
                {r}
                <button
                  onClick={() => removeRecipient(r)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    lineHeight: 1,
                    fontSize: 13,
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Trigger events */}
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: 'var(--text-dim)',
            marginBottom: 10,
          }}
        >
          Trigger Events
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {TRIGGER_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                cursor: 'pointer',
                padding: '8px 12px',
                background: events.includes(opt.value) ? 'rgba(37,99,171,0.08)' : 'var(--surface2)',
                border: `1px solid ${events.includes(opt.value) ? 'rgba(37,99,171,0.3)' : 'var(--border)'}`,
                borderRadius: 8,
              }}
            >
              <div style={{ marginTop: 1 }}>
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    border: `2px solid ${events.includes(opt.value) ? 'var(--cyan)' : 'var(--border)'}`,
                    background: events.includes(opt.value) ? 'var(--cyan)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onClick={() => toggleEvent(opt.value)}
                >
                  {events.includes(opt.value) && (
                    <span style={{ color: '#fff', fontSize: 9, lineHeight: 1 }}>✓</span>
                  )}
                </div>
              </div>
              <div onClick={() => toggleEvent(opt.value)}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 1 }}>{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          padding: '9px 20px',
          background: saving ? 'var(--surface2)' : 'var(--cyan)',
          color: saving ? 'var(--text-dim)' : 'var(--surface)',
          border: 'none',
          borderRadius: 8,
          cursor: saving ? 'not-allowed' : 'pointer',
          fontWeight: 700,
          fontSize: 13,
          alignSelf: 'flex-start',
        }}
      >
        {saving ? 'Saving…' : 'Save Config'}
      </button>
    </div>
  );
}
