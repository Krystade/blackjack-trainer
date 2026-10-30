import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { exportAll } from '../../store/persist';
import { backupFileName, saveTextFile, type SaveResult } from '../../platform/saveFile';
import { markBackedUp } from '../../store/backupStatus';
import { casinoLogFileText, hasCasinoLog } from '../crashSalvage';
import { exportFileName } from '../../store/casinoLog';

interface Props {
  children: ReactNode;
  /** Return to a known-good screen without a full reload, when possible. */
  onReset?: () => void;
}

interface State {
  error: Error | null;
  /** What the last "Save a backup" press actually did; null before the first. */
  backup: SaveResult | null;
  /** The same for "Save casino log" (B12). */
  casino: SaveResult | null;
}

const BACKUP_SAID: Record<SaveResult, string> = {
  shared: 'Backup saved.',
  downloaded: 'Backup downloaded. Check it is in Files before you reset anything.',
  cancelled: 'Backup not saved: the share sheet was closed.',
  failed: 'Backup failed: nothing was saved.',
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, backup: null, casino: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Nothing ships errors anywhere, so the console is the only record the
    // user can hand back when reporting a problem.
    console.error('Blackjack Trainer crashed:', error, info.componentStack);
  }

  // B1/B3/B10: the shared share-or-download helper (the iOS share sheet first,
  // a download whose blob URL outlives the click otherwise), and the result
  // is shown -- this screen is reached exactly when something is corrupt, and
  // "I have a backup" is what someone believes before they reset.
  private handleBackup = (): void => {
    let text: string;
    try {
      text = exportAll();
    } catch (e) {
      console.error('Backup failed:', e);
      this.setState({ backup: 'failed' });
      return;
    }
    const at = new Date();
    void saveTextFile(text, backupFileName(at)).then((backup) => {
      if (backup === 'shared' || backup === 'downloaded') markBackedUp(at);
      this.setState({ backup });
    });
  };

  // B12: the casino log is left out of the training backup on purpose, and
  // its own export lives on the Casino tab -- the screen most likely to be
  // the one that crashed. Real-money history gets its own way off the phone.
  private handleCasinoBackup = (): void => {
    const now = Date.now();
    let text: string;
    let name: string;
    try {
      text = casinoLogFileText(now);
      name = exportFileName(now);
    } catch (e) {
      console.error('Casino log backup failed:', e);
      this.setState({ casino: 'failed' });
      return;
    }
    void saveTextFile(text, name).then((casino) => this.setState({ casino }));
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleReset = (): void => {
    this.setState({ error: null, backup: null, casino: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { error, backup, casino } = this.state;
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
        <h1 style={{ margin: 0, fontSize: 'var(--fs-2xl, 1.4375rem)' }}>Something broke on this screen.</h1>
        <p style={{ margin: 0, maxWidth: '32ch', color: 'var(--ink-dim, #b7d3c2)' }}>
          Your profiles, stats and drill history are still saved on this device. Save a
          backup before you reset anything.
        </p>

        <button type="button" style={primary} onClick={this.handleBackup}>
          Save a backup
        </button>
        {backup !== null && (
          <p role="status" data-testid="crash-backup-status" style={{ margin: 0, maxWidth: '32ch' }}>
            {BACKUP_SAID[backup]}
          </p>
        )}
        {hasCasinoLog() && (
          <button type="button" style={button} onClick={this.handleCasinoBackup}>
            Save casino log
          </button>
        )}
        {casino !== null && (
          <p role="status" data-testid="crash-casino-status" style={{ margin: 0, maxWidth: '32ch' }}>
            {BACKUP_SAID[casino].replace('Backup', 'Casino log')}
          </p>
        )}
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
              fontSize: 'var(--fs-xs, 0.7375rem)',
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
