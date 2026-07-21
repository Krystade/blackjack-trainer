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
  };
  audio: AudioSettings;
}

/** Cycle-3: app-wide audio for eyes-free car use. Opt-in — enabled defaults to false. */
export interface AudioSettings {
  enabled: boolean;
  verbosity: 'off' | 'results' | 'full';
  rate: number; // 0.7 .. 1.5
  voiceURI: string; // 'default' or a SpeechSynthesisVoice.voiceURI
  chimes: boolean;
  answerPauseMs: number; // 2000..5000, the eyes-free self-check pause
  // Eyes-free ZonePad presentation: false (default) shows the five labeled
  // zones so the layout can be learned before it's used blind. true dims
  // the pad back to transparent-but-tappable, for genuine hands-on-wheel /
  // eyes-on-road driving use. Opt-in only — never the default.
  dimZones: boolean;
}

export const DEFAULT_AUDIO: AudioSettings = {
  enabled: false,
  verbosity: 'results',
  rate: 1,
  voiceURI: 'default',
  chimes: true,
  answerPauseMs: 3000,
  dimZones: false,
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
  sessions: [],
};
