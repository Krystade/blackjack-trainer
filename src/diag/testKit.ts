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

export type KitId = 'desk' | 'car-bt' | 'car-no-bt';

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
  | { kind: 'reload'; id: string; title: string; why: string }
  | { kind: 'spectrum'; id: string; title: string; why: string }
  | { kind: 'calibrate'; id: string; title: string; why: string }
  | { kind: 'record'; id: string; title: string; what: 'words' | 'noise'; seconds: number; why: string };

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

const RECORD_WORDS: KitStep = {
  kind: 'record',
  id: 'record-words',
  title: 'Record the words',
  what: 'words',
  seconds: 0,
  why: 'A recording of you saying every command here, for testing recognisers at the desk.',
};

export const KITS: Record<KitId, { label: string; where: string; steps: readonly KitStep[] }> = {
  desk: {
    label: 'At my desk',
    where: 'Phone only, Bluetooth OFF, quiet room. About 6 minutes.',
    steps: [
      ...routeSteps('desk', DESK_ROUTE),
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
        why: 'Answers the reload question. Compare it with the mic-open steps before the reload.',
      },
      {
        kind: 'instruction',
        id: 'desk-call-routing-on',
        title: 'Change one iPhone setting',
        body:
          'Open the iPhone Settings app → Accessibility → Touch → Call Audio Routing → choose Speaker. ' +
          'Then come back to this app.',
        answers: ['Done — set to Speaker', "Couldn't find it"],
        why: 'iOS may treat an open web mic like a phone call. This setting forces calls to the loud speaker.',
      },
      ...routeSteps('desk-car-routing', DESK_ROUTE, 'Call Audio Routing = Speaker').filter(
        (s) => s.kind === 'route' && s.mic === 'open',
      ),
      SPECTRUM,
      CALIBRATE,
      RECORD_WORDS,
    ],
  },
  'car-bt': {
    label: 'In the car — Bluetooth ON',
    where: 'Phone connected to the car as usual. Do the listening steps parked; the word steps can be done driving.',
    steps: [
      ...routeSteps('bt', CAR_ROUTE).filter((s) => s.kind === 'route' && s.path === 'element'),
      SPECTRUM,
      CALIBRATE,
      RECORD_WORDS,
      {
        kind: 'record',
        id: 'bt-record-noise',
        title: 'Record road noise',
        what: 'noise',
        seconds: 60,
        why: 'One minute of cabin noise at speed, to mix with the word recordings at the desk.',
      },
    ],
  },
  'car-no-bt': {
    label: 'In the car — Bluetooth OFF',
    where: 'Turn Bluetooth off on the phone first. Do the listening steps parked; the word steps can be done driving.',
    steps: [
      ...routeSteps('nobt', DESK_ROUTE).filter((s) => s.kind === 'route' && s.mic !== 'closed-after-open'),
      SPECTRUM,
      CALIBRATE,
      RECORD_WORDS,
      {
        kind: 'record',
        id: 'nobt-record-noise',
        title: 'Record road noise',
        what: 'noise',
        seconds: 60,
        why: 'One minute of cabin noise through the phone mic at speed.',
      },
    ],
  },
};

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
