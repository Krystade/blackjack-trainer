import { describe, it, expect } from 'vitest';
import {
  fingerVerdict,
  phoneMicSummary,
  pickCarInput,
  pickPhoneInput,
  recogniseVerdict,
  routeVerdict,
  wheelArrived,
  type PhoneRun,
} from './phoneMic';
import {
  KITS,
  PHONE_CALL_STEP_ID,
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
  (s.kind === 'route' && s.mic === 'open') ||
  s.kind === 'route-blind' ||
  s.kind === 'calibrate' ||
  s.kind === 'phone-inputs';

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

describe('bt-phone-mic kit', () => {
  it('runs inputs, probe, finger, route, call question, recognise, wheel, summary in that order', () => {
    const kit = KITS['bt-phone-mic'];
    expect(kit.label).toBe('Bluetooth: phone mic?');
    expect(kit.steps.map((s) => s.kind)).toEqual([
      'phone-inputs',
      'phone-probe',
      'phone-finger',
      'phone-route',
      'instruction',
      'phone-recognise',
      'wheel-press',
      'phone-summary',
    ]);
    expect(kit.steps[4]!.id).toBe(PHONE_CALL_STEP_ID);
    expect(new Set(kit.steps.map((s) => s.id)).size).toBe(kit.steps.length);
  });

  it('picks the iPhone input by label and falls back to default', () => {
    const devs = [
      { deviceId: 'default', label: 'Default - TOYOTA Corolla' },
      { deviceId: 'a1', label: 'iPhone Microphone' },
      { deviceId: 'b2', label: 'TOYOTA Corolla' },
    ];
    const phone = pickPhoneInput(devs);
    expect(phone).toMatchObject({ deviceId: 'a1', matched: true });
    expect(pickCarInput(devs, phone)?.deviceId).toBe('b2');
    const none = pickPhoneInput([{ deviceId: 'default', label: 'Fake' }]);
    expect(none).toMatchObject({ deviceId: 'default', matched: false });
    expect(pickPhoneInput([])).toMatchObject({ deviceId: 'default', matched: false });
    expect(pickCarInput([{ deviceId: 'default', label: 'Fake' }], none)).toBeNull();
  });

  it('reads a big drop under the finger as the phone mic, none as not, silence as no signal', () => {
    expect(fingerVerdict(0.01, 0.1).verdict).toBe('phone-mic');
    expect(fingerVerdict(0.09, 0.1).verdict).toBe('not-phone-mic');
    expect(fingerVerdict(0.065, 0.1).verdict).toBe('unclear');
    expect(fingerVerdict(0, 0.0001).verdict).toBe('no-signal');
    expect(fingerVerdict(0.01, 0.1).db).toBeCloseTo(-20, 5);
  });

  it('takes the majority route answer', () => {
    const rows = (answers: string[]) => answers.map((answer, i) => ({ path: i % 2 ? 'webaudio' : 'element', answer }));
    expect(routeVerdict(rows(Array(6).fill('Car speakers')))).toBe('car-speakers');
    expect(routeVerdict(rows(['Earpiece', 'Earpiece', 'Earpiece', 'Earpiece', 'Car speakers', 'Car speakers']))).toBe('earpiece');
    expect(routeVerdict(rows(['Earpiece', 'Earpiece', 'Earpiece', 'Car speakers', 'Car speakers', 'Car speakers']))).toBe('mixed');
    expect(routeVerdict([])).toBe('none');
  });

  it('calls recognition phone-following only when covering collapses it', () => {
    expect(recogniseVerdict(0.1, 0.9)).toBe('follows-phone-mic');
    expect(recogniseVerdict(0.8, 0.9)).toBe('not-following');
    expect(recogniseVerdict(0.6, 0.9)).toBe('partial');
    expect(recogniseVerdict(0, 0.3)).toBe('inconclusive');
  });

  it('counts skip-forward as arrival, and nothing else', () => {
    expect(wheelArrived(['nexttrack'])).toBe(true);
    expect(wheelArrived(['pause', 'seekforward'])).toBe(true);
    expect(wheelArrived(['pause', 'previoustrack'])).toBe(false);
    expect(wheelArrived([])).toBe(false);
  });

  it('summarises a clean success as yes, and a call-mode car as no', () => {
    const good: PhoneRun = {
      phone: { deviceId: 'a1', label: 'iPhone Microphone', matched: true },
      inputCount: 2,
      phoneProbe: { verdict: 'wideband', highRatio: 0.2 },
      finger: { coveredRms: 0.005, openRms: 0.1 },
      route: Array(6).fill({ path: 'element', answer: 'Car speakers' }),
      recognise: { covered: 0.1, uncovered: 0.9 },
      wheel: { actions: ['nexttrack'] },
      answers: { [PHONE_CALL_STEP_ID]: 'No' },
    };
    const s = phoneMicSummary(good);
    expect(s.overall).toBe('yes');
    expect(s.lines.map((l) => l.verdict)).toEqual(['yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes']);

    const bad = phoneMicSummary({
      ...good,
      phoneProbe: { verdict: 'narrowband', highRatio: 0 },
      wheel: { actions: [] },
      answers: { [PHONE_CALL_STEP_ID]: 'Yes' },
    });
    expect(bad.overall).toBe('no');
    expect(phoneMicSummary({ answers: {} }).overall).toBe('unclear');
    expect(phoneMicSummary({ answers: {} }).lines.every((l) => l.verdict === 'skipped' || l.id === 'route')).toBe(true);
  });
});

describe('Words at speed', () => {
  it('asks Bluetooth on or off once, then runs only the word step', () => {
    const steps = KITS['words-at-speed'].steps;
    expect(steps.map((s) => s.kind)).toEqual(['instruction', 'calibrate']);
  });
});
