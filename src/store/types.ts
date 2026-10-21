import type { SpreadRow, SeatConfig } from '../engine/game';
import { DEFAULT_SPREAD } from '../engine/game';
import type { EventSource, Category, MistakeClass } from '../engine/grade';
import type { DeviationId } from '../engine/deviations';
import type { RuleSet } from '../engine/ruleset';
import type { TcRounding } from '../engine/count';
import type { SpeedTier } from '../drills/countSpeed';
import type { DistractionMode, DistractionFreq } from '../drills/distraction';
import type { CheckpointFreq } from '../drills/countCheckpoints';
import type { CountDrillBias } from '../drills/countDrill';
import type { DepthResolution } from '../drills/depthResolution';

/** B2 (#9): one painted Custom-drill selection. Cells not in `tiers` are Off. */
export type SelectionTier = 'rare' | 'regular' | 'focus';
export interface CustomSelection {
  tiers: Record<string, SelectionTier>;
  /** Cells the operator painted by hand (Auto leaves these alone). */
  painted?: Record<string, true>;
  /** Share of the session per tier, in percent; defaults 60 / 30 / 10. */
  mix: { focus: number; regular: number; rare: number };
  favourMissed: boolean;
}
/** #31: marker colours. */
export type MarkerColour = 'red' | 'amber' | 'green' | 'blue';

export interface Settings {
  version: 1;
  feedbackMode: 'training' | 'test';
  // Selected colour theme, as a plain id string rather than a union imported
  // from the UI layer -- the store must not depend on src/ui. The UI narrows
  // it via normalizeTheme (src/ui/theme.ts), which also covers the case of a
  // stored id outliving the theme it names.
  theme: string;
  betSpreadOn: boolean;
  spread: SpreadRow[];
  bankrollStart: number;
  countCheckEvery: number;
  penetration: number;
  dealSpeedMs: number;
  // #48-51 (spec 2026-10-13): Play deals from the rigged losing shoe
  // (drills/downswingShoe.ts) instead of a fair one. Absent = off.
  losingShoe?: boolean;
  /**
   * F5 (W2-17): Play's dealer-pace clock, a thin countdown over each decision.
   * Absent = off. Expiry never plays the hand; it tags the decision slow.
   * `dealerPaceSec` is 2..8, absent = 4 (ui/dealerPace.ts). Forced off
   * eyes-free, where nobody is watching a bar.
   */
  dealerPaceOn?: boolean;
  dealerPaceSec?: number;
  /**
   * G2 (L-8): Play's dealer makes the occasional payout error, to be caught
   * with Foul (engine/dealerErrors.ts). Absent = off. Forced off eyes-free.
   */
  dealerMistakes?: boolean;
  /**
   * Wave I: how often the dealer errs. 'occasional' is about one round in 30
   * (G2's rate), 'training' about one in 5. Absent = read `dealerMistakes`
   * (true = 'occasional'), so a G2 save keeps its setting
   * (ui/dealerErrorCopy.ts, dealerMistakesSetting).
   */
  dealerMistakesMode?: 'off' | 'occasional' | 'training';
  // C-R3 (W10): the last drill run eyes-free or by voice, for Home's one-tap
  // "Drive" button. `mode` is the Drills mode id; `voice` whether the
  // microphone was on. Absent = no such drill yet (no Drive button).
  lastDrive?: { mode: string; voice: boolean };
  /**
   * Wave N: the daily goal (habits/progress.ts GOALS): easy 5 min / 30
   * answers, normal 10 / 60, hard 20 / 120. Absent = normal.
   */
  habits?: { goal?: 'easy' | 'normal' | 'hard' };
  drill: {
    flashCategory: 'all' | 'hard' | 'soft' | 'pairs';
    // #13: multi-select scope for the hand drills (flashcards, mastery, Mixed,
    // and later modes). Absent = derived from `flashCategory` ('all' = all
    // three). Never empty once written.
    scopes?: Array<'hard' | 'soft' | 'pairs'>;
    // B2 (#9 #23 #31): which cells the hand drills draw from. 'chart' (or
    // absent) = the scoped chart, 'custom' = the painted Custom selection,
    // 'indexes' = cells with a deviation index in the active rules, 'marked' =
    // cells carrying a marker.
    deck?: 'chart' | 'custom' | 'indexes' | 'marked';
    custom?: CustomSelection;
    // #31: a coloured dot per chart cell, set by long-pressing a card.
    markers?: Record<string, MarkerColour>;
    // #27: deal 3-card versions of double/surrender cells (~15%) so the
    // answer is the fallback (Dh -> hit, Ds -> stand, Rh/Rs/Rp). Absent = off.
    fallbacks?: boolean;
    // #53: flashcards show a true count and grade with correctPlay. Absent = off.
    withCount?: boolean;
    // #15/#19: the Speed drill's question. Absent = 'surrender'.
    speedMode?: 'surrender' | 'deviation' | 'double' | 'split';
    // #47: count drill "Table" mode -- whole rounds laid out like Play.
    // Absent = off; run length then counts rounds (countTableRounds, default 10).
    countTableMode?: boolean;
    countTableRounds?: number;
    // G1 (L-1): the count drill prints each flashed card's Hi-Lo value under
    // it, and opens the result's run listing. A beginner aid. Absent = off.
    countShowHiLo?: boolean;
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
    // B3: what the Deviation quiz asks -- the play at a shown count ('play'),
    // or the index itself for a shown hand ('index'). Absent = 'play'.
    quizAsk?: 'play' | 'index';
    // R2 (docs/BACKLOG.md, accuracy-gated difficulty): when true, the Timed
    // Challenge picks its starting pace from drills/competenceGate.ts's
    // computeUnlockedTier (the fastest tier the user has recently been
    // ACCURATE at) and caps the within-run ramp at that tier's pace, instead
    // of always ramping from `countTimedStartMs` on a fixed schedule
    // regardless of accuracy. Defaults to true -- the evidence-based
    // default per the training-science research (schedule-driven speed
    // pressure inflates in-drill scores without improving retained skill).
    // When false, Timed Challenge behaves exactly as it did before this
    // feature shipped (fixed `countTimedStartMs` ramp, unchanged).
    timedAdaptive: boolean;
    // D1 part 2 (docs/BACKLOG.md, distraction training): how often the
    // standard count drill's card stream gets interrupted by a distraction
    // (drills/distraction.ts's isDistractionPoint picks the concrete
    // cadence). 'off' is the default -- opt-in, so every existing test/e2e
    // and all default behavior is unchanged out of the box. Only meaningful
    // for the standard count drill's flashing phase (auto/eyes-free/manual);
    // Countdown mode and Timed Challenge runs never check this.
    distractionFreq: DistractionFreq;
    // Which kind of arithmetic a distraction poses (drills/distraction.ts's
    // DistractionMode) -- 'near-count' (confusable with the count itself,
    // the operator's key insight) or 'generic' (a table-talk simulacrum).
    // Defaults to 'near-count', the more realistic/harder mode.
    distractionMode: DistractionMode;
    // R8/CM#1 (docs/BACKLOG.md, adversarial shoe composition): deliberately
    // cluster same-sign Hi-Lo cards toward the front of the count drill's shoe
    // to force counting-through-zero / sign-reversal reps (see
    // drills/countDrill.ts makeCountDrill's `bias`). 'none' is the default --
    // opt-in, so default behavior and every existing test are unchanged. Only
    // the ORDINARY count drill applies it; Countdown mode builds its own shoe,
    // and Timed Challenge runs force 'none' so a biased shoe can't contaminate
    // the speed-tier grading (see CountDrillView).
    countBias: CountDrillBias;
    // RT#12 / RV9 (docs/BACKLOG.md): mid-run running-count checkpoints. The
    // drill graded ONE number at the end, so a +1 slip and a -1 slip in the
    // same run scored as a perfect count -- and a wrong run could not say
    // where the count was lost. A checkpoint pauses the flash, asks for the
    // count so far, records it silently and resumes; the result screen reads
    // the checkpoints back. 'off' by default (it is an interruption, and the
    // ordinary drill should stay the ordinary drill). Same scope as
    // distractions: the standard count drill only, never Countdown or a
    // Timed Challenge run.
    countCheckpoints: CheckpointFreq;
    // V5-1 (docs/BACKLOG.md): bias the next flashcard toward the cells most
    // easily confused with the one just answered. Brunmair & Richter's
    // interleaving meta-analysis finds the effect strongest when categories
    // are similar BETWEEN and dissimilar WITHIN, and only when confusable
    // items land in immediate succession -- which the SR/frequency draw,
    // being blind to what came before, achieves only by luck. Multiplies into
    // both existing terms rather than replacing them. Off by default: like
    // V4-1 it reallocates practice, which is the user's call.
    flashByConfusability: boolean;
    // V5-5 (docs/BACKLOG.md): how finely the discard tray is read, in the Deck
    // Estimation drill's answer grid and tolerance AND in the produce-TC band.
    // Half a deck everywhere ('half', the default and the app's historical
    // behaviour); half a deck except inside the last deck, where it tightens to
    // a quarter ('last-deck'); or a quarter everywhere ('quarter'). One setting
    // rather than a resolution plus a tighten-in-the-last-deck toggle, because
    // at quarter resolution that toggle has nothing left to tighten -- see
    // drills/depthResolution.ts.
    depthResolution: DepthResolution;
    // R9 / red-team #7 (docs/BACKLOG.md): "messy" card presentation — a small
    // seeded rotation/offset per card (drills/cardJitter.ts) so the visual-
    // recognition half of counting is trained, not just a robotically-aligned
    // stream. Applies to the visual counting/recognition drills (count-drill
    // flash + pair-cancellation). Default false — opt-in, all existing behavior
    // and tests unchanged.
    messyCards: boolean;
    // ET7 (docs/BACKLOG.md, experiential training): adversarial dealer-pace
    // pressure — sudden seeded speed-up bursts during the ordinary count-drill
    // flash that then recover (drills/pacePressure.ts). Default false — opt-in.
    // Only the ordinary auto-flash count drill applies it; Countdown and Timed
    // Challenge (which owns pacing) ignore it, same scoping as messyCards.
    pacePressure: boolean;
    // R1 (docs/BACKLOG.md, decision-latency telemetry + optional shot clock):
    // how long you get to answer a hand drill, in ms; 0 is off, which is the
    // default. Running out grades the card as a `timeout` mistake (its own
    // class -- see engine/grade.ts), not as a wrong play.
    //
    // Scoped to the two HAND drills (flashcards + deviation quiz) and nothing
    // else. The count drills already own their own pacing (countIntervalMs, the
    // Timed Challenge ramp), and layering a second clock over those would mean
    // two timers disagreeing about the same run.
    //
    // Defaults to 0 for the reason drills/shotClock.ts's header gives: speed
    // pressure applied before accuracy exists inflates in-drill scores without
    // improving retained skill.
    shotClockMs: number;
    /**
     * What the two steering-wheel buttons do in the car.
     *
     * 'answer': forward and back drive the drill directly -- start, plus one,
     * minus one, "I had it". No microphone is involved, so nothing can take
     * the wheel away mid-session: opening the mic flips the car to its
     * hands-free CALL route and every button goes to that call instead of to
     * this app.
     *
     * 'talk' (DEFAULT): forward OPENS THE MICROPHONE for a window and then
     * closes it again -- push to talk. Saying "plus four" is one gesture
     * where pressing it is four, and it is the only mode in which the five
     * plays can be SPOKEN while the wheel still exists between windows: with
     * the microphone merely left on, the car keeps the buttons for the call
     * and the wheel never comes back.
     *
     * It is the default because it is what the operator asked for as the car
     * mode (2026-10-01), and because the objection that stood against it has
     * been fixed: each window costs a round trip through HFP and back, and
     * the first press of a cold page used to be spent entirely on that round
     * trip (ui/voiceSession.ts). The window now starts when the microphone
     * does. What remains true is that the car's audio ducks on each window,
     * and that a mode is all two buttons can carry -- there is no third
     * gesture to hold both meanings.
     */
    wheelMode: 'answer' | 'talk';
  };
  audio: AudioSettings;
}

/** Cycle-3: app-wide audio for eyes-free car use. Opt-in — enabled defaults to false. */
export interface AudioSettings {
  enabled: boolean;
  verbosity: 'off' | 'results' | 'full';
  rate: number; // 0.5 .. 3.0 -- applied to both live speechSynthesis and clip playbackRate
  // Speaking volume, 0..2 (see audio/volume.ts for why the ceiling is 2 and
  // which paths can actually reach above 1), applied to live speechSynthesis,
  // clip playback AND
  // the chime tone, so one control takes the whole app up or down. Separate
  // from the device volume on purpose: eyes-free practice in a car competes
  // with road noise and music, and the phone's own volume is usually already
  // committed to something else. 0 is a legitimate value (silence) -- every
  // consumer must presence-check it rather than testing truthiness.
  volume: number;
  /**
   * Silence everything WITHOUT touching `volume` or `enabled`.
   *
   * `enabled: false` already silences the app, but it is not a mute: the
   * drills treat it as "audio is not available" and drop out of eyes-free
   * mode when it goes off, so using it as one changes the mode you are in.
   * And turning `volume` to 0 by hand loses the level you had chosen, which
   * then has to be found again by ear.
   *
   * The actual requirement (operator, 2026-09-16) is narrower than either:
   * "be able to use it in public without turning my sound all the way down
   * and being forced to have noise playing". So this is one flag, one
   * button, reversible, and it forgets nothing -- every audio path reads
   * `effectiveVolume()` rather than `volume`, and at 0 the whole app is
   * silent while every other setting stays exactly where it was.
   */
  muted: boolean;
  /**
   * Chime volume, 0..1: a multiplier on the alert tones' old level, applied on
   * top of `volume` (Wave M, "Chimes way too loud"). Optional so old saves
   * load; absent means DEFAULT_CHIME_LEVEL (audio/volume.ts, measured).
   */
  chimeVolume?: number;
  voiceURI: string; // 'default' or a SpeechSynthesisVoice.voiceURI
  answerPauseMs: number; // 0..5000, the eyes-free self-check pause
  // Eyes-free ZonePad presentation: false (default) shows the five labeled
  // zones so the layout can be learned before it's used blind. true dims
  // the pad back to transparent-but-tappable, for genuine hands-on-wheel /
  // eyes-on-road driving use. Opt-in only — never the default.
  dimZones: boolean;
  // Play pre-rendered neural-voice clips (public/clips/) instead of live
  // speechSynthesis whenever a segmentForClips cascade match exists for the
  // spoken text (see src/audio/clips.ts), falling back to live TTS for
  // anything unrecorded or any clip that fails to play.
  //
  // NOT A USER SETTING ANY MORE. Off was strictly worse: live speech opens no
  // media element, so the car never sees the app and no wheel button reaches
  // it (audio/carControls.ts), and a clip that fails already falls back on its
  // own. The field stays only because the field test switches it off for the
  // steps that measure live speech, and restores it after. `mergeSettings`
  // forces it back on at load, so a `false` saved under the old default (or
  // by a field test interrupted mid-step) cannot strand an install on it.
  useClips: boolean;
  // Which recorded voice's clips to use (an id from public/clips/index.json's
  // "voices" list). '' (default) means "use index.json's own `default`" --
  // most installs ship exactly one voice, so this is normally left alone;
  // the Settings clip-voice picker only renders once loadClipIndex() (see
  // src/audio/clips.ts) actually resolves more than a bare default.
  clipVoice: string;
  /**
   * Extra words the operator wants heard as commands, phrase -> action.
   *
   * Lives in settings rather than its own store so it is exported, backed up
   * and restored with everything else -- an alias table rebuilt from a drive's
   * worth of rejections is not something to lose to a reinstall.
   *
   * At most two words per phrase, enforced in audio/voiceAliases.ts: longer
   * and audio/selfEcho.ts can no longer tell the app's own prompt from a
   * command. See the note on ECHO_MIN_WORDS.
   */
  voiceAliases: Record<string, string>;
}

export const DEFAULT_AUDIO: AudioSettings = {
  /*
   * ON, which it was not.
   *
   * This app's purpose is drilling with the screen in a pocket, and both
   * halves of that are gated on this one flag -- nineteen controls grey out
   * behind it, "Eyes-free audio" among them. Shipping it off meant a fresh
   * install was silent, and silent is indistinguishable from broken when
   * nobody is looking at the screen. `audioGate.ts` exists only because of
   * how badly that landed.
   *
   * It was off because audio that starts talking unasked is rude on a desk.
   * That cost is a sound the operator did not expect, once; the cost of the
   * other default is a drive spent wondering why the app says nothing.
   * (Operator, 2026-10-02: make the settings I want the default.)
   */
  enabled: true,
  verbosity: 'results',
  rate: 1,
  volume: 1,
  muted: false,
  chimeVolume: 0.35,
  voiceURI: 'default',
  answerPauseMs: 3000,
  dimZones: false,
  voiceAliases: {},
  /*
   * ON, now that a real drive has played them.
   *
   * This shipped off because the clips had only ever run in the test harness,
   * which checks that every phrase RESOLVES to a clip and not that iOS will
   * play one unprompted. The 2026-09-30 drive settled that: fourteen played to
   * the end on the phone, in the car, over Bluetooth. The one that failed
   * failed because the microphone opened under it, which is fixed (8e526ae).
   *
   * Anything a clip cannot cover still falls back to live speech, so the worst
   * case of this default is the behaviour of the old one.
   */
  useClips: true,
  // '' means "whatever public/clips/index.json names as its default", which is
  // how a new voice becomes the default by shipping rather than by editing a
  // constant here. See clips.ts's `activeClipVoice`.
  clipVoice: '',
};

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  feedbackMode: 'training',
  theme: 'midnight-felt',
  betSpreadOn: false,
  spread: DEFAULT_SPREAD.map((row) => ({ ...row })),
  bankrollStart: 100,
  countCheckEvery: 5,
  penetration: 0.75,
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
    timedAdaptive: true,
    distractionFreq: 'off',
    distractionMode: 'near-count',
    countBias: 'none',
    countCheckpoints: 'off',
    flashByConfusability: false,
    depthResolution: 'half',
    messyCards: false,
    pacePressure: false,
    shotClockMs: 0,
    wheelMode: 'talk',
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
  /**
   * RT#11 (docs/BACKLOG.md): grade a bet correct when it lands on the
   * expected rung of the spread OR either neighbouring rung, instead of
   * demanding the exact number every round.
   *
   * Exact-conformity grading rewards, one green tick at a time, the single
   * behaviour surveillance is looking for -- a bet that is a visible function
   * of the count. This makes room for deliberate cover without the app
   * calling it an error. OPTIONAL, so profiles stored before this field load
   * untouched, and off by default: the tolerance is a judgment about how you
   * want to be graded, not a rule of the game.
   *
   * Lives on the profile rather than Settings because it is read through the
   * SPREAD, which lives here -- a tolerance means nothing apart from the ramp
   * it is a tolerance on.
   */
  coverBets?: boolean;
  /**
   * D-R1 (Wave D): the Wong exit point. Sitting out is graded right only at
   * true count <= this; playing is right anywhere above it, even where the
   * ramp bets its minimum. -5..0, absent = -2 (engine/wong.ts).
   */
  wongExitTc?: number;
  /**
   * Wave J, first cut: back-counting as a mode. Superseded by the In/Out
   * toggle; a stored `true` is read as `startShoeOut` (see `startShoeOutOf`).
   * Kept so stored profiles load untouched; never written by the app now.
   */
  backCount?: boolean;
  /**
   * Wave J toggle rework: "Start each shoe out". The table's In/Out toggle
   * turns Out as every fresh shoe starts. OPTIONAL, absent = the legacy
   * `backCount`, else off.
   */
  startShoeOut?: boolean;
  /**
   * Wave J: the back-count ENTRY point. Sitting in is graded right only at
   * true count >= this. 0..+5, absent = +1 (engine/wong.ts).
   */
  wongInTc?: number;
  /**
   * V5-4: how this counter's system resolves the leftover in a true-count
   * division. OPTIONAL so profiles stored before this field load untouched,
   * and absent means 'floor' -- the app's historical behaviour.
   *
   * On the profile and not the ruleset because it describes the PLAYER'S
   * system, not the casino's table. Floor and truncate agree on every
   * positive quotient and differ on every negative one, which is where a
   * good part of the Hi-Lo index set lives -- see engine/count.ts.
   */
  tcRounding?: TcRounding;
  /**
   * RV3: play the Fab 4 surrender indices instead of flat basic-strategy
   * surrender. OPTIONAL so profiles stored before this field load untouched,
   * and absent means off -- the app's historical behaviour.
   *
   * On the profile rather than Settings for the reason every grading surface
   * here lives on the profile: this changes what the app calls the CORRECT
   * play, and correctness is a property of the game you are sitting at, not of
   * the app's chrome. It also has to travel with the ruleset it was verified
   * against -- the index values differ between H17 and S17, and the S17 set is
   * four cells where H17 is six (engine/deviations.ts).
   *
   * Only meaningful when `rules.ls` is on: with late surrender off the dealer
   * never offers the play, `ctx.canSurrender` is false, and every index in the
   * set is unreachable. The Profile screen gates the control on that.
   */
  surrenderIndices?: boolean;
  /**
   * B9: play the opt-in BJA H17 extra indices (engine/deviations.ts
   * BJA_H17_EXTRAS) on top of the Illustrious 18. OPTIONAL so profiles stored
   * before this field load untouched, and absent means off.
   *
   * H17 only, and read ONLY through `strategyRulesFor` (which also gates it
   * on the table's soft-17 rule) -- no other caller checks the flag.
   */
  bjaExtras?: boolean;
  /**
   * Reveal the dealer's hole card even when no hand still needs a dealer
   * total. OPTIONAL so profiles stored before this field load untouched.
   *
   * A table rule rather than a preference, which is why it lives here: the
   * Table screen remounts on any profile CONTENT change, so toggling it takes
   * effect immediately. On Settings it would have been captured once by
   * useGame's config and gone stale mid-session -- the exact staleness that
   * file's own header warns about.
   */
  dealerAlwaysPlaysOut?: boolean;
  seats: SeatConfig;
  /**
   * #42: the Play bankroll carried between sessions. Absent = start from
   * `bankrollStart` (every profile stored before this shipped, and after
   * "Reset bankroll").
   */
  bankrollNow?: number;
  /**
   * #3: what a Play count check asks for. Absent = 'alternate' (running
   * count, then the true count on every second check -- the behaviour before
   * this field). `countCheckEvery` 0 still means no checks at all.
   */
  countCheckAsk?: 'running' | 'true' | 'alternate' | 'both';
  /**
   * #34: grade Play with count deviations (correctPlay) or basic strategy
   * only (basicPlay). Insurance follows it. Absent = true.
   */
  gradeDeviations?: boolean;
  /**
   * #39: the cut card, as decks left behind it (0.5-3, step 0.25), replacing
   * `penetration` as the setting. Absent = derived from `penetration`
   * (decks * (1 - penetration)) so stored profiles keep their depth.
   * `cutVary` moves each shoe's cut by up to ±0.5 decks.
   */
  cutDecks?: number;
  cutVary?: boolean;
  cvcx?: {
    score?: number;
    evPerHour?: number;
    riskOfRuin?: number;
    simNote?: string;
  };
  /** B8: deal Play from a Hot shoe (biased toward positive counts). Opt-in;
   * absent = off. */
  hotShoe?: boolean;
}

export interface TallyRW {
  right: number;
  wrong: number;
}

/**
 * E7 (W2-16): which way an index was missed.
 *
 * `late` is a missed deviation (the count reached the index and the chart play
 * was taken anyway); `early` is a phantom deviation (the index play taken
 * short of the index). Index-test misses, wrong-anyway plays and timeouts are
 * wrong with no direction, so they appear in neither.
 */
export interface IndexDirection {
  early: number;
  late: number;
  /**
   * The `early` misses `perIndex` never counted. A Play phantom stays graded
   * on its chart cell (F4/R9), so it names the index in `phantomOf` rather
   * than `deviationId` and is not in the index's right/wrong tally; the
   * Indexes table adds these to its wrong answers so accuracy and Early agree.
   * Absent = 0.
   */
  offTally?: number;
}

/**
 * Wave J: the per-category tallies. `wongIn` (the back-counter's watch or sit
 * in decision) is OPTIONAL: every blob, export and fixture written before it
 * lacks the key, and must load unchanged -- so `EMPTY_STATS` does not carry
 * it either (the merge would add it to every blob). Readers treat a missing
 * tally as zero; the first graded entry writes it.
 */
export type CategoryTallies = Record<Exclude<Category, 'wongIn'>, TallyRW> & Partial<Record<'wongIn', TallyRW>>;

export interface Stats {
  version: 1;
  categories: CategoryTallies;
  perIndex: Partial<Record<DeviationId, TallyRW>>;
  /**
   * The same tallies as `categories`, split by where the decision came from.
   *
   * OPTIONAL: blobs written before this existed simply lack it, and both the
   * reader and the writer must cope rather than migrate eagerly. `categories`
   * stays the pooled total so the existing sections are untouched.
   */
  bySource?: Partial<Record<EventSource, CategoryTallies>>;
  /**
   * Wave J: the back-count entry misses by direction -- `missed` watched
   * through a count at or above the entry point, `early` sat in below it.
   * Their right/wrong total is `categories.wongIn`. Play only. OPTIONAL:
   * absent = none recorded.
   */
  wongInMisses?: { missed: number; early: number };
  /**
   * Wave J: bets graded wrong on the HAND COUNT (a two-hand ramp row opened
   * with one hand, or the reverse). Each is also a wrong `categories.bet`:
   * this says how many of those misses were the hands. Play only. OPTIONAL:
   * absent = none recorded.
   */
  betHandsMisses?: number;
  /**
   * D-R2 (Wave D, #4): `perIndex` and `mistakes` for table (Play) decisions
   * only, so Stats > Play can show the table without the drills mixed in.
   * OPTIONAL: absent on blobs written before, which read as no table data.
   */
  tablePerIndex?: Partial<Record<DeviationId, TallyRW>>;
  tableMistakes?: Partial<Record<MistakeClass, number>>;
  /**
   * E7 (W2-16): per-index error direction, pooled across every source, and
   * the table's own slice of it (as `perIndex` / `tablePerIndex`). OPTIONAL:
   * absent on blobs written before, which read as no direction data.
   */
  indexDirection?: Partial<Record<DeviationId, IndexDirection>>;
  tableIndexDirection?: Partial<Record<DeviationId, IndexDirection>>;
  /**
   * V5-2 (docs/BACKLOG.md): hand-drill accuracy split by whether a shot clock
   * was running. OPTIONAL, so a blob written before this field loads
   * untouched, and events that never said (table play, older drill answers)
   * land in NEITHER bucket rather than being guessed into one.
   *
   * Two numbers because they answer different questions: `timed` is what you
   * can produce under pressure, `untimed` is what you know. Speed instruction
   * moves the first without moving the second (engine/grade.ts cites the
   * study), so a single pooled figure silently tracks the shotClockMs setting.
   */
  shotClockSplit?: { timed: TallyRW; untimed: TallyRW };
  mistakes: Record<MistakeClass, number>;
  // #22: answers withdrawn with "Wrong tap". The graded event itself is
  // removed; this counter keeps the habit visible. Absent = 0.
  misclicks?: number;
  // #28: whole-chart Mastery sweeps finished. The saved run alone forgets a
  // finished sweep as soon as the next one starts. Absent = 0.
  masterySweepsCompleted?: number;
  // B3 (spec 2026-10-13): per-cell accuracy, keyed by chart cellId, written
  // by every hand drill and Play. `lastAt` is an ISO date. Absent = no data.
  cellStats?: Record<
    string,
    {
      right: number;
      wrong: number;
      lastAt: string;
      // Wave A / W3: the cell's last CELL_WINDOW results (plus one spare so
      // Wrong tap undoes exactly, cellStats.ts WINDOW_SPARE), oldest first,
      // '1' right and '0' wrong. "Weak" is judged on this, not the lifetime
      // tally. Absent on cells written before it shipped.
      recent?: string;
    }
  >;
  countDrill: {
    history: {
      date: string;
      cards: number;
      intervalMs: number;
      correct: boolean;
      // RT#12: how many mid-run checkpoints this run answered correctly, and
      // how many it was asked. Both absent on a run with checkpoints off,
      // which is every run before the feature shipped -- so a missing pair
      // means "not measured", never "zero right".
      checkpointsCorrect?: number;
      checkpointsTotal?: number;
      // #20: a manual (self-paced) run has no deal interval, so `intervalMs`
      // is meaningless there. `manual` marks it; `meanTapMs` is the measured
      // mean gap between the operator's taps. Both absent on paced runs and
      // on every run recorded before the field shipped.
      manual?: boolean;
      meanTapMs?: number;
    }[];
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
      /**
       * What was typed. ABSENT for an eyes-free self-report, where the
       * operator says whether they had it and never states a number --
       * writing the right answer in here instead would report every
       * admitted miss as an exact hit in the too-high/too-low breakdown.
       */
      guess?: number;
      correctTc: number;
      correct: boolean;
    }[];
  };
  deckEstimation: {
    // V5-5: `toleranceDecks` records the slack the answer was graded against,
    // because that is now a setting and not a constant. Optional -- rows written
    // before V5-5 were all graded at half a deck, but saying so retroactively
    // would be inventing data. Same discipline as V5-2's shot-clock split: a
    // measurement whose rule changed is not the same measurement.
    history: {
      date: string;
      actualDecks: number;
      guess: number;
      errorDecks: number;
      correct: boolean;
      toleranceDecks?: number;
    }[];
  };
  timedCount: {
    history: {
      date: string;
      cards: number;
      elapsedMs: number;
      secondsPerDeck: number;
      tier: string;
      correct: boolean;
      // R2 (docs/BACKLOG.md, accuracy-gated difficulty): the tier this run
      // was PACED at (from drills/competenceGate.ts's computeUnlockedTier at
      // the moment the run started), as distinct from `tier` above (the
      // ACHIEVED tier, classified from the run's measured elapsed speed).
      // The gate reads this field (falling back to `tier` when absent) so
      // it judges the user's demonstrated pace, not a schedule-driven ramp's
      // incidental result. Optional -- entries persisted before this field
      // shipped simply lack it, no migration needed.
      attemptedTier?: SpeedTier;
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
    // R7 (docs/BACKLOG.md, count-peek accountability): how many times the RC/TC
    // peek button was activated during the session. Optional — sessions
    // persisted before R7 lack it (persist merges `sessions` by pass-through,
    // so no migration is needed), and a session with 0 peeks omits it too.
    peeks?: number;
    // Wave B, B6: player hands settled and units lost to priced mistakes, for
    // the per-100 figure. Absent on older rows, which the per-100 figure skips.
    hands?: number;
    mistakeUnits?: number;
    // Wave B, B8: present (true) only for a Hot shoe session, whose bankroll
    // was not carried. Absent on every other row.
    hotShoe?: true;
    // Wave B2, R1: one row per Play session, upserted by this id after every
    // settled round and finalised by End. Absent on rows written before B2,
    // which were only ever appended at End.
    id?: string;
    // Wave B2, R1: present (true) while the session has not been ended -- a
    // shoe left without End (an iOS eviction, a closed tab) stays provisional.
    provisional?: true;
    // Wave B2, R4: play decisions (action events) and how many were right, so
    // the ladder's "Play a shoe" is not passed on sit-outs and bets.
    plays?: number;
    playsCorrect?: number;
    // Wave B2, R3: bet and play-or-sit decisions graded wrong, counted beside
    // the per-100 figure (which prices play mistakes only).
    betMisses?: number;
    // G2 (L-8): dealer payout errors made this session, how many were caught
    // with Foul, and Foul calls on a correct payout. Present only on a session
    // that played with Dealer mistakes on; kept out of every accuracy figure.
    dealerErrors?: { made: number; caught: number; falseCalls: number };
    // Wave I: present (true) only when some round of the session was dealt
    // with Dealer mistakes on Training (about one error in five rounds). The
    // bankroll is still kept, missed errors and all.
    dealerMistakesTraining?: true;
  }[];
  // R1 (docs/BACKLOG.md, decision-latency telemetry): one entry per GRADED
  // EVENT that actually captured a decision time (flashcards + deviation
  // quiz today; table play doesn't set GradedEvent.elapsedMs yet, so its
  // events never land here -- see stats.ts's applyEvents). Deliberately flat
  // (not nested under a per-drill section) so a single medianLatency() call
  // filtered by `category` powers the per-category figure on the Stats
  // screen, right next to that category's existing accuracy -- flashcards
  // and the deviation quiz already share the same Category taxonomy there.
  // V3-5: `date` is the event's `at`, an ISO timestamp stamped by the calling
  // component. Optional and absent on every row written before V3-5, which is
  // exactly what filterByRange's undated rule already handles: kept on "all
  // time", dropped from a bounded range rather than silently counted inside it.
  latencyHistory: {
    category: Category;
    elapsedMs: number;
    date?: string;
    // Wave A (s10): whether the answer was right, so hand accuracy can answer
    // the Stats range picker. Absent on rows written before it shipped.
    correct?: boolean;
  }[];
  // D1 part 1 (docs/BACKLOG.md, distraction training): telemetry for the
  // mid-drill interruption generator (drills/distraction.ts). This part is
  // additive-only -- nothing writes to this history yet; part 2 wires the
  // generator into the count drill and populates it there.
  // `answerCorrect` grades the distraction's own arithmetic; `countKept`
  // grades whether the drill's final running count was still correct on a
  // run that contained distractions -- deliberately separate fields (see
  // drillStats.ts's distractionSummary) since a user can nail one and miss
  // the other. `elapsedMs` is optional, mirroring latencyHistory/timedCount,
  // for a run that doesn't capture timing.
  distraction: {
    history: {
      date: string;
      kind: DistractionMode;
      answerCorrect: boolean;
      countKept: boolean;
      elapsedMs?: number;
    }[];
  };
  // R8/TS#6 (docs/BACKLOG.md, pair-cancellation drill): one entry per graded
  // pair. `net` is the correct net Hi-Lo tag (-2..2), `guess` what the user
  // answered, `cancelling` whether it was a genuine cancel (a +1/-1 pair, the
  // canonical chunk). `date` is written by the calling component, never a pure
  // helper. Additive telemetry section — migration-safe (mergeStats backfills).
  pairCancel: {
    history: {
      date: string;
      net: number;
      guess: number;
      correct: boolean;
      cancelling: boolean;
      elapsedMs?: number;
    }[];
  };
  // RV4 (docs/BACKLOG.md; spec 2026-07-30-rv4-spaced-repetition): delayed-
  // retention telemetry. One entry per GAP REVIEW — a flashcard/deviation item
  // recalled after its spaced-repetition interval elapsed (box >= LEARNED_BOX),
  // i.e. a real retention test rather than massed same-session repetition. Lets
  // Stats show retained accuracy DISTINCT from raw in-drill accuracy. `key` is
  // the cellId/DeviationId, `box` the pre-review box, `gapMs` how long since the
  // item was last seen. `date` written by the calling component. Migration-safe.
  retention: {
    history: {
      date: string;
      key: string;
      box: number;
      gapMs: number;
      correct: boolean;
    }[];
  };
  // ET3 (docs/BACKLOG.md, experiential training): bet/sit/leave decision drill.
  // One row per graded scenario; `correctAction` is the consensus-correct choice
  // so Stats can show overall accuracy AND a per-action breakdown (the LEAVE
  // axis is the hard, novel one). Migration-safe.
  betSitLeave: {
    history: {
      date: string;
      taken: 'bet' | 'sit' | 'leave';
      correctAction: 'bet' | 'sit' | 'leave';
      correct: boolean;
    }[];
  };
  // Wave B B4 (contract 1): one row per Bet sizing answer. `taken`/`correct`
  // are units, or 'sit'. Optional: absent = no history (EMPTY_STATS unchanged).
  betSizing?: {
    history: {
      date: string;
      rc: number;
      decksRemaining: number;
      tc: number;
      taken: number | 'sit';
      correct: number | 'sit';
      ok: boolean;
      /**
       * C-R1: set on a row answered eyes-free from the wheel, where the app
       * PROPOSED a bet and the driver said yes (forward) or no (back). `taken`
       * is then the proposal; `ok` is whether the yes/no was right.
       */
      saidYes?: boolean;
    }[];
  };
  // ET1 (docs/BACKLOG.md, tilt-inoculation Downswing): one row per completed
  // session (V3-1 fix — the session used to persist nothing). `correct`/`total`
  // are the bets that matched the ramp; `drawdown` the units lost. Migration-safe.
  downswing: {
    history: {
      date: string;
      /** Bets that matched the ramp for the count, and bets graded. */
      correct: number;
      total: number;
      drawdown: number;
      /**
       * V3-7: the PLAY half of the same session -- decisions played correctly,
       * out of the decisions the rig actually dealt. Optional, because every
       * session recorded before V3-7 was a stand-only wall with no decisions in
       * it: a zero there would report perfect discipline as total failure, and a
       * hundred would invent a score nobody earned. Absent means "not measured".
       */
      playCorrect?: number;
      playTotal?: number;
    }[];
  };
  // V3-2 (docs/BACKLOG.md, produce-a-true-count drill): one row per graded round
  // (produced TC vs correct, within the by-eye tolerance). Migration-safe.
  produceTc: {
    history: {
      date: string;
      /**
       * What was produced. ABSENT for an eyes-free self-report, where the
       * operator says whether they had it and never states a number --
       * writing the right answer here instead would report every admitted
       * miss as an exact hit. Same rule, same reason, as `trueCount.guess`.
       */
      produced?: number;
      correctTc: number;
      correct: boolean;
    }[];
  };
  // V3-8 (docs/BACKLOG.md, "decision drills grade strictly binary"): what each
  // PRICED mistake cost, in units of the original bet.
  //
  // One row per GradedEvent carrying an `evCost` -- which engine/grade.ts
  // deliberately restricts to a plain `basic-error` on a hand decision. So this
  // history is NOT one row per mistake, and its length must never be read as a
  // mistake count: `mistakes` above is the count, this is the price of the
  // subset that can honestly be priced. Same reasoning as latencyHistory, where
  // an untimed event is absent rather than coerced to zero.
  //
  // `units` is always >= 0 (see handEv.ts's evCostBetween clamp) and may be
  // exactly 0 on the two or three cells where the hand-entered chart and the
  // infinite-deck arithmetic disagree by a rounding error -- a wrong answer that
  // genuinely cost nothing. Migration-safe.
  evCost: {
    history: {
      category: Category;
      /** The cell id or index label the event carried as `hand`. Optional for
       * the same reason GradedEvent.hand is: a producer that did not identify
       * the hand leaves it out rather than having one invented for it. */
      hand?: string;
      taken: string;
      expected: string;
      /** Units of the original bet, >= 0. */
      units: number;
      /** D-R2: where the decision was made. Absent on rows written before. */
      source?: EventSource;
      /** V3-5: the event's `at`, an ISO timestamp stamped by the calling
       * component. Optional and absent on every row written before V3-5 --
       * filterByRange keeps those on "all time" and drops them from a bounded
       * range, rather than counting an undated cost inside a window it may not
       * belong to. */
      date?: string;
    }[];
  };
  // Wave A / W3: the last HAND_WINDOW hand-decision results per hand type
  // (from cellStats' cell prefix; plus one spare, cellStats.ts WINDOW_SPARE),
  // oldest first, '1' right and '0' wrong.
  // Home's "Learn basic strategy" gate is judged on this window so mistakes
  // made while learning age out. Absent = none recorded since it shipped.
  handRecent?: { hard?: string; soft?: string; pair?: string };
  /**
   * F5 (W2-17): Play decision times, one row per timed table action event --
   * kept apart from `latencyHistory` so the drills' latency figures and the
   * hand accuracy windowed from it stay drill-only. `date` is the event's
   * `at`; `slow` marks a decision the dealer-pace clock ran out on. Absent =
   * no timed table decisions yet.
   */
  tableDecisions?: { history: { elapsedMs: number; date?: string; slow?: true }[] };
  /**
   * F10 (L-2): local calendar days ('YYYY-MM-DD') on which a graded answer or
   * Play round was recorded through applyEvents, newest last, capped
   * (store/practiceDays.ts). Answers whose own rows carry no date (an idle or
   * self-reported hand, an index-test answer) are only dated here. Absent on
   * blobs written before it shipped; the dated histories cover those days.
   */
  practiceDays?: string[];
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
    wong: { right: 0, wrong: 0 },
    // Wave J: no `wongIn` here, deliberately -- the merge would then add it to
    // every stored blob, and an old blob must load exactly as it was saved.
  },
  perIndex: {},
  mistakes: {
    correct: 0,
    'basic-error': 0,
    'missed-deviation': 0,
    'phantom-deviation': 0,
    'wrong-anyway': 0,
    timeout: 0,
    'self-report': 0,
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
  latencyHistory: [],
  distraction: {
    history: [],
  },
  pairCancel: {
    history: [],
  },
  retention: {
    history: [],
  },
  betSitLeave: {
    history: [],
  },
  downswing: {
    history: [],
  },
  produceTc: {
    history: [],
  },
  evCost: {
    history: [],
  },
};
