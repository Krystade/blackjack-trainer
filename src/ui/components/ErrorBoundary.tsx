import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { exportAll } from '../../store/persist';

/**
 * Catches a render throw so it blanks one screen instead of the whole app.
 *
 * This matters more here than in a typical app because there is no backend:
 * everything the user has ever practised lives in this browser's
 * localStorage, and a white screen with no controls is indistinguishable
 * from having lost it.
 *
 * The design is shaped by an incident that actually happened. A `null`
 * history array made the stats screen throw; the app blanked; and the
 * "Reset Stats" control that would have fixed it lived on the very screen
 * that was crashing, so the user was stranded with no way back. Two rules
 * follow from that, and both are load-bearing:
 *
 *   1. The fallback renders NOTHING from the crashed tree and reads no app
 *      state, so it cannot fail for the same reason the tree did. It uses
 *      inline styles off the theme tokens rather than app CSS classes.
 *   2. Salvage comes before repair. Exporting a backup is offered first and
 *      needs no working UI; only after that does the destructive option
 *      appear, and it is never the only way out.
 */

interface Props {
  children: ReactNode;
  /** Return to a known-good screen without a full reload, when possible. */
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Nothing ships errors anywhere, so the console is the only record the
    // user can hand back when reporting a problem.
    console.error('Blackjack Trainer crashed:', error, info.componentStack);
  }

  private handleBackup = (): void => {
    try {
      const blob = new Blob([exportAll()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `blackjack-trainer-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Backup failed:', e);
    }
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleReset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    // Inline styles on purpose: app.css may itself be implicated, and this
    // screen has to render no matter what. Colours come from the theme
    // tokens so it still looks like the app in whichever theme is active.
    const panel: React.CSSProperties = {
      minHeight: '100svh',
      background: 'var(--bg, #0d2318)',
      color: 'var(--ink, #eaf3ec)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '1rem',
      padding: '1.5rem',
      textAlign: 'center',
      font: '16px/1.5 system-ui, sans-serif',
    };
    const button: React.CSSProperties = {
      minHeight: '48px',
      minWidth: '14rem',
      padding: '0.6rem 1.2rem',
      borderRadius: '6px',
      border: '1px solid var(--line, #2c5c41)',
      background: 'var(--surface, #143b26)',
      color: 'var(--ink, #eaf3ec)',
      font: 'inherit',
      cursor: 'pointer',
    };
    const primary: React.CSSProperties = {
      ...button,
      background: 'var(--accent, #d8b969)',
      color: 'var(--accent-ink, #0d2318)',
      fontWeight: 600,
    };

    return (
      <div style={panel} role="alert" className="error-boundary">
        <h1 style={{ margin: 0, fontSize: '1.4rem' }}>Something broke on this screen.</h1>
        <p style={{ margin: 0, maxWidth: '32ch', color: 'var(--ink-dim, #b7d3c2)' }}>
          Your saved profiles, stats and drill history are still on this device. Save a
          backup first if you plan to reset anything.
        </p>

        <button type="button" style={primary} onClick={this.handleBackup}>
          Save a backup
        </button>
        <button type="button" style={button} onClick={this.handleReset}>
          Back to Home
        </button>
        <button type="button" style={button} onClick={this.handleReload}>
          Reload the app
        </button>

        <details style={{ marginTop: '0.5rem', maxWidth: '40ch', textAlign: 'left' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--ink-dim, #b7d3c2)' }}>
            Technical details
          </summary>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: '0.75rem',
              color: 'var(--ink-faint, #7fa890)',
            }}
          >
            {error.message}
          </pre>
        </details>
      </div>
    );
  }
}
