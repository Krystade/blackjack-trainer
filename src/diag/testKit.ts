/**
 * The test kit: one button per place, every open experiment that place can
 * answer, in the order that keeps each answer meaningful.
 *
 * Jack, 2026-10-05: "give me a button that i can press to test as many of these
 * as possible immediately without me doing much. have it split between ones we
 * can test now at my desk vs in the car with bluetooth vs in the car without
 * bluetooth."
 *
 * WHAT IS BEING ASKED, mapped to docs/TODO.md:
 *   - G1-a  does Web Audio output escape the earpiece when <audio> does not?
 *   - G1-b  does a page reload give the loud speaker back?
 *   - G1-e  does iOS "Call Audio Routing = Speaker" cover a web page's mic?
 *   - G2-a  which microphone is live, and is it narrowband (the car's HFP)?
 *   - G3-a  how often is each command word heard right, one-word vs two-word?
 *   - G3-e  raw recordings of the command words and of cabin noise, for the
 *           desk noise bench.
 *
 * ORDER IS PART OF THE MEASUREMENT. On iOS, "the microphone has never been
 * open in this page" and "it was open and is now shut" are different audio
 * states, and only the first has ever reliably used the loud speaker. So every
 * kit plays its never-opened baseline FIRST, and the reload step -- which
 * starts a fresh page -- comes after the mic has been opened at least once,
 * otherwise it would only re-measure the baseline.
 *
 * This file is pure: step data, the calibration schedule and the scoring. The
 * I/O lives in testKitIO.ts and the screen in ui/screens/TestKit.tsx.
 */

import { matchVoiceAction, type VoiceAction } from '../audio/voiceRecognition';

export type KitId = 'speaker' | 'desk' | 'car-bt' | 'car-no-bt' | 'bt-phone-mic' | 'words-at-speed';

/** How a sound is made. The two paths are routed by different parts of WebKit. */
export type PlayPath = 'element' | 'webaudio';

/** The microphone state while the sound plays. Order-dependent; see above. */
export type MicState = 'never-opened' | 'open' | 'closed-after-open' | 'fresh-page';

export type KitStep =
  | {
      kind: 'route';
      id: string;
      title: string;
      path: PlayPath;
      mic: MicState;
      answers: readonly string[];
      why: string;
    }
  | { kind: 'instruction'; id: string; title: string; body: string; answers: readonly string[]; why: string }
  | {
      kind: 'route-blind';
      id: string;
      title: string;
      trials: number;
      answers: readonly string[];
      /**
       * The answer that means the sound went where it was supposed to.
       *
       * HERE RATHER THAN IN THE COMPONENT, because it differs per kit and the
       * component had it hardcoded to the desk kit's 'Loud speaker'. The car
       * kits offer 'Car speakers' and 'Phone loud speaker', so the comparison
       * never matched and every car run summarised as `0 of 3` no matter what
       * Jack answered -- while its own per-trial log lines said five of six
       * plays came from the phone. A step that asks a question owns what
       * counts as the right answer to it.
       */
      target: string;
      why: string;
    }
  | { kind: 'reload'; id: string; title: string; why: string }
  | { kind: 'spectrum'; id: string; title: string; why: string }
  | { kind: 'calibrate'; id: string; title: string; why: string }
  | { kind: 'record'; id: string; title: string; what: 'words' | 'noise'; seconds: number; why: string }
  // The 'bt-phone-mic' kit. Each one runs against the phone input chosen in
  // its first step, held open across steps where the id says so.
  | { kind: 'phone-inputs'; id: string; title: string; why: string }
  | { kind: 'phone-probe'; id: string; title: string; why: string }
  | { kind: 'phone-finger'; id: string; title: string; why: string }
  | {
      kind: 'phone-route';
      id: string;
      title: string;
      trials: number;
      answers: readonly string[];
      /** As on `route-blind`: the answer that means it went where it should. */
      target: string;
      why: string;
    }
  | { kind: 'phone-recognise'; id: string; title: string; why: string }
  | { kind: 'wheel-press'; id: string; title: string; seconds: number; why: string }
  | { kind: 'phone-summary'; id: string; title: string; why: string };

const DESK_ROUTE = ['Loud speaker', 'Earpiece', 'Heard nothing', 'Not sure'] as const;
const CAR_ROUTE = ['Car speakers', 'Phone loud speaker', 'Earpiece', 'Heard nothing', 'Not sure'] as const;

function routeSteps(prefix: string, answers: readonly string[], tag = ''): KitStep[] {
  const t = tag ? ` (${tag})` : '';
  return [
    {
      kind: 'route',
      id: `${prefix}-baseline-element`,
      title: `Mic never opened — normal playback${t}`,
      path: 'element',
      mic: 'never-opened',
      answers,
      why: 'The control: where sound goes before this page has ever used the microphone.',
    },
    {
      kind: 'route',
      id: `${prefix}-baseline-webaudio`,
      title: `Mic never opened — Web Audio${t}`,
      path: 'webaudio',
      mic: 'never-opened',
      answers,
      why: 'Same sound through the other playback path, so the two can be compared.',
    },
    {
      kind: 'route',
      id: `${prefix}-open-element`,
      title: `Mic open — normal playback${t}`,
      path: 'element',
      mic: 'open',
      answers,
      why: 'The failing case today: this is where voice answers send sound to the earpiece.',
    },
    {
      kind: 'route',
      id: `${prefix}-open-webaudio`,
      title: `Mic open — Web Audio${t}`,
      path: 'webaudio',
      mic: 'open',
      answers,
      why: 'The untested path. If this one says loud speaker, the earpiece problem has a fix.',
    },
    {
      kind: 'route',
      id: `${prefix}-closed-element`,
      title: `Mic closed again — normal playback${t}`,
      path: 'element',
      mic: 'closed-after-open',
      answers,
      why: 'Whether shutting the mic gives the speaker back within this page.',
    },
    {
      kind: 'route',
      id: `${prefix}-closed-webaudio`,
      title: `Mic closed again — Web Audio${t}`,
      path: 'webaudio',
      mic: 'closed-after-open',
      answers,
      why: 'The same question for the other playback path.',
    },
  ];
}

/**
 * The same clip, mic open, played several times by the two paths in an order
 * the operator cannot see. One unblinded answer each is what the 2026-10-05
 * desk run had, and it said Web Audio reached the loud speaker while <audio>
 * did not -- worth building on only if it survives not knowing which is which.
 */
const BLIND: KitStep = {
  kind: 'route-blind',
  id: 'blind-mic-open',
  title: 'Mic on — where does each play come from?',
  trials: 6,
  answers: DESK_ROUTE,
  target: 'Loud speaker',
  why: 'Six plays with the microphone on, two different playback methods in a hidden random order. Answer each one by ear.',
};

const SPECTRUM: KitStep = {
  kind: 'spectrum',
  id: 'mic-spectrum',
  title: 'Which microphone, and how good',
  why: 'Measures every microphone the phone offers. A wall at 4kHz means a hands-free (call-quality) mic.',
};

const CALIBRATE: KitStep = {
  kind: 'calibrate',
  id: 'calibrate',
  title: 'Say each word',
  why: 'Scores how often each command is heard right — single words against the two-word forms.',
};

// Recording steps (kind 'record') are still supported by the screen but are
// in no kit: Jack passed on sending recordings (2026-10-05), and the quiet-room
// 10/10 made the desk noise bench less urgent. See docs/TODO.md G3-e.

/** The step that asks about the car's screen; its answer is read by the summary. */
export const PHONE_CALL_STEP_ID = 'phone-call-screen';

const PHONE_MIC_STEPS: readonly KitStep[] = [
  {
    kind: 'phone-inputs',
    id: 'phone-inputs',
    title: 'Which microphones are offered',
    why: 'Lists every input the phone names and picks the iPhone one by its label, with no choice needed from you.',
  },
  {
    kind: 'phone-probe',
    id: 'phone-probe',
    title: 'Does the phone input carry high frequencies',
    why: 'Energy above 4kHz cannot come through the car’s hands-free link, so finding it proves the phone’s own mic.',
  },
  {
    kind: 'phone-finger',
    id: 'phone-finger',
    title: 'Finger test',
    why: 'Covering the phone’s mic holes should silence a phone mic and change nothing for the car’s. The input stays open from here on.',
  },
  {
    kind: 'phone-route',
    id: 'phone-route',
    title: 'Where does the sound come out',
    trials: 6,
    answers: CAR_ROUTE,
    target: 'Car speakers',
    why: 'Six plays, two playback methods in a hidden order, while the phone input is held open.',
  },
  {
    kind: 'instruction',
    id: PHONE_CALL_STEP_ID,
    title: 'The car’s screen',
    body: 'Did the car’s screen show a phone call?',
    answers: ['Yes', 'No', 'Not sure'],
    why: 'A phone call on the car’s screen means the car has switched to call mode. The phone input is still open.',
  },
  {
    kind: 'phone-recognise',
    id: 'phone-recognise',
    title: 'Does recognition follow the phone mic',
    why: 'The ten command words twice, phone mic covered and then uncovered. If covering it breaks recognition, the recogniser is listening through it.',
  },
  {
    kind: 'wheel-press',
    id: 'phone-wheel',
    title: 'Steering wheel button',
    seconds: 8,
    why: 'In call mode the car keeps the wheel buttons for itself. If skip-forward arrives, it is not in call mode.',
  },
  {
    kind: 'phone-summary',
    id: 'phone-summary',
    title: 'What this says',
    why: 'Plain-language verdicts for each check. Every microphone is released when this opens.',
  },
];

export const KITS: Record<KitId, { label: string; where: string; steps: readonly KitStep[] }> = {
  speaker: {
    label: 'Speaker check',
    where: 'Ring switch ON (not silent). About 1 minute.',
    steps: [
      ...routeSteps('spk', DESK_ROUTE).filter((s) => s.kind === 'route' && s.mic === 'never-opened'),
      BLIND,
    ],
  },
  desk: {
    label: 'At my desk',
    where: 'Ring switch ON, quiet room. About 5 minutes.',
    steps: [
      ...routeSteps('desk', DESK_ROUTE).filter((s) => s.kind === 'route' && s.mic === 'never-opened'),
      BLIND,
      ...routeSteps('desk', DESK_ROUTE).filter((s) => s.kind === 'route' && s.mic === 'closed-after-open'),
      {
        kind: 'reload',
        id: 'desk-reload',
        title: 'Reload, then listen',
        why: 'Whether a fresh page gets the loud speaker back after the mic has been used.',
      },
      {
        kind: 'route',
        id: 'desk-fresh-element',
        title: 'Fresh page — normal playback',
        path: 'element',
        mic: 'fresh-page',
        answers: DESK_ROUTE,
        why: 'Answers the reload question. On 2026-10-05 this said earpiece, which needs a second reading.',
      },
      {
        kind: 'route',
        id: 'desk-fresh-webaudio',
        title: 'Fresh page — Web Audio',
        path: 'webaudio',
        mic: 'fresh-page',
        answers: DESK_ROUTE,
        why: 'The same question for Web Audio.',
      },
      SPECTRUM,
      CALIBRATE,
    ],
  },
  'car-bt': {
    label: 'In the car — Bluetooth ON',
    where: 'Phone connected to the car as usual. Do the listening step PARKED — judging the earpiece needs the phone at your ear. The word step can be done driving, and is the one worth finishing.',
    steps: [
      // The gate for G2 (roadmap 2026-10-05): drills now play through Web Audio
      // once the mic has opened, and nobody has yet heard that over Bluetooth.
      // Blind, both paths, mic on -- the never-opened baselines are settled.
      {
        ...BLIND,
        id: 'bt-blind-mic-open',
        title: 'Mic on, Bluetooth on — where does each play come from?',
        answers: CAR_ROUTE,
        // The car speakers are the whole point of this kit; the phone's own
        // loud speaker is a failure here even though it is a pass at the desk.
        target: 'Car speakers',
        why: 'Six plays with the mic on, two playback methods in a hidden order. The drills now use one of them; it has to reach the car speakers.',
      },
      /*
       * DOES CLOSING THE MIC GIVE THE CAR BACK? The question the whole
       * remaining G2 plan rests on, and the evidence is split:
       *
       *   - Car, 2026-10-03, Jack's ears: NO. Turning voice off did not restore
       *     the loud speaker; it stayed stuck for the rest of the session.
       *     `micSessionCost.ts` is written around that finding.
       *   - Desk, 2026-10-05: YES. "Mic closed again, both paths -> Loud
       *     speaker".
       *
       * One of those is the car and one is not. With nothing reaching the car
       * on either path while a mic is open (0 of 6, above), holding the mic
       * closed between prompts is what is left to try -- and it is worth
       * nothing if the route does not come back. These are NOT the
       * never-opened baselines that were dropped from this kit as settled.
       *
       * Placed after the blind step so the microphone has actually been opened;
       * a mic that was never opened cannot have been closed again.
       */
      ...routeSteps('bt', CAR_ROUTE).filter(
        (s) => s.kind === 'route' && s.mic === 'closed-after-open',
      ),
      /*
       * WORDS BEFORE SPECTRUM. Jack skipped the word step twice on 2026-10-06
       * and both times it was last -- once by abandoning the run, once by
       * tapping skip -- while it is the only step that produces a recognition
       * number. The spectrum step is now all but settled by the track rate
       * alone (`verdictFromTrackRate`), so it is the cheaper one to lose.
       */
      CALIBRATE,
      SPECTRUM,
    ],
  },
  'car-no-bt': {
    label: 'In the car — Bluetooth OFF',
    where: 'Turn Bluetooth off on the phone first. Do the listening step parked; the word step can be done driving.',
    steps: [
      { ...BLIND, id: 'nobt-blind-mic-open' },
      SPECTRUM,
      CALIBRATE,
    ],
  },
  'words-at-speed': {
    label: 'Words at speed',
    where: 'Driving. Start it while stopped; after the first tap it runs by ear, about 3 minutes.',
    steps: [
      {
        kind: 'instruction',
        id: 'speed-bluetooth',
        title: 'Bluetooth on or off?',
        body: 'Tap which, then start the words. Everything after this is spoken and needs no looking.',
        answers: ['Bluetooth on', 'Bluetooth off'],
        why: "The same twenty words mean something different through the car's call mic and the phone's own.",
      },
      { ...CALIBRATE, id: 'speed-calibrate' },
    ],
  },
  'bt-phone-mic': {
    label: 'Bluetooth: phone mic?',
    where: 'In the car, Bluetooth connected, parked with the engine running. About 3 minutes.',
    steps: PHONE_MIC_STEPS,
  },
};

/**
 * A hidden play order with each path used equally often. `random` is
 * injectable so the order is testable; the screen passes Math.random.
 */
export function blindOrder(trials: number, random: () => number = Math.random): PlayPath[] {
  const order: PlayPath[] = Array.from({ length: trials }, (_, i) => (i % 2 === 0 ? 'element' : 'webaudio'));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/* ------------------------------------------------------------------------ */
/* Calibration schedule and scoring                                          */
/* ------------------------------------------------------------------------ */

export interface CalibrationWord {
  /** What to say. */
  say: string;
  /** The command it should resolve to. */
  action: VoiceAction;
  form: 'one-word' | 'two-word';
}

/**
 * Pairs, single word first: "hit, hit me, stand, stand pat, ...". Easy to hold
 * in your head while driving, and each pair shares its road noise, so the
 * one-word vs two-word comparison is made within seconds rather than across
 * drives.
 */
const PAIRS: ReadonlyArray<[string, string, VoiceAction]> = [
  ['hit', 'hit me', 'hit'],
  ['stand', 'stand pat', 'stand'],
  ['double', 'double down', 'double'],
  ['split', 'split them', 'split'],
  ['surrender', 'surrender this', 'surrender'],
];

export const CALIBRATION_ROUNDS = 2;

export function calibrationSchedule(rounds = CALIBRATION_ROUNDS): CalibrationWord[] {
  const out: CalibrationWord[] = [];
  for (let r = 0; r < rounds; r++) {
    for (const [one, two, action] of PAIRS) {
      out.push({ say: one, action, form: 'one-word' });
      out.push({ say: two, action, form: 'two-word' });
    }
  }
  return out;
}

/**
 * The spoken lines of the word step, recorded as clips (scripts/spokenPhrases.ts
 * drillSentences) so they play through Web Audio -- the loud speaker or the car
 * -- rather than the phone's own voice, which can land on the earpiece once a
 * mic has opened. Jack, 2026-10-06: a retry shown only on screen is invisible
 * while driving, so "Again." is said out loud.
 */
export const CALIBRATION_INTRO = 'Say each word after the tick.';
export const CALIBRATION_RETRY = 'Again.';
export function calibrationOrderLine(): string {
  return `The order is: ${calibrationAnnouncement()}`;
}

/** The order spoken once at the start, before any microphone is opened. */
export function calibrationAnnouncement(): string {
  return PAIRS.map(([one, two]) => `${one}, ${two}`).join('. ') + '.';
}

export interface CalibrationSample {
  word: CalibrationWord;
  /** Every transcription offered, best first; empty if nothing came back. */
  heard: string[];
  confidence: number | null;
}

export type SampleVerdict = 'right' | 'wrong-action' | 'not-a-command' | 'nothing-heard';

/**
 * Scored through `matchVoiceAction`, the same entry the drill screens use, so
 * the number reported is what a drill would actually have done -- including
 * aliases Jack has taught. Only the top transcription counts; whether the
 * alternatives could have rescued it is reported separately.
 */
export function scoreSample(sample: CalibrationSample): { verdict: SampleVerdict; rescued: boolean } {
  const [top, ...rest] = sample.heard;
  if (top === undefined) return { verdict: 'nothing-heard', rescued: false };
  const got = matchVoiceAction(top);
  const rescued = got !== sample.word.action && rest.some((t) => matchVoiceAction(t) === sample.word.action);
  if (got === sample.word.action) return { verdict: 'right', rescued: false };
  return { verdict: got === null ? 'not-a-command' : 'wrong-action', rescued };
}

export interface CalibrationSummary {
  oneWord: { right: number; total: number };
  twoWord: { right: number; total: number };
  /** Dangerous: heard as a DIFFERENT command, which would play the wrong move. */
  wrongAction: number;
  rescuable: number;
  misheard: Array<{ said: string; heard: string }>;
}

export function summariseCalibration(samples: readonly CalibrationSample[]): CalibrationSummary {
  const s: CalibrationSummary = {
    oneWord: { right: 0, total: 0 },
    twoWord: { right: 0, total: 0 },
    wrongAction: 0,
    rescuable: 0,
    misheard: [],
  };
  for (const sample of samples) {
    const bucket = sample.word.form === 'one-word' ? s.oneWord : s.twoWord;
    const { verdict, rescued } = scoreSample(sample);
    bucket.total += 1;
    if (verdict === 'right') bucket.right += 1;
    else s.misheard.push({ said: sample.word.say, heard: sample.heard[0] ?? '(nothing)' });
    if (verdict === 'wrong-action') s.wrongAction += 1;
    if (rescued) s.rescuable += 1;
  }
  return s;
}

/* ------------------------------------------------------------------------ */
/* Progress that survives the reload step                                     */
/* ------------------------------------------------------------------------ */

export const KIT_PROGRESS_KEY = 'bjtrainer.testkit.progress.v1';
/** A run older than this is abandoned, not resumed. */
export const KIT_RESUME_WINDOW_MS = 10 * 60 * 1000;

export interface KitProgress {
  kit: KitId;
  stepIndex: number;
  savedAt: number;
}

export function parseProgress(raw: string | null, now: number): KitProgress | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<KitProgress>;
    if (typeof p.kit !== 'string' || !(p.kit in KITS)) return null;
    if (typeof p.stepIndex !== 'number' || typeof p.savedAt !== 'number') return null;
    if (now - p.savedAt > KIT_RESUME_WINDOW_MS) return null;
    if (p.stepIndex < 0 || p.stepIndex >= KITS[p.kit as KitId].steps.length) return null;
    return { kit: p.kit as KitId, stepIndex: p.stepIndex, savedAt: p.savedAt };
  } catch {
    return null;
  }
}
