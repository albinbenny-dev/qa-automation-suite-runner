import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  /** Custom fallback UI — overrides the default error card */
  fallback?: ReactNode;
  /** Called when an error is caught — use for Sentry / logging */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary — 6D brand error recovery wrapper.
 *
 * Renders a navy-striped error card with a "Try Again" orange button
 * that resets component state and re-mounts children.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomeFeaturePanel />
 *   </ErrorBoundary>
 *
 *   // With custom fallback:
 *   <ErrorBoundary fallback={<p>Custom error message</p>}>
 *     <SomeFeaturePanel />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error.message, info.componentStack);
    this.props.onError?.(error, info);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <div
        style={{
          display: 'flex',
          margin: '16px',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
          background: 'var(--surface)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        {/* Left navy accent stripe */}
        <div
          style={{
            width: 5,
            background: 'var(--6d-navy)',
            flexShrink: 0,
          }}
        />

        <div style={{ padding: '24px 28px', flex: 1 }}>
          {/* Title */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: 'var(--6d-navy)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 14,
                flexShrink: 0,
              }}
            >
              ⚠
            </div>
            <h3
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--6d-navy)',
                letterSpacing: '-0.1px',
              }}
            >
              Something went wrong
            </h3>
          </div>

          {/* Error message */}
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-mid)',
              lineHeight: 1.6,
              marginBottom: 18,
              fontFamily: 'var(--font-ui)',
            }}
          >
            {this.state.error?.message ??
              'An unexpected error occurred. Please try again or refresh the page.'}
          </p>

          {/* Try Again button */}
          <button
            onClick={this.handleReset}
            style={{
              padding: '8px 20px',
              background: 'linear-gradient(135deg, #F47B20, #D9601A)',
              border: 'none',
              borderRadius: 'var(--radius)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
              boxShadow: '0 2px 8px rgba(244,123,32,0.28)',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => ((e.target as HTMLButtonElement).style.opacity = '0.88')}
            onMouseLeave={(e) => ((e.target as HTMLButtonElement).style.opacity = '1')}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
