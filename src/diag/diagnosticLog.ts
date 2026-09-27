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

/**
 * How many entries were dropped since the page loaded.
 *
 * Surfaced in the export header. A log that silently drops part of a drive is
 * worse than one that says it did: the reader cannot tell "the app never logged
 * that" from "the app logged it and threw it away", and those have opposite
 * diagnoses. Counts malformed entries as well as ones lost to the caps, because
 * both leave the same kind of hole.
 */
let droppedEntries = 0;

/**
 * The drop count belongs WITH the entries, because the entries outlive the tab.
 *
 * This was plain module state, so it reset to zero on every page load while the
 * log itself persisted. iOS unloads a backgrounded PWA freely -- which is the
 * whole reason `session` exists -- so a drive that reloads twice and trims on
 * the first two loads exported a header saying nothing had been discarded. The
 * header exists precisely to stop a reader confusing "never logged" with
 * "logged and thrown away", and in the commonest shape of a long drive it was
 * asserting the wrong one.
 */
const DROPPED_KEY = 'bjtrainer.diagnostics.dropped.v1';

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
 *
 * SIZED SO `MAX_ENTRIES` IS REACHABLE, which at 400_000 it was not. Measured
 * against the app's own traffic, that ceiling kept 2138 entries of ordinary
 * `mic`/`heard` lines and about 1544 of `speak path` -- so the entry cap
 * above was decoration and roughly half of a long drive was discarded from
 * the FRONT, which is where the run start, the condition and the first route
 * steps live. The figure below fits 3000 realistic entries with headroom and
 * is still a small fraction of the several megabytes Safari allows an origin,
 * so the quota argument above is untouched.
 */
export const MAX_BYTES = 1_200_000;

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
  /**
   * What the CAR sent, and what the app did with it.
   *
   * Previously written only to `mediaSessionLog`, which the exported log does
   * not contain -- so every wheel press the operator ever made was recorded
   * somewhere they never saw, and four drives produced "the buttons did
   * nothing" with no way to tell a car that sent nothing from an app that
   * ignored it. The single most expensive instrumentation gap in this
   * project.
   */
  | 'wheel'
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
    // EVERY FIELD THE RENDERER TOUCHES, not just `event`.
    //
    // `formatDiagnosticLog` called `e.category.padEnd(5)` unguarded, so one
    // stored entry without a `category` threw during Settings' render -- and
    // Settings formats the log whether or not the panel is open. The
    // ErrorBoundary then bounced to home, which puts Export, View and Clear all
    // inside the panel that will not render: the log could not be read, sent or
    // cleared without devtools. Anything malformed is dropped and counted, so
    // the header admits the hole instead of the export dying on it.
    const before = parsed.length;
    const kept = parsed.filter(
      (e): e is DiagEntry =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as DiagEntry).event === 'string' &&
        typeof (e as DiagEntry).category === 'string' &&
        typeof (e as DiagEntry).at === 'string' &&
        typeof (e as DiagEntry).ms === 'number' &&
        typeof (e as DiagEntry).session === 'string',
    );
    if (kept.length < before) droppedEntries += before - kept.length;
    return kept;
  } catch {
    return [];
  }
}


export function diagnosticEntriesDropped(): number {
  return droppedEntries + storedDropped();
}

/** Drops recorded by earlier page loads, alongside the entries they trimmed. */
function storedDropped(): number {
  const s = storage();
  if (!s) return 0;
  try {
    const n = Number(s.getItem(DROPPED_KEY));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Fold this load's drops into the persisted total. Called on every flush. */
function persistDropped(): void {
  if (droppedEntries === 0) return;
  const s = storage();
  if (!s) return;
  try {
    s.setItem(DROPPED_KEY, String(storedDropped() + droppedEntries));
    droppedEntries = 0;
  } catch {
    /* the count is the least important thing to lose when storage is failing */
  }
}

/** Test seam. */
export function _resetDroppedForTest(): void {
  droppedEntries = 0;
}

/**
 * The longest a single entry's detail may be before it is cut.
 *
 * A transcript of a long sentence, or a stack trace, can be several KB. One
 * such entry used to be exempt from the byte cap entirely (the loop guard was
 * `out.length > 1`), so it sailed past `MAX_BYTES` into `setItem`, threw
 * `QuotaExceededError`, and permanently disabled persistence for the rest of
 * the page's life -- with nothing in the log saying so.
 */
const MAX_DETAIL_CHARS = 2000;

/** Keep an object as an object when it can round-trip; otherwise describe it. */
function toSafeValue(v: unknown): unknown {
  try {
    const json = JSON.stringify(v);
    // An Error serialises to `{}` -- its message and name are not enumerable
    // -- so round-tripping it would throw away the only part anybody wants.
    // `String(v)` gives "Error: boom", which is the record worth keeping.
    if (json === undefined || json === '{}') return String(v);
    return JSON.parse(json) as unknown;
  } catch {
    // Circular, or a throwing toJSON. `String(v)` is a poor record but it is
    // a record, and it cannot break the line.
    return String(v);
  }
}

/**
 * Cap one detail value by its SERIALISED size, whatever type it is.
 *
 * Both caps used to guard on `typeof v === 'string'`, so an object or an array
 * escaped them entirely: a single entry carrying a large array produced a
 * 3,289,010-byte write -- past `MAX_BYTES`, with no `# TRIMMED`, because
 * `trim()`'s loop is gated on `out.length > 1` and one oversized entry is never
 * more than one entry. On a real device that `setItem` throws
 * QuotaExceededError, which disables persistence for the rest of the page's
 * life. No caller passes a non-primitive today; one line of new code re-arms it.
 */
function capValue(v: unknown): unknown {
  if (typeof v === 'string') {
    return v.length > MAX_DETAIL_CHARS
      ? `${v.slice(0, MAX_DETAIL_CHARS)}…[+${v.length - MAX_DETAIL_CHARS} chars]`
      : v;
  }
  if (v === null || typeof v !== 'object') return v;
  let json: string;
  try {
    json = JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
  if (json.length <= MAX_DETAIL_CHARS) return v;
  // Replaced by its own description rather than a truncated fragment: half an
  // object is not parseable and reads as though the rest were never recorded.
  return `${json.slice(0, MAX_DETAIL_CHARS)}…[+${json.length - MAX_DETAIL_CHARS} chars]`;
}

function truncateEntry(e: DiagEntry): DiagEntry {
  if (!e.detail) return e;
  let changed = false;
  const detail: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e.detail)) {
    const capped = capValue(v);
    if (capped !== v) changed = true;
    detail[k] = capped;
  }
  return changed ? { ...e, detail } : e;
}

/**
 * Trim to both caps, oldest first.
 *
 * BY MEASURED EXCESS, not by eighths. The old loop dropped `length/8` per
 * pass and re-measured, which overshot badly: 3000 entries with ~120-char
 * details needed ~370 removed and lost 1463, and 3000 entries with ~60-char
 * details silently capped the buffer at ~2000 -- so `MAX_ENTRIES = 3000` was
 * fiction. What it discards is always the OLDEST end, which is the page load,
 * the run start, the condition, and the first route steps: the part of a drive
 * that says what was being measured.
 */
function trim(entries: DiagEntry[]): DiagEntry[] {
  let out = entries;
  if (out.length > MAX_ENTRIES) {
    droppedEntries += out.length - MAX_ENTRIES;
    out = out.slice(out.length - MAX_ENTRIES);
  }

  let json = JSON.stringify(out);
  if (json.length <= MAX_BYTES) return out;

  // A single entry can be over the cap by itself. Cut its detail rather than
  // exempting it, so the buffer can never hand `setItem` something it will
  // refuse.
  out = out.map(truncateEntry);
  json = JSON.stringify(out);

  while (json.length > MAX_BYTES && out.length > 1) {
    // Estimate how many of the oldest entries cover the excess, and take at
    // least one so this always terminates.
    const excess = json.length - MAX_BYTES;
    const perEntry = Math.max(1, Math.floor(json.length / out.length));
    const drop = Math.max(1, Math.min(out.length - 1, Math.ceil(excess / perEntry)));
    droppedEntries += drop;
    out = out.slice(drop);
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
    // Written beside the entries, so a reload inherits the count rather than
    // starting again at zero while the trimmed entries stay gone.
    persistDropped();
  } catch (e) {
    // Quota, or a private window. Stop trying -- a doomed write every second
    // costs real time on the main thread -- and let the buffer BE the log.
    storageUsable = false;
    // ...AND SAY SO. This was silent, and the silence is actively misleading:
    // the in-memory buffer keeps the current page load intact, so nothing looks
    // wrong until the reload -- after which the stored log simply stops dead at
    // the failure point and the next load's entries begin. A reader takes that
    // for the operator having closed the app, or iOS unloading the PWA, which
    // is one of the three hypotheses this file exists to tell apart. The entry
    // lands in the buffer, which is still live, so it survives to the export.
    diag('err', 'persist-failed', {
      why: e instanceof Error ? e.name : String(e),
      buffered: buffer.length,
    });
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
/**
 * Ambient facts stamped onto every entry while they are set.
 *
 * WHY THIS EXISTS. Only `test` entries ever carried a step, and nothing at all
 * carried a run. `speak path`, `speak clip-chain`, `speak clip-end`,
 * `wheel invoke`, `wheel dispatch`, `focus *` and `route *` had no step, no
 * condition and no run on them -- so a clip failure could be tied to the step
 * that caused it only by ADJACENCY, and adjacency is exactly what the async
 * `.then()` in clips.ts and the interleaved heartbeat break. Two runs under
 * `condition=car` in one export were separable only by proximity to
 * `run-start`, which is missing whenever the app was killed mid-run.
 *
 * Kept deliberately small: a run id and a step, both short, because every
 * entry pays for them in bytes.
 */
let ambientContext: Record<string, string> = {};

export function setDiagContext(next: Record<string, string | undefined>): void {
  const merged: Record<string, string> = { ...ambientContext };
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  ambientContext = merged;
}

export function clearDiagContext(): void {
  ambientContext = {};
}

export function diagContext(): Record<string, string> {
  return { ...ambientContext };
}

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
    // The caller's own detail wins: a step that explicitly names a different
    // step is saying something, and the ambient value must not overwrite it.
    if (Object.keys(ambientContext).length > 0) {
      detail = { ...ambientContext, ...(detail ?? {}) };
    }
    if (detail) {
      const safe: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(detail)) {
        if (v === undefined) continue;
        const primitive =
          typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null;
        // OBJECTS ARE KEPT AS OBJECTS, so the renderer can serialise them.
        // `String(v)` turned every one into the literal `[object Object]`,
        // which is a total loss of whatever was being recorded -- and it
        // happened here, before the renderer could ever see it.
        safe[k] = primitive ? v : toSafeValue(v);
        // AND CUT HERE, at the point of entry, not only on the way to
        // storage. The byte cap lived in `trim()`, which runs on flush --
        // but the export is built from `readDiagnosticLog()`, which is the
        // in-memory buffer plus what is stored. So an entry carrying a
        // multi-kilobyte transcript or stack trace was uncapped in the
        // artefact that actually leaves the device, and on the documented
        // path where storage has failed and "the buffer IS the log" it was
        // uncapped everywhere.
        safe[k] = capValue(safe[k]);
      }
      if (Object.keys(safe).length > 0) entry.detail = safe;
    }
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) {
      // Counted, not silent. This is the other place entries disappear, and
      // the header has to be able to say so.
      droppedEntries += buffer.length - MAX_ENTRIES;
      buffer = buffer.slice(-MAX_ENTRIES);
    }
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
  // THE DROP COUNT GOES WITH THE ENTRIES IT COUNTED. It is module state, and
  // leaving it standing made a freshly cleared log carry
  // "# TRIMMED: 500 older entries dropped to fit the cap" above a single
  // line -- so a reader discarded a complete record as truncated. The header
  // exists to stop a reader confusing "never logged" with "logged and thrown
  // away"; a stale count does that damage in the other direction.
  droppedEntries = 0;
  if (flushHandle !== null) {
    clearTimeout(flushHandle);
    flushHandle = null;
  }
  try {
    storage()?.removeItem(STORAGE_KEY);
    // ...AND THE PERSISTED COUNT WITH IT. Now that the count outlives the page
    // load it also has to die with the entries it counted, or a freshly cleared
    // log carries a TRIMMED header above a single line -- which makes a reader
    // discard a complete record as truncated.
    storage()?.removeItem(DROPPED_KEY);
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
  // SIGN HOISTED OUT, then formatted from the magnitude. A negative elapsed
  // is real -- the clock resyncs mid-drive and an entry lands before the boot
  // stamp -- and formatting it directly produced `-1:-1.045`: two minus signs
  // inside the number, a seconds field that is not two digits, and every
  // column to the right of it knocked out of line for the rest of the export.
  const sign = ms < 0 ? '-' : '';
  const abs = Math.abs(ms);
  const totalSeconds = Math.floor(abs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = abs % 1000;
  return `${sign}${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * One `key=value` run, escaped so the line can be read back.
 *
 * The old version quoted a string only when it contained a SPACE and escaped
 * nothing, which made the log unparseable and, worse, forgeable:
 *
 *   heard: 'hit=stand'            -> heard=hit=stand      (field boundary gone)
 *   heard: 'he said "double"'     -> heard="he said "double""  (unparseable)
 *   heard: 'double\n 0:00.000 [zzz] mic session-start'
 *                                 -> TWO LINES, the second indistinguishable
 *                                    from a real entry
 *
 * That last one is not hypothetical. `err window-error`, `err
 * unhandled-rejection` and `test say-failed` all carry `Error.message` or
 * `String(e)`, and a stack or a multi-line message routinely contains
 * newlines; `heard utterance` carries whatever the operator said. For an
 * artefact whose only purpose is evidence, a value that can insert a
 * convincing fake log line is disqualifying on its own.
 *
 * `JSON.stringify` on every string handles the quote, the backslash and the
 * newline correctly and round-trips, and objects serialise instead of
 * collapsing to `[object Object]`.
 */
/** `+01:00`, so the two clocks in this artefact can be reconciled. */
function utcOffsetLabel(): string {
  // `getTimezoneOffset` is minutes BEHIND UTC, so the sign is inverted.
  const minutes = -new Date().getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** `14:32:16.047` in local time, or blank padding when the stamp is unusable. */
function clockOf(e: DiagEntry): string {
  const t = Date.parse(e.at);
  if (Number.isNaN(t)) return ' '.repeat(12);
  const d = new Date(t);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(
    d.getMilliseconds(),
    3,
  )}`;
}

/**
 * The LOCAL calendar day an entry belongs to, for the day separators.
 *
 * Local rather than UTC because it has to match the body clock beside it: a
 * reader anchoring a line against their own memory of the drive is thinking in
 * the timezone they drove in.
 */
function localDayOf(e: DiagEntry): string {
  const t = Date.parse(e.at);
  if (Number.isNaN(t)) return 'unknown date';
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function renderDetail(detail: Record<string, unknown> | undefined): string {
  if (!detail) return '';
  return (
    Object.entries(detail)
      // THE KEY IS ESCAPED TOO, and it was the one thing here that was not.
      //
      // Values, `category` and `event` all went through `quoteIfNeeded`; the
      // key was interpolated raw. `readStored` validates `at`, `ms`, `session`,
      // `category` and `event` and accepts ANY object as `detail`, so a key
      // carrying a newline produced a whole extra body line, indistinguishable
      // from a real one down to a session id that appears nowhere else --
      // reproduced in an export. The threat model is modest (same-origin
      // storage, or one future `diag()` that spreads a data-derived object into
      // detail -- useVoiceControl already spreads a caller-supplied one), but
      // the invariant this file states about itself is that a value must never
      // be able to insert a convincing fake log line. Half an invariant is not
      // one.
      .map(([k, v]) => `${quoteIfNeeded(k)}=${renderValue(v)}`)
      .join(' ')
  );
}

/**
 * A value must be quoted if it carries a delimiter or a control character:
 * whitespace, `=`, a double quote, a backslash, or anything below U+0020.
 */
const NEEDS_QUOTING = /[\s="\\\u0000-\u001f]/;

function renderValue(v: unknown): string {
  // Numbers, booleans, null and undefined have no ambiguous characters and
  // are far easier to scan in a column unquoted.
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return quoteIfNeeded(v);
  try {
    const json = JSON.stringify(v);
    return json === undefined ? quoteIfNeeded(String(v)) : json;
  } catch {
    // Circular, or a value with a throwing toJSON. Still must not emit a
    // newline.
    return quoteIfNeeded(String(v));
  }
}

/**
 * Quote a value exactly when leaving it bare would be ambiguous.
 *
 * The rule is logfmt's, and it is what makes the line both scannable and
 * parseable: a bare value contains no delimiter, so `condition=car` stays a
 * clean column, while anything carrying a space, an `=`, a quote, a backslash
 * or a control character is quoted and escaped by `JSON.stringify` -- which
 * handles the newline case that previously let an error message insert a
 * convincing fake log line into the export.
 */
function quoteIfNeeded(v: string): string {
  return v === '' || NEEDS_QUOTING.test(v) ? JSON.stringify(v) : v;
}



/**
 * How far each page load's wall clock sat from its monotonic one.
 *
 * `at` is `Date.now()` and `ms` is `performance.now()`. Their difference is
 * constant for a page load unless the OS corrects the wall clock, which a phone
 * does on rejoining a network — i.e. during a drive. A corrected session has
 * two offsets, and the one shared by most of its entries is the clock the
 * session actually ran on.
 *
 * The median is taken rather than the first entry's, so a correction that
 * lands early does not define the whole session by the few lines before it.
 */
function clockOffsets(entries: readonly DiagEntry[]): Map<string, number> {
  const bySession = new Map<string, number[]>();
  for (const e of entries) {
    const at = Date.parse(e.at);
    if (Number.isNaN(at)) continue;
    const list = bySession.get(e.session);
    if (list) list.push(at - e.ms);
    else bySession.set(e.session, [at - e.ms]);
  }
  const out = new Map<string, number>();
  for (const [session, offsets] of bySession) {
    offsets.sort((a, b) => a - b);
    out.set(session, offsets[Math.floor(offsets.length / 2)] ?? 0);
  }
  return out;
}

/**
 * A correction big enough to reorder a log, as opposed to ordinary drift.
 *
 * The two clocks are independent and wander apart by milliseconds over a long
 * session; `ms` is also rounded to whole milliseconds. Two seconds is far above
 * either and far below any correction worth reporting.
 */
const CLOCK_RESYNC_MS = 2_000;

/** Which sessions had their wall clock moved under them, and by how much. */
function clockResyncs(entries: readonly DiagEntry[]): { session: string; ms: number }[] {
  const spread = new Map<string, { lo: number; hi: number }>();
  for (const e of entries) {
    const at = Date.parse(e.at);
    if (Number.isNaN(at)) continue;
    const offset = at - e.ms;
    const seen = spread.get(e.session);
    if (!seen) spread.set(e.session, { lo: offset, hi: offset });
    else {
      if (offset < seen.lo) seen.lo = offset;
      if (offset > seen.hi) seen.hi = offset;
    }
  }
  const out: { session: string; ms: number }[] = [];
  for (const [session, { lo, hi }] of spread) {
    if (hi - lo >= CLOCK_RESYNC_MS) out.push({ session, ms: hi - lo });
  }
  return out;
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
  // TIME ORDER, not flush order.
  //
  // Each tab buffers for up to FLUSH_DELAY_MS and then appends, so two tabs --
  // the installed PWA and a Safari tab, which this app already ships cross-tab
  // machinery for -- interleave out of sequence: reproduced as
  // B(00.500) A(00.100) A(00.900). The wall-clock column then jumps backwards
  // mid-file with no explanation, and `# first` printed the first ARRAY element
  // rather than the earliest entry, which is just false.
  //
  // ...AND NOT ON THE WALL CLOCK ALONE, which was the other half of the same
  // problem. `at` is `Date.now()`, and a phone corrects it by NTP on rejoining
  // a network -- during a drive, which is the only time this log is written.
  // A correction of a few seconds reorders every line around it, so the reader
  // meets `recogniser error` above `recogniser start`: a different diagnosis
  // from the one that happened, printed in a file whose whole job is sequence.
  //
  // `ms` is monotonic within a page load and useless across them, since each
  // starts at zero. Adding the session's own clock offset makes it both: the
  // lifecycle reads in order, and the two tabs above still interleave.
  const offsets = clockOffsets(entries);
  const indexOf = new Map<DiagEntry, number>();
  for (const [i, e] of entries.entries()) if (!indexOf.has(e)) indexOf.set(e, i);
  const keyOf = (e: DiagEntry): number => (offsets.get(e.session) ?? 0) + e.ms;
  const ordered = [...entries].sort(
    (a, b) => keyOf(a) - keyOf(b) || (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0),
  );

  const lines: string[] = [];
  let lastDay = '';
  for (const e of ordered) {
    // THE DAY, WHENEVER IT CHANGES. The body prints HH:MM:SS.mmm only and
    // nothing caps the log by age, so 3000 entries is days of ordinary use. A
    // reader meeting `23:58:41` then `00:02:10` reads the clock as running
    // backwards, or takes two adjacent lines for seconds apart when they are
    // twenty hours apart. This also fixes the DST case, which a single header
    // offset gets wrong for half the file.
    const day = localDayOf(e);
    if (day !== lastDay) {
      lines.push(`# --- ${day} ---`);
      lastDay = day;
    }
    const d = renderDetail(e.detail);
    // WALL CLOCK AS WELL AS ELAPSED. Elapsed is per page load, and a log
    // routinely spans nine of them -- so two lines that look adjacent could be
    // forty minutes apart, the gap between loads was invisible, and no line
    // could be tied to a moment the operator actually remembers ("when I
    // merged onto the 101"). `at` was already stored on every entry and only
    // the header ever printed it.
    //
    // `category` and `event` GO THROUGH `quoteIfNeeded` like every other
    // column. They were printed raw -- the two columns a reader trusts most --
    // while detail values are escaped precisely because an injected newline can
    // insert a convincing fake log line, and `readStored` accepts any string.
    lines.push(
      `${clockOf(e)} ${formatElapsed(e.ms).padStart(9)} [${e.session}] ${quoteIfNeeded(
        e.category,
      ).padEnd(5)} ${quoteIfNeeded(e.event).padEnd(18)}${d ? ' ' + d : ''}`,
    );
  }
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  const sessions = new Set(entries.map((e) => e.session)).size;
  const dropped = diagnosticEntriesDropped();
  return [
    `# Blackjack Trainer diagnostic log`,
    `# ${entries.length} entries, ${sessions} page load(s)`,
    // Said out loud, because the alternative is a reader who cannot tell a
    // missing entry from a discarded one.
    //
    // THE ACCESSOR, NOT THE MODULE VARIABLE, and the difference was the whole
    // header. `persistDropped()` folds `droppedEntries` into storage and then
    // zeroes it, and `flushDiagnostics` calls it on every successful write --
    // so on a device, which flushes every second, this variable is non-zero
    // for microseconds and zero the rest of the time. Every real export said
    // nothing had been discarded while the front of the drive -- the page
    // load, the run start, the condition, the first route steps -- was gone.
    //
    // The test that was supposed to guard this never called
    // `flushDiagnostics()`, so it read the counter in the one window the
    // device never exports from: it could not fail.
    ...(dropped > 0
      ? [`# TRIMMED: ${dropped} older entries dropped to fit the cap`]
      : []),
    // The export leaves the device -- pasted into a chat, mailed to whoever is
    // helping. The Settings panel warns; the artefact did not.
    // NAMES EVERY KIND OF SENSITIVE CONTENT, because this is the last thing
    // standing between the file and a third party. It said "transcripts" only,
    // while the first four lines of a real export carry the full user agent,
    // the deployed URL, and then Bluetooth device labels -- which routinely
    // carry a person's own name ("AirPods Pro de Jack", a car's model) --
    // plus profile names, plus whatever a passenger said near an open mic.
    `# Contains speech captured in the vehicle, including anyone else present;`,
    `# audio device names, which often include a person's name; this device's`,
    `# browser and OS version; the app URL; and profile names.`,
    // BOTH CLOCKS NAMED. The body prints local time and these print UTC, and
    // nothing said so -- so a reader anchoring "I merged onto the 101 around
    // ten past" against the header landed hours away from the body lines. The
    // body clock also carries no date, which a drive crossing midnight reads
    // as running backwards.
    `# body clock is local (UTC${utcOffsetLabel()}); first/last below are UTC`,
    // SAID, WHEN IT HAPPENED. The body prints times exactly as they were
    // recorded -- the log does not invent a timestamp -- so a corrected clock
    // still shows a backwards jump in the wall-clock column even though the
    // order is now right. Unexplained, that reads as the log being broken; the
    // line below is what tells the reader it is the phone's clock and not the
    // sequence.
    ...clockResyncs(entries).map(
      (r) =>
        `# clock moved ${formatElapsed(r.ms)} during page load ${r.session}; lines are in true order, times are as recorded`,
    ),
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
