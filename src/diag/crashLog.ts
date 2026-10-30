import { diag, flushDiagnostics } from './diagnosticLog';

/**
 * A SCREEN CRASH GOES INTO THE DIAGNOSTIC LOG (audit D1).
 *
 * The screen ErrorBoundary used to write a crash to the console and nowhere
 * else. In the car that is the worst place for it: the crashed tree unmounts,
 * its cleanups stop speech and recognition, the fallback renders silently --
 * and the log Jack exports after the drive had no line saying why the drill
 * went quiet.
 *
 * These are React's root-level error hooks (createRoot options), so every
 * boundary -- the screen one and any added later -- is covered without each
 * one having to remember to log. The stack and component stack are cut to
 * 1500 characters each; the log caps a detail value at 2000 anyway, and a
 * stack is useful long before it is complete.
 */

const STACK_CHARS = 1500;

type Kind = 'caught' | 'uncaught' | 'recoverable';

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack?.slice(0, STACK_CHARS) };
  }
  return { message: String(error) };
}

export function logReactError(
  kind: Kind,
  error: unknown,
  info: { componentStack?: string | null } | undefined,
): void {
  const { message, stack } = describe(error);
  diag('err', 'render-crash', {
    kind,
    message,
    stack,
    componentStack: info?.componentStack?.slice(0, STACK_CHARS) ?? undefined,
  });
  // Synchronously: a crash is exactly when the page may not live long enough
  // for the one-second flush timer.
  flushDiagnostics();
}

/** The options `createRoot` takes, wired to the log. */
export const rootErrorOptions = {
  onCaughtError(error: unknown, info: { componentStack?: string | null }): void {
    // The console line stays with ErrorBoundary.componentDidCatch, which
    // already writes one; a second here would only duplicate it.
    logReactError('caught', error, info);
  },
  onUncaughtError(error: unknown, info: { componentStack?: string | null }): void {
    logReactError('uncaught', error, info);
    // React's default for an uncaught error is reportError; keep it, so the
    // window `error` listener and the console still see it.
    if (typeof reportError === 'function') reportError(error);
    else console.error(error);
  },
  onRecoverableError(error: unknown, info: { componentStack?: string | null }): void {
    logReactError('recoverable', error, info);
    console.error(error);
  },
};
