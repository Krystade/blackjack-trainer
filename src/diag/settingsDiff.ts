/**
 * What actually changed between two settings objects.
 *
 * "It worked yesterday" is almost always a setting, and the app has a great
 * many of them: audio on, verbosity, card detail, eyes-free, on-device speech,
 * volume boost, recorded clips, count-check frequency, distraction mode. Any
 * of those can make the microphone behave differently, several are toggled
 * from screens nowhere near the drill, and none of them leave a trace.
 *
 * Logging the whole settings object on every write would be worse than
 * logging nothing: hundreds of lines of unchanged values, in which the one
 * changed value is invisible. So the log records the DIFF, as dotted paths --
 * `audio.verbosity: results -> full` -- which is both short enough to scan and
 * specific enough to act on.
 *
 * Kept as a pure function with no storage and no globals so it can be tested
 * in plain node, like the rest of the store layer.
 */

/** One changed leaf, as it reads in the log. */
export interface SettingChange {
  path: string;
  from: unknown;
  to: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function render(v: unknown): string {
  if (v === undefined) return '(unset)';
  if (v === null) return 'null';
  if (Array.isArray(v)) return `[${v.join(',')}]`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * Every leaf that differs, deepest-first paths, oldest value on the left.
 *
 * Arrays are compared as wholes rather than element by element: a bet spread
 * that went from [1,1,2,4] to [1,2,4,8] is one decision, and four lines
 * saying so would bury it.
 */
export function diffSettings(
  before: unknown,
  after: unknown,
  prefix = '',
  out: SettingChange[] = [],
): SettingChange[] {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      diffSettings(before[key], after[key], prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  const same =
    Array.isArray(before) && Array.isArray(after)
      ? JSON.stringify(before) === JSON.stringify(after)
      : Object.is(before, after);
  if (!same && prefix) out.push({ path: prefix, from: before, to: after });
  return out;
}

/**
 * The one-line form, for the log.
 *
 * Capped, because a first write against defaults legitimately changes
 * everything and a hundred-entry line helps nobody. The count is kept so the
 * truncation is visible rather than silent -- a log that quietly drops
 * evidence is the thing this whole module exists to avoid.
 */
export const MAX_CHANGES_LOGGED = 12;

export function formatChanges(changes: readonly SettingChange[]): string {
  if (changes.length === 0) return '(no change)';
  const shown = changes
    .slice(0, MAX_CHANGES_LOGGED)
    .map((c) => `${c.path}: ${render(c.from)} -> ${render(c.to)}`)
    .join('; ');
  return changes.length > MAX_CHANGES_LOGGED
    ? `${shown}; (+${changes.length - MAX_CHANGES_LOGGED} more)`
    : shown;
}
