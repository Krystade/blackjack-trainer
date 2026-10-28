/**
 * The Route kits (wave U): one short run per route -- phone only, car
 * Bluetooth, Bluetooth headset -- where each step answers one unknown from
 * docs/research/2026-10-26-audio-routes.md, and Jack answers by VOICE where the
 * sound came from, so the listening steps need no looking.
 *
 * Pure: step data, the spoken-answer matcher and the summary. The I/O is in
 * routeKitIO.ts and the screen pieces in ui/screens/RouteKitSteps.tsx.
 */
import type { DetectedRoute, HoldInput, RoutePref, RouteStrategy } from '../audio/audioRoute';

/** The answers, as tapped and as logged. Same words the older car kits used. */
export const ROUTE_ANSWERS = ['Car speakers', 'Phone loud speaker', 'Headset', 'Earpiece', 'Heard nothing'] as const;
export type RouteAnswer = (typeof ROUTE_ANSWERS)[number];

/**
 * The spoken lines, recorded as clips (scripts/spokenPhrases.ts). Neither
 * contains an answer word, so a late transcript of the app's own line can
 * never be taken as an answer; the intro that DOES name them is said before
 * any microphone in the kit has opened.
 */
export const ROUTE_LINES = {
  intro: 'After each line, say where you heard it. Car, phone, headset, earpiece, or nothing.',
  ask: 'Where did that come from?',
} as const;

/**
 * What a transcript means, or null. Whole words only, and the LAST answer word
 * wins, so "phone, no, car" is car -- the drill matcher's rule, for the same
 * reason (a change of mind mid-sentence).
 */
const WORDS: ReadonlyArray<[RegExp, RouteAnswer]> = [
  // Longest alternative first in each: a regex alternation takes the first
  // that fits, and "car speaker" must match whole, not as "car".
  [/\b(car speakers?|the car|stereo|dashboard|cars|card|car)\b/g, 'Car speakers'],
  [/\b(speaker ?phone|loud ?speaker|phones|phone|speaker|bottom|foam)\b/g, 'Phone loud speaker'],
  [/\b(headphones?|headsets?|air ?pods?|earbuds?|buds|ears)\b/g, 'Headset'],
  [/\b(earpiece|ear piece|ear peace|receiver|top|quiet)\b/g, 'Earpiece'],
  [/\b(didn'?t hear|did not hear|no sound|nothing|none|silent|silence)\b/g, 'Heard nothing'],
];

export function matchRouteAnswer(transcript: string): RouteAnswer | null {
  const t = transcript.toLowerCase();
  const hits: Array<{ start: number; end: number; answer: RouteAnswer }> = [];
  for (const [re, answer] of WORDS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) hits.push({ start: m.index, end: m.index + m[0].length, answer });
  }
  // A word inside a longer phrase belongs to the phrase: "speaker" in "car
  // speakers" is the car, not the phone.
  const whole = hits.filter(
    (h) => !hits.some((o) => o !== h && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start),
  );
  let best: (typeof whole)[number] | null = null;
  for (const h of whole) if (!best || h.start > best.start) best = h;
  return best?.answer ?? null;
}

/** The first of several readings that names an answer. */
export function matchRouteAlternatives(alternatives: readonly string[]): { answer: RouteAnswer | null; rank: number } {
  for (let i = 0; i < alternatives.length; i++) {
    const a = matchRouteAnswer(alternatives[i]!);
    if (a) return { answer: a, rank: i };
  }
  return { answer: null, rank: -1 };
}

/** How the trial's sound is made. 'element' plays an <audio>; with a sink plan it is pointed at it. */
export type TrialPath = 'element' | 'webaudio';
/** 'open': play while the recogniser listens. 'quiet-close': close it, stop every sound, wait, then play. */
export type TrialMic = 'open' | 'quiet-close';

export type RouteKitStep =
  | { kind: 'route-snapshot'; id: string; title: string; why: string }
  | {
      kind: 'route-voice';
      id: string;
      title: string;
      why: string;
      strategy: RouteStrategy;
      hold: HoldInput;
      path: TrialPath;
      mic: TrialMic;
    };

export type RouteKitId = 'route-phone' | 'route-car' | 'route-headset';

const SNAPSHOT: RouteKitStep = {
  kind: 'route-snapshot',
  id: 'snapshot',
  title: 'What the phone says is connected',
  why: 'Lists the microphones and outputs by name, and whether the phone lets the app pick an output. Then it says how to answer.',
};

const AUTO_WEBAUDIO: RouteKitStep = {
  kind: 'route-voice',
  id: 'auto-webaudio',
  title: 'As the drills play now',
  why: 'Mic on, Web Audio — what every voice drill does today. The baseline for the rest.',
  strategy: 'web-audio',
  hold: 'none',
  path: 'webaudio',
  mic: 'open',
};

const PR_WEBAUDIO: RouteKitStep = {
  kind: 'route-voice',
  id: 'pr-webaudio',
  title: 'Declared "play and record" first',
  why: 'The app tells the phone it will play and record BEFORE the mic opens, so nothing switches when it does.',
  strategy: 'play-and-record',
  hold: 'none',
  path: 'webaudio',
  mic: 'open',
};

const QUIET_CLOSE: RouteKitStep = {
  kind: 'route-voice',
  id: 'quiet-close',
  title: 'Mic off and everything silent first',
  why: 'Mic closed, every sound stopped for 2.5 seconds, then normal playback. Says whether going quiet gives the sound back.',
  strategy: 'web-audio',
  hold: 'none',
  path: 'element',
  mic: 'quiet-close',
};

export const ROUTE_KITS: Record<RouteKitId, { label: string; where: string; target: RouteAnswer; steps: readonly RouteKitStep[] }> = {
  'route-phone': {
    label: 'Route: phone only',
    where: 'Bluetooth OFF, ring switch on, phone in your hand. About 2 minutes, answered by voice.',
    target: 'Phone loud speaker',
    steps: [
      SNAPSHOT,
      AUTO_WEBAUDIO,
      {
        kind: 'route-voice',
        id: 'pr-element',
        title: 'Declared first, normal playback',
        why: 'Normal playback is what lands on the earpiece. Does declaring "play and record" before the mic opens move it to the loud speaker?',
        strategy: 'play-and-record',
        hold: 'none',
        path: 'element',
        mic: 'open',
      },
      {
        kind: 'route-voice',
        id: 'sink-element',
        title: 'Normal playback sent to the speaker',
        why: 'Points normal playback at the loud speaker by name, if the phone lists one. Skips itself if it does not.',
        strategy: 'speaker-sink',
        hold: 'none',
        path: 'element',
        mic: 'open',
      },
      QUIET_CLOSE,
    ],
  },
  'route-car': {
    label: 'Route: car Bluetooth',
    where: 'Parked, engine on, phone connected to the car. About 3 minutes, answered by voice.',
    target: 'Car speakers',
    steps: [
      SNAPSHOT,
      AUTO_WEBAUDIO,
      PR_WEBAUDIO,
      {
        kind: 'route-voice',
        id: 'hold-bt',
        title: 'Car mic held open',
        why: 'The app holds the car’s own microphone by name, which should pin the call route — and the sound — to the car.',
        strategy: 'web-audio',
        hold: 'bluetooth',
        path: 'webaudio',
        mic: 'open',
      },
      {
        kind: 'route-voice',
        id: 'hold-phone',
        title: 'Phone mic held open',
        why: 'The app holds the iPhone’s microphone instead. Where does the sound go then: the car, the phone, or the earpiece?',
        strategy: 'web-audio',
        hold: 'phone',
        path: 'webaudio',
        mic: 'open',
      },
      QUIET_CLOSE,
    ],
  },
  'route-headset': {
    label: 'Route: headset',
    where: 'AirPods or another headset connected and in your ears. About 3 minutes, answered by voice.',
    target: 'Headset',
    steps: [
      SNAPSHOT,
      AUTO_WEBAUDIO,
      PR_WEBAUDIO,
      {
        kind: 'route-voice',
        id: 'hold-phone',
        title: 'Phone mic held open',
        why: 'The app listens through the iPhone instead of the headset. Does the sound stay in the headset?',
        strategy: 'web-audio',
        hold: 'phone',
        path: 'webaudio',
        mic: 'open',
      },
      QUIET_CLOSE,
    ],
  },
};

export function isRouteKitId(id: string): id is RouteKitId {
  return id in ROUTE_KITS;
}

export interface RouteStepResult {
  step: string;
  answer: RouteAnswer | 'skipped';
  via: 'voice' | 'tap' | 'skip';
}

/**
 * One line per run. `hits` counts steps that reached the route's target;
 * `byStep` is what the design note's decision table reads.
 */
export function routeKitSummary(kit: RouteKitId, results: readonly RouteStepResult[]): {
  hits: number;
  answered: number;
  byVoice: number;
  byStep: string;
} {
  const target = ROUTE_KITS[kit].target;
  const answered = results.filter((r) => r.answer !== 'skipped');
  return {
    hits: answered.filter((r) => r.answer === target).length,
    answered: answered.length,
    byVoice: results.filter((r) => r.via === 'voice').length,
    byStep: results.map((r) => `${r.step}=${r.answer}`).join(' '),
  };
}

/** What the detected route reads as, in a few words. */
export function describeRoute(route: DetectedRoute): string {
  if (route.kind === 'unknown') return 'Not known until the mic has been used once.';
  if (route.kind === 'phone') return 'Phone only — no Bluetooth microphone listed.';
  const what = route.guess === 'headset' ? 'Headset' : 'Car';
  return `${what} — ${route.bluetooth?.label ?? 'Bluetooth'}.`;
}

/** The answer that would mean the test worked, for the route in use. */
export function expectedAnswer(pref: RoutePref, route: DetectedRoute): RouteAnswer {
  if (pref === 'phone' || route.kind !== 'bluetooth') return 'Phone loud speaker';
  return route.guess === 'headset' ? 'Headset' : 'Car speakers';
}
