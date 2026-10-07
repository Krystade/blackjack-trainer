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

  it('the Bluetooth kit asks whether closing the mic gives the car back', () => {
    /*
     * THE ASSUMPTION THE WHOLE G2 PLAN RESTS ON, and it is contradicted.
     *
     * Nothing reached the car speakers on either path with a mic open
     * (2026-10-06, 0 of 6). The remaining idea is to hold the mic CLOSED while
     * the app speaks and open it only to listen -- which only works if closing
     * it gives the car route back.
     *
     *   - In the car, 2026-10-03, Jack's ears: it does NOT. Asked directly
     *     whether turning voice off restores the loud speaker, the answer was
     *     no, it stays stuck for the rest of the session. `micSessionCost.ts`
     *     is written around that finding.
     *   - At the desk, 2026-10-05: it DOES. "Mic closed again, both paths ->
     *     Loud speaker".
     *
     * One is the car and one is not, and the car kit had no step that asks,
     * because the never-opened baselines were dropped from it as settled --
     * these are not those. Until this is answered, building the mic-close
     * architecture would be building on a coin flip.
     */
    const ids = KITS['car-bt'].steps.map((s) => s.id);
    expect(ids).toContain('bt-closed-element');
    expect(ids).toContain('bt-closed-webaudio');

    // After the step that opens the microphone, or they measure nothing: a mic
    // that was never opened cannot have been closed again.
    const opensMicAt = KITS['car-bt'].steps.findIndex((s) => s.kind === 'route-blind');
    expect(opensMicAt).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf('bt-closed-element')).toBeGreaterThan(opensMicAt);

    // Asked with the car's own answers, so 'Car speakers' is sayable at all.
    for (const step of KITS['car-bt'].steps) {
      if (step.id.startsWith('bt-closed-') && 'answers' in step) {
        expect(step.answers).toContain('Car speakers');
      }
    }
  });

  it('asks for the words before the spectrum, because the words keep getting skipped', () => {
    /*
     * Jack skipped the word step on 2026-10-06 twice, and both times it was
     * LAST: once by abandoning the run, once by tapping skip. It is also the
     * scarcest measurement we have -- the only one that produces a recognition
     * number -- while the spectrum step is now nearly settled by the track rate
     * alone (`verdictFromTrackRate`), so it costs little to do second.
     *
     * The blind step stays first: it is what classifies the route state, and
     * every later step wants to be read against that state.
     */
    const ids = KITS['car-bt'].steps.map((s) => s.id);
    const blind = ids.indexOf('bt-blind-mic-open');
    const words = ids.indexOf('calibrate');
    const spectrum = ids.indexOf('mic-spectrum');
    expect(blind).toBe(0);
    expect(words).toBeGreaterThan(blind);
    expect(words, 'the word step must come before the spectrum step').toBeLessThan(spectrum);
  });

  it('every blind step scores against an answer it actually offers', () => {
    /*
     * THE CAR KIT SCORED 0 OF 3 WHATEVER JACK TAPPED.
     *
     * `BlindStep` counted `answer === 'Loud speaker'`, which is the DESK
     * answer set. The car kits offer 'Phone loud speaker' and 'Car speakers'
     * instead, so the comparison could never match and the summary read
     * "0 of 3 on the loud speaker" on both paths -- while the per-trial log
     * lines said five of six plays came out of the phone's loud speaker.
     * Jack's 2026-10-06 car-bt run is that log.
     *
     * The step now says what success is, because success is a property of the
     * question asked, not of the component that renders it. This asserts the
     * one thing that was false: the target is an answer the operator can
     * actually give.
     */
    const blind = Object.values(KITS)
      .flatMap((k) => k.steps)
      .filter(
        (s): s is Extract<KitStep, { kind: 'route-blind' | 'phone-route' }> =>
          s.kind === 'route-blind' || s.kind === 'phone-route',
      );
    expect(blind.length).toBeGreaterThan(0);
    for (const step of blind) {
      expect(step.answers, `${step.id} scores against ${step.target}, which it never offers`).toContain(
        step.target,
      );
    }
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
