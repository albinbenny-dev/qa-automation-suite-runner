interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  /** Emoji or short text shown in the navy icon chip */
  icon?: string;
  /** Bold navy title — e.g. "No test cases yet" */
  title: string;
  /** Softer sub-text describing what to do next */
  description?: string;
  /** Optional orange CTA button */
  action?: EmptyStateAction;
}

/**
 * EmptyState — 6D brand empty-content placeholder.
 *
 * Renders a centred block with:
 *   - Navy rounded icon chip
 *   - Navy bold title
 *   - text-mid description
 *   - Optional orange CTA button
 *
 * Usage:
 *   <EmptyState
 *     icon="📋"
 *     title="No test cases yet"
 *     description="Generate your first test cases using the Test Writer."
 *     action={{ label: 'Open Test Writer', onClick: () => navigate('...') }}
 *   />
 */
export default function EmptyState({
  icon = '∞',
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '52px 24px',
        gap: 0,
        textAlign: 'center',
      }}
    >
      {/* Navy icon chip */}
      <div
        style={{
          width: 58,
          height: 58,
          borderRadius: 15,
          background: 'var(--6d-navy)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 26,
          color: '#fff',
          marginBottom: 18,
          boxShadow: '0 4px 14px rgba(10,42,87,0.18)',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>

      {/* Title */}
      <h3
        style={{
          fontSize: 15,
          fontWeight: 800,
          color: 'var(--6d-navy)',
          letterSpacing: '-0.2px',
          marginBottom: description ? 8 : action ? 18 : 0,
        }}
      >
        {title}
      </h3>

      {/* Description */}
      {description && (
        <p
          style={{
            fontSize: 13,
            color: 'var(--text-mid)',
            maxWidth: 360,
            lineHeight: 1.65,
            marginBottom: action ? 22 : 0,
          }}
        >
          {description}
        </p>
      )}

      {/* CTA button */}
      {action && (
        <button
          onClick={action.onClick}
          style={{
            padding: '9px 22px',
            background: 'linear-gradient(135deg, #F47B20, #D9601A)',
            border: 'none',
            borderRadius: 'var(--radius)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'var(--font-ui)',
            boxShadow: '0 2px 8px rgba(244,123,32,0.30)',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={(e) => ((e.target as HTMLButtonElement).style.opacity = '0.88')}
          onMouseLeave={(e) => ((e.target as HTMLButtonElement).style.opacity = '1')}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
