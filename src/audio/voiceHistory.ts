/**
 * Everything the microphone heard, kept so the vocabulary can be improved
 * from evidence instead of guesses.
 *
 * The alias table only grows when a real mishearing is caught. "Stant" for
 * "stand" was found by the operator noticing a rejection on screen mid-drill
 * and reporting it -- which works exactly once per lucky glance, and not at
 * all while driving, which is where the interesting failures happen. Road
 * noise, a car microphone and a moving car are precisely the conditions that
 * produce substitutions nobody would think to invent.
 *
 * So every transcript is recorded with what was made of it. Read back later,
 * the rejections are a list of candidate aliases, and the accepted ones are
 * a check that biasing has not started forcing unrelated speech into
 * commands.
 *
 * PRIVACY. This is a recording of what an open microphone heard, which is not
 * a small thing. It is text, never audio; it is written to this device's
 * localStorage and to nowhere else; nothing uploads it; it is capped, so it
 * cannot grow without bound; and it can be cleared outright from Settings.
 * The microphone itself is still opened only by an explicit per-session
 * toggle -- this records what that microphone hears, it never opens one.
 */

const STORAGE_KEY = 'bjtrainer.voiceHistory.v1';

/**
 * Enough to cover several sessions of drilling, and small enough that the
 * whole log stays pasteable and well inside a localStorage quota.
 */
export const MAX_ENTRIES = 500;

export interface HeardEntry {
  /** ISO timestamp: mishearings cluster, and when matters when reading back. */
  at: string;
  /** Exactly what the engine returned, unmodified. */
  heard: string;
  /** What the app made of it -- an action, 'rejected', or a screen's own label. */
  verdict: string;
  /** Which screen was listening. A word means different things in each. */
  context: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readVoiceHistory(): HeardEntry[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is HeardEntry =>
        !!e && typeof e === 'object' && typeof (e as HeardEntry).heard === 'string',
    );
  } catch {
    return [];
  }
}

export function clearVoiceHistory(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * Record one utterance.
 *
 * Never throws: this is a notebook, and a full quota or a private window must
 * not be able to interrupt someone mid-drill.
 */
export function recordHeard(heard: string, verdict: string, context: string): void {
  const text = heard.trim();
  if (!text) return;
  const s = storage();
  if (!s) return;
  try {
    const entries = readVoiceHistory();
    entries.push({ at: new Date().toISOString(), heard: text, verdict, context });
    s.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* quota or private mode */
  }
}

export interface HistorySummary {
  total: number;
  matched: number;
  rejected: number;
  /** Rejected transcripts by how often each came back, commonest first. */
  candidates: Array<{ heard: string; count: number }>;
}

/**
 * Summarise a log for reading back.
 *
 * The ranked rejections are the point: a substitution the engine makes
 * repeatedly for the same word is a real alias worth adding, while a
 * one-off is usually just something that was said near the microphone. The
 * count is what tells them apart, so it is the sort key.
 */
export function summariseHistory(entries: HeardEntry[] = readVoiceHistory()): HistorySummary {
  const rejected = entries.filter((e) => e.verdict === 'rejected' || e.verdict === 'not a command');

  const counts = new Map<string, number>();
  for (const entry of rejected) {
    const key = entry.heard.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const candidates = [...counts.entries()]
    .map(([heard, count]) => ({ heard, count }))
    // Ties broken alphabetically so the same log always reads the same way.
    .sort((a, b) => b.count - a.count || a.heard.localeCompare(b.heard));

  return {
    total: entries.length,
    matched: entries.length - rejected.length,
    rejected: rejected.length,
    candidates,
  };
}

/** The log as pasteable text, ranked rejections first. */
export function formatVoiceHistory(entries: HeardEntry[] = readVoiceHistory()): string {
  const summary = summariseHistory(entries);

  const lines = [
    'Blackjack Trainer — everything the microphone heard',
    `captured: ${new Date().toISOString()}`,
    '',
    `utterances: ${summary.total}`,
    `understood: ${summary.matched}`,
    `not understood: ${summary.rejected}`,
    '',
    '--- not understood, commonest first (candidate aliases) ---',
  ];

  if (summary.candidates.length === 0) {
    lines.push('(nothing was rejected)');
  } else {
    // A repeat is the signal; a single stray phrase usually is not.
    for (const c of summary.candidates) {
      lines.push(`${String(c.count).padStart(4)}x  "${c.heard}"`);
    }
  }

  lines.push('', '--- everything, in order ---');
  for (const e of entries) {
    lines.push(`${e.at}  [${e.context}]  "${e.heard}" -> ${e.verdict}`);
  }
  return lines.join('\n');
}
