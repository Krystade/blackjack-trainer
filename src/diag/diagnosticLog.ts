/**
 * One global, timestamped, pasteable log of everything that could explain a
 * bad voice session.
 *
 * WHY THIS EXISTS. Voice is the feature this app is for -- eyes-free, one
 * handed, in a moving car -- and it is the feature that keeps failing in ways
 * nobody can reconstruct afterwards. The operator's report, 2026-09-15:
 * "it rarely understands me ... it also frequently doesn't hear me ... I get
 * the request to allow the mic and always accept it but it seems like the mic
 * doesn't stay active."
 *
 * Those are three different failures wearing the same face:
 *
 *   - the engine heard a word and picked the wrong one      (a vocabulary problem)
 *   - the engine heard nothing because the session had died (a lifecycle problem)
 *   - the engine heard nothing because the ROUTE changed    (a car problem)
 *
 * From the driver's seat all three look like silence, which is why guessing
 * between them has not worked. The app already keeps a log of what the
 * microphone HEARD (voiceHistory) -- but by construction that file can only
 * record utterances, and the failure being chased is the absence of them. A
 * log of nothing is indistinguishable from a log that was never written.
 *
 * So this records the other side: sessions starting, ending, erroring and
 * restarting; the page being hidden, frozen and resumed; audio devices
 * appearing and disappearing as a Bluetooth route flips; permission state
 * changing under us; the wake lock being taken and lost; the app's own voice
 * deafening the microphone; and every settings change, because a setting
 * changed three screens ago is the usual explanation for "it worked
 * yesterday".
 *
 * DESIGN CONSTRAINTS, all of them from the car:
 *
 *   1. It must never throw. The operator is driving. A logger that can take
 *      the app down is worse than no logger.
 *   2. It must survive a reload. iOS unloads a backgrounded PWA freely, and
 *      the interesting part of a bad session is often just before that.
 *   3. It must not itself cost what it is measuring. localStorage writes are
 *      synchronous; writing on every event would add jank to the exact path
 *      being diagnosed. Hence the buffered flush.
 *   4. It must be pasteable. The whole point is that the operator can copy it
 *      out of Settings and hand it over, so the text format is the product
 *      here, not the JSON.
 *
 * PRIVACY. Same standing as voiceHistory, and the same limits: text only,
 * never audio, this device's localStorage only, nothing uploads it, capped so
 * it cannot grow without bound, and clearable outright from Settings. It does
 * contain transcripts of what an open microphone heard, which is not a small
 * thing -- so the Settings panel says so plainly, next to the delete button.
 */

const STORAGE_KEY = 'bjtrainer.diagnostics.v1';

/**
 * Entries kept. Sized against the job: a fifteen-minute drive with voice on
 * produces on the order of a thousand lines once sessions, results, route
 * changes and heartbeats are all in, and the whole point is that the operator
 * can drive, stop, and paste the session that just happened.
 */
export const MAX_ENTRIES = 3000;

/**
 * A hard ceiling on the stored text, independent of the entry count.
 *
 * Entry count alone is not a safe cap: one pathological detail object (a long
 * transcript, an error blob) makes an entry arbitrarily large, and a full
 * localStorage quota is not a failure this app may have -- settings, profiles
 * and stats share it, and losing a profile to a debug log would be a bad
 * trade in anyone's book.
 */
export const MAX_BYTES = 400_000;

/** How long a burst of events is allowed to accumulate before it is written. */
export const FLUSH_DELAY_MS = 1000;

export type DiagCategory =
  /** Recognition session lifecycle: start, end, error, restart, watchdog. */
  | 'mic'
  /** What the microphone produced and what was made of it. */
  | 'heard'
  /** The app's own voice, which deafens the microphone while it talks. */
  | 'speak'
  /** Page visibility, freeze/resume, online/offline, pagehide. */
  | 'life'
  /** Audio input devices appearing and disappearing -- a car route flip. */
  | 'route'
  /** Microphone permission state and changes to it. */
  | 'perm'
  /** Screen wake lock taken, lost, re-taken. */
  | 'wake'
  /**
   * The silent hold that keeps the app the car's "now playing" app.
   *
   * Its own category because it is the direct evidence for the wheel: the
   * head unit sends buttons to whatever is PLAYING, so a press that reached
   * nothing and a press into a gap where the hold had lapsed are opposite
   * diagnoses. The hold shipped 2026-09-21 writing only to the probe, which
   * the operator's exported log does not contain -- so the 2026-09-20 drive
   * produced five wheel stamps and no way to tell whether the fix was even
   * running. Never again without a line here.
   */
  | 'focus'
  /** Settings and profile changes, with what actually changed. */
  | 'set'
  /** Which screen the operator is on. */
  | 'nav'
  /** One-off environment facts, written once per page load. */
  | 'env'
  /** Something threw where it should not have. */
  | 'err'
  /**
   * What the operator MEANT, stamped by hand.
   *
   * Every other category records what the app saw. This one records what was
   * intended, and it is the only thing that makes the rest readable: a log
   * with no `nexttrack` in it is either a car that never sent one or an
   * operator who never pressed the button, and those are opposite diagnoses
   * with identical evidence. Asked for in exactly those words (2026-09-16):
   * "I need a set of instructions in the app to properly follow so you know
   * what the intent is vs what shows up in the log."
   */
  | 'test';

export interface DiagEntry {
  /** Wall clock, ISO. What the operator correlates against their memory. */
  at: string;
  /**
   * Milliseconds since this page load.
   *
   * The wall clock is not enough on its own: the questions being asked are
   * "how long did that session last" and "how long was it deaf", and
   * subtracting ISO strings by eye across a minute boundary is exactly the
   * kind of arithmetic that produces a wrong conclusion at midnight.
   */
  ms: number;
  /** Which page load. A reload starts a new one, and iOS reloads freely. */
  session: string;
  category: DiagCategory;
  /** A short stable name, e.g. 'session-end'. Greppable. */
  event: string;
  /** Anything worth carrying. Rendered as k=v pairs. */
  detail?: Record<string, unknown>;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The id of this page load.
 *
 * Deliberately short and human-readable rather than a uuid: it appears on
 * every line of a log the operator reads, and its only job is to make the
 * boundary between "before the app reloaded" and "after" visible at a glance.
 */
function newSessionId(): string {
  const n = Math.floor(Math.random() * 46_656); // 36^3
  return n.toString(36).padStart(3, '0');
}

const sessionId = newSessionId();
const bootedAt = Date.now();

function nowMs(): number {
  // performance.now() is monotonic, which matters: a phone that re-syncs its
  // clock mid-drive would otherwise produce negative session durations.
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return Math.round(performance.now());
    }
  } catch {
    /* fall through */
  }
  return Date.now() - bootedAt;
}

let buffer: DiagEntry[] = [];
/**
 * Set false the first time a write is refused.
 *
 * A private window or a full quota refuses every write, and retrying one a
 * second forever costs main-thread time in the exact session being measured.
 * Once it is off, the in-memory buffer is the log: capped, complete for this
 * page load, and still copyable from Settings.
 */
let storageUsable = true;
let flushHandle: ReturnType<typeof setTimeout> | null = null;
let listeners: Array<() => void> = [];

function readStored(): DiagEntry[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is DiagEntry =>
        !!e && typeof e === 'object' && typeof (e as DiagEntry).event === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * Trim to both caps, oldest first.
 *
 * Byte-trimming is a loop rather than a slice because the entries are not the
 * same size and the expensive one is usually the newest -- a long transcript
 * arrives at the end, not the beginning.
 */
function trim(entries: DiagEntry[]): DiagEntry[] {
  let out = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries;
  let json = JSON.stringify(out);
  while (json.length > MAX_BYTES && out.length > 1) {
    out = out.slice(Math.ceil(out.length / 8));
    json = JSON.stringify(out);
  }
  return out;
}

/**
 * Write the buffer through to localStorage.
 *
 * Exported because the page can go away without warning -- `pagehide` on iOS
 * is often the last callback a backgrounded PWA ever gets -- and a buffered
 * log that loses its last second is a log that loses the interesting second.
 */
export function flushDiagnostics(): void {
  if (flushHandle !== null) {
    clearTimeout(flushHandle);
    flushHandle = null;
  }
  if (buffer.length === 0) return;

  // The buffer is only cleared once the write has actually landed.
  //
  // Clearing first lost the whole session in exactly the environments that
  // most need it -- a private window, a full quota -- because the entries
  // were gone from memory and had never reached storage. Now a device that
  // cannot persist still keeps a complete in-memory log for as long as the
  // page lives, which is long enough to copy it out of Settings.
  const s = storageUsable ? storage() : null;
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(trim([...readStored(), ...buffer])));
    buffer = [];
  } catch {
    // Quota, or a private window. Stop trying -- a doomed write every second
    // costs real time on the main thread -- and let the buffer BE the log.
    storageUsable = false;
  }
}

function scheduleFlush(): void {
  if (flushHandle !== null) return;
  try {
    flushHandle = setTimeout(() => {
      flushHandle = null;
      flushDiagnostics();
    }, FLUSH_DELAY_MS);
  } catch {
    flushDiagnostics();
  }
}

/**
 * Record one event. Never throws, whatever it is handed.
 *
 * `detail` is copied defensively and stringified at read time rather than
 * write time, so a caller passing a live object cannot have it mutate
 * underneath the log before it is flushed.
 */
export function diag(
  category: DiagCategory,
  event: string,
  detail?: Record<string, unknown>,
): void {
  try {
    const entry: DiagEntry = {
      at: new Date().toISOString(),
      ms: nowMs(),
      session: sessionId,
      category,
      event,
    };
    if (detail) {
      const safe: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(detail)) {
        if (v === undefined) continue;
        safe[k] =
          typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null
            ? v
            : String(v);
      }
      if (Object.keys(safe).length > 0) entry.detail = safe;
    }
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
    scheduleFlush();
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        /* a subscriber must never break the log */
      }
    }
  } catch {
    /* the log is never allowed to be the thing that fails */
  }
}

/** Everything recorded, oldest first, including anything not yet flushed. */
export function readDiagnosticLog(): DiagEntry[] {
  return [...readStored(), ...buffer];
}

export function clearDiagnosticLog(): void {
  buffer = [];
  storageUsable = true;
  if (flushHandle !== null) {
    clearTimeout(flushHandle);
    flushHandle = null;
  }
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

/** Notified whenever an entry is added or the log is cleared. */
export function subscribeDiagnostics(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((f) => f !== fn);
  };
}

/** `1:23.456` -- minutes into the page load, which is how a drive is recalled. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.abs(ms % 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function renderDetail(detail: Record<string, unknown> | undefined): string {
  if (!detail) return '';
  return Object.entries(detail)
    .map(([k, v]) => `${k}=${typeof v === 'string' && v.includes(' ') ? `"${v}"` : String(v)}`)
    .join(' ');
}

/**
 * The pasteable form.
 *
 * Fixed-width columns on purpose. The operator pastes this into a chat window
 * with no table rendering and no horizontal scrolling worth the name, and the
 * questions being asked of it -- "how long between these two lines", "which
 * category is repeating" -- are answered by scanning a column, not by reading
 * sentences.
 */
export function formatDiagnosticLog(entries: readonly DiagEntry[]): string {
  if (entries.length === 0) return 'Diagnostic log is empty.';
  const lines = entries.map((e) => {
    const d = renderDetail(e.detail);
    return `${formatElapsed(e.ms).padStart(9)} [${e.session}] ${e.category.padEnd(
      5,
    )} ${e.event.padEnd(18)}${d ? ' ' + d : ''}`;
  });
  const first = entries[0]!;
  const last = entries[entries.length - 1]!;
  const sessions = new Set(entries.map((e) => e.session)).size;
  return [
    `# Blackjack Trainer diagnostic log`,
    `# ${entries.length} entries, ${sessions} page load(s)`,
    `# first ${first.at}`,
    `# last  ${last.at}`,
    '',
    ...lines,
    '',
  ].join('\n');
}

/** Counts by category, for the Settings summary row. */
export function summariseDiagnostics(entries: readonly DiagEntry[]): {
  total: number;
  sessions: number;
  micStarts: number;
  micEnds: number;
  micErrors: number;
  heard: number;
} {
  let micStarts = 0;
  let micEnds = 0;
  let micErrors = 0;
  let heard = 0;
  for (const e of entries) {
    if (e.category === 'mic' && e.event === 'session-start') micStarts++;
    if (e.category === 'mic' && e.event === 'session-end') micEnds++;
    if (e.category === 'mic' && e.event === 'session-error') micErrors++;
    if (e.category === 'heard') heard++;
  }
  return {
    total: entries.length,
    sessions: new Set(entries.map((e) => e.session)).size,
    micStarts,
    micEnds,
    micErrors,
    heard,
  };
}

export { sessionId as diagnosticSessionId };
