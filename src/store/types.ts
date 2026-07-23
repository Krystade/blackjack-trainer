import type { SpreadRow, SeatConfig } from '../engine/game';
import { DEFAULT_SPREAD } from '../engine/game';
import type { Category, MistakeClass } from '../engine/grade';
import type { DeviationId } from '../engine/deviations';
import type { RuleSet } from '../engine/ruleset';

export interface Settings {
  version: 1;
  feedbackMode: 'training' | 'test';
  betSpreadOn: boolean;
  spread: SpreadRow[];
  bankrollStart: number;
  countCheckEvery: number;
  penetration: number;
  countPeek: boolean;
  dealSpeedMs: number;
  drill: {
    flashCategory: 'all' | 'hard' | 'soft' | 'pairs';
    countGroup: 1 | 2 | 3;
    countIntervalMs: number;
    countLengthCards: number;
    countManual: boolean;
    quizIndex: DeviationId | 'all';
    // Starting per-card pace (ms) for the count drill's TIMED CHALLENGE
    // (speed-ramp) mode -- distinct from countIntervalMs, which paces the
    // ordinary constant-speed auto/eyes-free flash. The ramp decays from
    // this value toward a fixed floor (see drills/countSpeed.ts
    // rampIntervalMs/RAMP_FLOOR_MS) as the run progresses.
    countTimedStartMs: number;
    // "Mix in fakes" (operator request): 0-100 chance that a Deviation Quiz
    // draw is a DISTRACTOR item instead of a real index -- see
    // drills/deviationQuiz.ts drawQuizItem's `distractorPct` param. Default
    // 0 keeps quiz behavior unchanged out of the box; the UI only offers
    // 0/25/50 but any 0-100 value is valid.
    quizDistractorPct: number;
  };
  audio: AudioSettings;
}

/** Cycle-3: app-wide audio for eyes-free car use. Opt-in — enabled defaults to false. */
export interface AudioSettings {
  enabled: boolean;
  verbosity: 'off' | 'results' | 'full';
  rate: number; // 0.5 .. 3.0 -- applied to both live speechSynthesis and clip playbackRate
  voiceURI: string; // 'default' or a SpeechSynthesisVoice.voiceURI
  chimes: boolean;
  answerPauseMs: number; // 0..5000, the eyes-free self-check pause
  // Eyes-free ZonePad presentation: false (default) shows the five labeled
  // zones so the layout can be learned before it's used blind. true dims
  // the pad back to transparent-but-tappable, for genuine hands-on-wheel /
  // eyes-on-road driving use. Opt-in only — never the default.
  dimZones: boolean;
  // How much detail spoken cards carry. 'full' = "queen of hearts" (suit
  // included); 'rank' = "queen" (suit dropped, default — suit is irrelevant
  // to counting and roughly doubles every utterance); 'face' = 'rank' but
  // every ten-value card (10/J/Q/K) collapses to "ten", matching how a
  // Hi-Lo counter actually subvocalises (all four share the same -1 tag).
  cardDetail: 'full' | 'rank' | 'face';
  // Play pre-rendered neural-voice clips (public/clips/) instead of live
  // speechSynthesis whenever a segmentForClips cascade match exists for the
  // spoken text -- a whole-utterance clip, or several per-sentence/per-item
  // clips concatenated in sequence (see src/audio/clips.ts) -- falling back
  // to live TTS otherwise. Defaults to false: the operator has not yet
  // validated clip audio on their phone, so the shipped default keeps
  // today's live-TTS-only behavior unchanged; a Settings toggle opts in.
  useClips: boolean;
  // Which recorded voice's clips to use (an id from public/clips/index.json's
  // "voices" list). '' (default) means "use index.json's own `default`" --
  // most installs ship exactly one voice, so this is normally left alone;
  // the Settings clip-voice picker only renders once loadClipIndex() (see
  // src/audio/clips.ts) actually resolves more than a bare default.
  clipVoice: string;
}

export const DEFAULT_AUDIO: AudioSettings = {
  enabled: false,
  verbosity: 'results',
  rate: 1,
  voiceURI: 'default',
  chimes: true,
  answerPauseMs: 3000,
  dimZones: false,
  cardDetail: 'rank',
  useClips: false,
  clipVoice: '',
};

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  feedbackMode: 'training',
  betSpreadOn: false,
  spread: DEFAULT_SPREAD.map((row) => ({ ...row })),
  bankrollStart: 100,
  countCheckEvery: 5,
  penetration: 0.75,
  countPeek: true,
  dealSpeedMs: 300,
  drill: {
    flashCategory: 'all',
    countGroup: 1,
    countIntervalMs: 800,
    countLengthCards: 52,
    countManual: false,
    quizIndex: 'all',
    countTimedStartMs: 900,
    quizDistractorPct: 0,
  },
  audio: { ...DEFAULT_AUDIO },
};

/** A saved game profile: rules + ramp + bankroll config, selectable at the Home screen. */
export interface Profile {
  id: string;
  name: string;
  rules: RuleSet;
  penetration: number;
  spread: SpreadRow[];
  bankrollStart: number;
  unitDollars?: number;
  countCheckEvery: number;
  betSpreadOn: boolean;
  seats: SeatConfig;
  cvcx?: {
    score?: number;
    evPerHour?: number;
    riskOfRuin?: number;
    simNote?: string;
  };
}

export interface TallyRW {
  right: number;
  wrong: number;
}

export interface Stats {
  version: 1;
  categories: Record<Category, TallyRW>;
  perIndex: Partial<Record<DeviationId, TallyRW>>;
  mistakes: Record<MistakeClass, number>;
  countDrill: {
    history: { date: string; cards: number; intervalMs: number; correct: boolean }[];
  };
  // Cycle-4 (docs/research/2026-07-21-priority-list.md item 8): per-drill
  // speed & accuracy telemetry for the three drills that previously
  // recorded nothing. `date` is always written by the calling component via
  // `new Date().toISOString()` -- never computed inside a pure helper or
  // the store itself, so every pure drill-math module stays deterministic.
  trueCount: {
    history: {
      date: string;
      runningCount: number;
      decksRemaining: number;
      guess: number;
      correctTc: number;
      correct: boolean;
    }[];
  };
  deckEstimation: {
    history: { date: string; actualDecks: number; guess: number; errorDecks: number; correct: boolean }[];
  };
  timedCount: {
    history: {
      date: string;
      cards: number;
      elapsedMs: number;
      secondsPerDeck: number;
      tier: string;
      correct: boolean;
    }[];
  };
  sessions: {
    date: string;
    rounds: number;
    graded: number;
    correct: number;
    bankrollDelta: number;
    // Cycle-1 Task 13: which active profile the session was played under.
    // Optional — sessions persisted before this change won't have them.
    profileId?: string;
    profileName?: string;
  }[];
}

export const EMPTY_STATS: Stats = {
  version: 1,
  categories: {
    hard: { right: 0, wrong: 0 },
    soft: { right: 0, wrong: 0 },
    pairs: { right: 0, wrong: 0 },
    surrender: { right: 0, wrong: 0 },
    insurance: { right: 0, wrong: 0 },
    bet: { right: 0, wrong: 0 },
    countCheck: { right: 0, wrong: 0 },
  },
  perIndex: {},
  mistakes: {
    correct: 0,
    'basic-error': 0,
    'missed-deviation': 0,
    'phantom-deviation': 0,
    'wrong-anyway': 0,
  },
  countDrill: {
    history: [],
  },
  trueCount: {
    history: [],
  },
  deckEstimation: {
    history: [],
  },
  timedCount: {
    history: [],
  },
  sessions: [],
};
