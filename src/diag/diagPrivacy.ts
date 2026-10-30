/**
 * Which diagnostic-log fields are private, and the 30-day redaction of them.
 *
 * PRIVATE: words heard in the car (anyone in it, not only Jack) and the names
 * of audio devices, which often carry a person's name. After
 * REDACT_AFTER_DAYS their text is replaced; the entry, its timing and every
 * number stay, so an unanalysed field-test drive keeps its shape.
 *
 * Every text field any diag() call writes must be in one of the two lists
 * below: scripts/diagFields.test.ts walks the real call sites (typed, through
 * the app's TypeScript program) and fails on a field that is in neither.
 *
 * A key private in only some events lists them; in its other events it is
 * public (FieldTest's `text` is heard words in heard-text, an instruction in
 * say-start). Only string values are ever replaced, so a field that is a
 * count in one event (the voice result's `alternatives`) keeps its number.
 */

export const REDACT_AFTER_DAYS = 30;

/** What a redacted value becomes: short, so redaction never grows the log. */
export const REDACTED = '[r]';

export const PRIVATE_FIELDS: Readonly<Record<string, '*' | readonly string[]>> = {
  // Words heard.
  heard: '*',
  readings: '*', // the voice result's N-best list
  alternatives: '*', // the kits' other readings, joined (a count on voice results)
  text: ['heard-text', 'heard-own-voice', 'echo-unmatched', 'answer-unmatched', 'voice-echo', 'note'],
  // Device names.
  label: '*',
  labels: '*',
  inputs: '*',
  outputs: '*',
  first: '*',
  car: '*',
  chosen: '*',
  holdGot: '*',
  input: ['kit-record-start'],
  got: ['route-hold', 'route-hold-track'],
  wanted: ['route-hold'],
};

/** Text fields that carry nothing private: app vocabulary, ids, states, reasons. */
export const PUBLIC_FIELDS: ReadonlySet<string> = new Set([
  'action', 'actions', 'agc', 'answer', 'answers', 'applied', 'appliedHold', 'at', 'audioContext', 'band', 'build',
  'builtAt', 'by', 'byStep', 'carId', 'cell', 'changed', 'check', 'chosenId', 'classes', 'classification', 'command',
  'condition', 'conf', 'confs', 'context', 'contextState', 'deployed', 'deviceId', 'element', 'error', 'event',
  'evidence', 'expected', 'file', 'files', 'for', 'form', 'from', 'got', 'granted', 'guess', 'hiddenAt',
  'hiddenSession', 'hold', 'holdMuted', 'holdReadyState', 'holdState', 'holders', 'how', 'ids', 'input', 'kept',
  'key', 'kind', 'kit', 'lang', 'mark', 'match', 'message', 'mic', 'mime', 'mode', 'motion', 'muted', 'name', 'names',
  'nominated', 'ns', 'onStepAt', 'oneWord', 'oneWordHeard', 'online', 'outcome', 'overall', 'path', 'permissionError', 'phase', 'plan',
  'planSource', 'pref', 'probe', 'read_as', 'readyState', 'reason', 'recognition', 'remaining', 'restart', 'round',
  'route', 'run', 'said', 'said-remainder', 'say', 'scope', 'screen', 'session', 'sinkId', 'skipped', 'source',
  'stage', 'standalone', 'state', 'stateAtArrival', 'status', 'step', 'steps', 'strategy', 'strategySetting', 'tag', 'target',
  'text', 'to', 'trackSampleRate', 'twoWord', 'twoWordHeard', 'ua', 'url', 'useClips', 'verdict', 'via', 'visibility', 'voice',
  'voiceId', 'wanted', 'was', 'webaudio', 'wheelMode', 'when', 'which', 'why', 'word',
]);

/** 'private' or 'public' for a field in an event, or null when nothing says ('*' = a computed event name). */
export function fieldClass(event: string, key: string): 'private' | 'public' | null {
  const p = PRIVATE_FIELDS[key];
  if (p === '*') return 'private';
  if (p !== undefined) {
    if (event === '*') return null; // private in some events: a computed name cannot say which
    if (p.includes(event)) return 'private';
  }
  return PUBLIC_FIELDS.has(key) ? 'public' : null;
}

function isPrivate(event: string, key: string): boolean {
  const p = PRIVATE_FIELDS[key];
  return p === '*' || (p !== undefined && p.includes(event));
}

/** The replacement for one private value, never longer than it (JSON); undefined to leave it. */
function replacement(v: unknown): string | undefined {
  const hasText = typeof v === 'string' ? v !== '' && v !== REDACTED : Array.isArray(v) && v.some((x) => typeof x === 'string' && x !== '');
  if (!hasText) return undefined;
  return JSON.stringify(REDACTED).length <= JSON.stringify(v).length ? REDACTED : '';
}

/** The detail with its private text replaced, or null when there is nothing to replace. */
export function redactDetail(event: string, detail: Readonly<Record<string, unknown>>): Record<string, unknown> | null {
  let out: Record<string, unknown> | null = null;
  for (const [k, v] of Object.entries(detail)) {
    if (!isPrivate(event, k)) continue;
    const r = replacement(v);
    if (r === undefined) continue;
    out ??= { ...detail };
    out[k] = r;
  }
  return out;
}
