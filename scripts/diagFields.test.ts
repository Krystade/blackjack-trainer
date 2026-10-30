import { describe, it, expect } from 'vitest';
import { census } from './diagFields';
import { PRIVATE_FIELDS, PUBLIC_FIELDS, fieldClass } from '../src/diag/diagPrivacy';

/**
 * R3: every text field any diag() call writes is classified private (replaced
 * after 30 days) or public (kept). A new field fails here until someone says
 * which, so the redaction cannot quietly miss words heard in the car again.
 */

/**
 * Details whose type cannot name their fields. Each is checked by key at run
 * time like any other (a `heard` inside one is still redacted); the reason
 * says why its fields are not private today.
 */
const OPAQUE: Record<string, string> = {
  'src/diag/fieldTest.ts|answer|extra': 'a FieldTestStep subset: step ids and response ids the app defines',
  'src/diag/driveChecks.ts|*|evidence': 'drive-check evidence: numbers, statuses and step names built in driveChecks/carCheckCatalog',
  'src/ui/screens/TestKit.tsx|kit-answer|extra': 'tallies and counts passed by each kit step (element, webaudio, probes, count, overall)',
  'src/ui/screens/TestKit.tsx|kit-phone-summary|flat': "the phone-mic kit's verdict lines, app text keyed by check id",
};

const { fields, opaque } = census();

describe('diag field classification (R3)', () => {
  it('reads the real call sites (the census is not silently empty)', () => {
    expect(fields.length).toBeGreaterThan(400);
    const has = (key: string, event: string) => fields.some((f) => f.key === key && f.events.includes(event) && f.text);
    expect(has('readings', 'result')).toBe(true);
    expect(has('text', 'heard-text')).toBe(true);
    expect(has('input', 'kit-record-start')).toBe(true);
    expect(has('first', 'route-snapshot')).toBe(true);
    // A number is not text: the voice result's alternatives count.
    expect(fields.some((f) => f.key === 'alternatives' && f.events.includes('result') && !f.text)).toBe(true);
  });

  it('every text field is classified private or public', () => {
    const missing = fields
      .filter((f) => f.text)
      .flatMap((f) => f.events.filter((e) => fieldClass(e, f.key) === null).map((e) => `${f.site} ${e}.${f.key}`));
    expect(missing).toEqual([]);
  });

  it('the private words and device names are private, and the session types and counts are not', () => {
    for (const [event, key] of [
      ['result', 'readings'],
      ['result', 'heard'],
      ['heard-text', 'text'],
      ['heard-own-voice', 'text'],
      ['echo-unmatched', 'text'],
      ['answer-unmatched', 'text'],
      ['note', 'text'],
      ['kit-record-start', 'input'],
      ['route-snapshot', 'first'],
      ['route-snapshot', 'inputs'],
      ['route-hold-track', 'got'],
      ['kit-inputs', 'labels'],
    ] as const) {
      expect(fieldClass(event, key), `${event}.${key}`).toBe('private');
    }
    for (const [event, key] of [
      ['audio-session', 'wanted'],
      ['audio-session', 'got'],
      ['say-start', 'text'],
      ['kit-phone-recognise-note', 'input'],
    ] as const) {
      expect(fieldClass(event, key), `${event}.${key}`).toBe('public');
    }
  });

  it('every opaque detail is listed with a reason, and every listed one still exists', () => {
    const found = new Set(opaque.flatMap((o) => o.events.map((e) => `${o.site.replace(/:\d+$/, '')}|${e}|${o.expr}`)));
    expect([...found].filter((k) => !(k in OPAQUE))).toEqual([]);
    expect(Object.keys(OPAQUE).filter((k) => !found.has(k))).toEqual([]);
  });

  it('the registry names only fields some call writes', () => {
    const keys = new Set(fields.map((f) => f.key));
    expect(Object.keys(PRIVATE_FIELDS).filter((k) => !keys.has(k))).toEqual([]);
    expect([...PUBLIC_FIELDS].filter((k) => !keys.has(k))).toEqual([]);
  });
});
