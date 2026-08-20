/**
 * A persisted record of what the car actually did.
 *
 * Media Session is the one part of this app that cannot be verified from a
 * desk: whether a head unit renders the metadata, and which transport actions
 * it sends, depends on the car. And the person who can answer that is driving
 * -- no devtools, no console, hands on the wheel -- so the evidence has to
 * collect itself and still be there afterwards.
 *
 * Hence: append-only, written to localStorage on every entry, and read back
 * from a Settings panel once parked. Persisting per entry rather than at the
 * end matters because the app can be reloaded mid-drive by the update check,
 * and an in-memory log would vanish exactly when it got interesting.
 *
 * Two kinds of entry answer two different questions:
 *   - `register` says which actions this browser/OS ACCEPTED. A refusal here
 *     means the button can never work, however the car behaves.
 *   - `invoke` says which action the car actually SENT when a button was
 *     pressed. This is the half no amount of local testing can produce, and
 *     the one that tells us whether the current mapping is right.
 */

const STORAGE_KEY = 'bjtrainer.mediaSessionLog.v1';

/**
 * Enough to cover a drive without being able to grow without bound. Entries
 * are tiny, and the oldest are the least interesting once the newest describe
 * the same car.
 */
const MAX_ENTRIES = 200;

export type LogKind = 'register' | 'invoke' | 'note';

export interface LogEntry {
  at: string;
  kind: LogKind;
  /** The Media Session action name, or a free label for a note. */
  action: string;
  /** register: was it accepted. invoke: always true. */
  ok: boolean;
  /** Why a registration was refused, when the browser said. */
  detail?: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readLog(): LogEntry[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Anything malformed is dropped rather than thrown: a corrupt diagnostic
    // log must never be the reason the app fails to start.
    return parsed.filter(
      (e): e is LogEntry =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as LogEntry).at === 'string' &&
        typeof (e as LogEntry).action === 'string',
    );
  } catch {
    return [];
  }
}

function write(entries: LogEntry[]): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota or private mode. The log is a diagnostic; losing it must never
    // throw into the audio path that is mid-utterance.
  }
}

export function appendLog(entry: Omit<LogEntry, 'at'> & { at?: string }): void {
  const entries = readLog();
  entries.push({ at: entry.at ?? new Date().toISOString(), ...entry } as LogEntry);
  write(entries.slice(-MAX_ENTRIES));
}

export function clearLog(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * The log as text to hand back -- readable on the phone, and pasteable.
 *
 * Includes the user agent because "which car" and "which iOS" are the two
 * things that make a report actionable, and neither is recoverable later.
 */
export function formatLog(entries: LogEntry[] = readLog()): string {
  const ua = typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent;
  const header = [
    `Blackjack Trainer — Media Session log`,
    `captured: ${new Date().toISOString()}`,
    `agent: ${ua}`,
    `entries: ${entries.length}`,
    '',
  ];
  const accepted = entries.filter((e) => e.kind === 'register' && e.ok).map((e) => e.action);
  const refused = entries.filter((e) => e.kind === 'register' && !e.ok).map((e) => e.action);
  const invoked = [...new Set(entries.filter((e) => e.kind === 'invoke').map((e) => e.action))];

  const summary = [
    `accepted by this browser: ${accepted.length ? [...new Set(accepted)].join(', ') : '(none)'}`,
    `refused: ${refused.length ? [...new Set(refused)].join(', ') : '(none)'}`,
    `ACTUALLY SENT BY THE CAR: ${invoked.length ? invoked.join(', ') : '(nothing yet)'}`,
    '',
    '--- entries ---',
  ];

  const rows = entries.map(
    (e) =>
      `${e.at}  ${e.kind.padEnd(8)} ${e.action}${e.ok ? '' : '  REFUSED'}${
        e.detail ? `  (${e.detail})` : ''
      }`,
  );

  return [...header, ...summary, ...rows].join('\n');
}
