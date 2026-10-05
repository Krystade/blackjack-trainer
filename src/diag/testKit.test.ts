import { describe, it, expect } from 'vitest';
import {
  KITS,
  blindOrder,
  type KitStep,
  KIT_RESUME_WINDOW_MS,
  calibrationSchedule,
  parseProgress,
  scoreSample,
  summariseCalibration,
  type CalibrationSample,
} from './testKit';

/** Any step that opens the microphone. */
const opensMic = (s: KitStep) =>
  (s.kind === 'route' && s.mic === 'open') || s.kind === 'route-blind' || s.kind === 'calibrate';

const sample = (say: string, heard: string[]): CalibrationSample => {
  const word = calibrationSchedule().find((w) => w.say === say)!;
  return { word, heard, confidence: null };
};

describe('test kit', () => {
  it('plays every never-opened baseline before any step that opens the mic', () => {
    for (const kit of Object.values(KITS)) {
      const firstOpen = kit.steps.findIndex(opensMic);
      expect(firstOpen).toBeGreaterThanOrEqual(0);
      const lastBaseline = kit.steps.map((s) => s.kind === 'route' && s.mic === 'never-opened').lastIndexOf(true);
      expect(lastBaseline).toBeLessThan(firstOpen);
    }
  });

  it('reloads only after the mic has been opened, so the fresh page measures something', () => {
    const steps = KITS.desk.steps;
    const reload = steps.findIndex((s) => s.kind === 'reload');
    const firstOpen = steps.findIndex(opensMic);
    expect(firstOpen).toBeGreaterThanOrEqual(0);
    expect(reload).toBeGreaterThan(firstOpen);
    expect(steps[reload + 1]).toMatchObject({ kind: 'route', mic: 'fresh-page' });
  });

  it('blinds the speaker check: each path equally often, in an order that varies', () => {
    const order = blindOrder(6);
    expect(order.filter((p) => p === 'element')).toHaveLength(3);
    expect(order.filter((p) => p === 'webaudio')).toHaveLength(3);
    const orders = new Set(Array.from({ length: 30 }, () => blindOrder(6).join(',')));
    expect(orders.size).toBeGreaterThan(1);
    expect(KITS.speaker.steps.some((s) => s.kind === 'route-blind')).toBe(true);
  });

  it('no longer asks about Call Audio Routing, which the 2026-10-05 run ruled out', () => {
    for (const kit of Object.values(KITS)) {
      expect(kit.steps.some((s) => s.id.includes('call-routing') || s.id.includes('car-routing'))).toBe(false);
    }
  });

  it('has unique step ids within each kit', () => {
    for (const kit of Object.values(KITS)) {
      const ids = kit.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('alternates one-word and two-word forms of the same command', () => {
    const s = calibrationSchedule(1);
    expect(s).toHaveLength(10);
    for (let i = 0; i < s.length; i += 2) {
      expect(s[i]!.form).toBe('one-word');
      expect(s[i + 1]!.form).toBe('two-word');
      expect(s[i]!.action).toBe(s[i + 1]!.action);
    }
  });

  it('scores through the drill matcher, and separates a wrong move from a non-command', () => {
    expect(scoreSample(sample('hit', ['hit'])).verdict).toBe('right');
    expect(scoreSample(sample('hit', ['Add'])).verdict).toBe('not-a-command');
    expect(scoreSample(sample('hit', ['stand'])).verdict).toBe('wrong-action');
    expect(scoreSample(sample('hit', [])).verdict).toBe('nothing-heard');
    expect(scoreSample(sample('hit', ['Add', 'hit'])).rescued).toBe(true);
  });

  it('summarises per form', () => {
    const s = summariseCalibration([
      sample('hit', ['hit']),
      sample('hit me', ['hit me']),
      sample('stand', ['Strength']),
      sample('stand pat', ['stand pat']),
    ]);
    expect(s.oneWord).toEqual({ right: 1, total: 2 });
    expect(s.twoWord).toEqual({ right: 2, total: 2 });
    expect(s.misheard).toEqual([{ said: 'stand', heard: 'Strength' }]);
  });

  it('resumes a recent run and refuses a stale or malformed one', () => {
    const now = 1_000_000_000;
    const ok = JSON.stringify({ kit: 'desk', stepIndex: 3, savedAt: now - 1000 });
    expect(parseProgress(ok, now)).toMatchObject({ kit: 'desk', stepIndex: 3 });
    expect(parseProgress(JSON.stringify({ kit: 'desk', stepIndex: 3, savedAt: now - KIT_RESUME_WINDOW_MS - 1 }), now)).toBeNull();
    expect(parseProgress(JSON.stringify({ kit: 'nope', stepIndex: 0, savedAt: now }), now)).toBeNull();
    expect(parseProgress(JSON.stringify({ kit: 'desk', stepIndex: 999, savedAt: now }), now)).toBeNull();
    expect(parseProgress('{', now)).toBeNull();
    expect(parseProgress(null, now)).toBeNull();
  });
});
