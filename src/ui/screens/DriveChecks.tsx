/**
 * Drive checks: the car verifications, run eyes-free from the field test.
 *
 * One button starts checks 1-8, which are spoken end to end and answered on
 * the wheel (forward yes, back no); 9 and 10 need the screen and run from a
 * separate "parked" button. Every check settles to one `test drive-check`
 * line (diag/driveChecks.ts), and the export gathers them into its
 * "drive-checks" block (diag/driveChecksReport.ts).
 *
 * The on-screen Yes / No / Skip buttons answer exactly what the wheel would,
 * so a check can be finished by a passenger, and so the suite can drive it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DC_LINES,
  DRIVE_CHECKS,
  DRIVE_CHECKS_CONTEXT,
  QUEUE_TTS_LINE,
  VOICE_TIMING_PROMPTS,
  COUNT_CHECKPOINT_AFTER,
  backPressesSince,
  countRunEvidence,
  countRunMechanicsOk,
  driveCountCards,
  driveTapEvidence,
  logDriveCheck,
  misheardEvidence,
  muteEvidence,
  newDriveChecksRunId,
  queueEvidence,
  runningCountOf,
  statusFromYes,
  summariseVoiceTiming,
  voiceTimingRows,
  voiceTimingStatus,
  voiceTimingFailWhy,
  pushToTalkWentLive,
  type CountRunFacts,
  type DriveCheckDef,
  type DriveCheckId,
  type DriveCheckStatus,
  type Evidence,
  type YesNo,
} from '../../diag/driveChecks';
import { diag, diagnosticSessionId, readDiagnosticLog } from '../../diag/diagnosticLog';
import { setWheelCommandHandler, type WheelCommand } from '../../audio/wheelCommands';
import {
  cancelSpeech,
  chime,
  chimeWhenQuiet,
  ensureMediaSessionHandlers,
  isAppSpeaking,
  speak,
  speakAsync,
} from '../../audio/speech';
import { speechOptsFrom } from '../../audio/speechOpts';
import { holdAudioFocus, releaseAudioFocus } from '../../audio/audioFocus';
import { requestWakeLock, releaseWakeLock } from '../../audio/wakeLock';
import { prewarmClips, setClipsEnabled, setClipVoice } from '../../audio/clips';
import { createWheelNumberEntry, type WheelNumberEntry } from '../../audio/wheelNumber';
import { looksLikeAnAttempt } from '../../audio/voiceRecognition';
import { looksLikeSelfEcho } from '../../audio/selfEcho';
import { narrateCard, narrateCountAnswer, narrateCountPrompt, narrateReadback } from '../../audio/narrate';
import { COUNT_PAUSED_LINE } from '../../drills/countPause';
import { drawSpeedQuestion, speedModeOf } from '../../drills/speedDrill';
import {
  narrateBetProposition,
  narrateBetVerdict,
  narrateSpeedPrompt,
  narrateYesNoVerdict,
  proposeBet,
} from '../../drills/wheelProposition';
import {
  correctBetAnswer,
  gradeBetSizing,
  makeBetSizingScenario,
  scenarioTc,
  trayFloorDecks,
} from '../../drills/betSizing';
import { mulberry32 } from '../../engine/cards';
import { getActiveProfile, strategyRulesFor } from '../../store/profiles';
import { saveSettings } from '../../store/persist';
import { handDeckFor } from './drills/handDeckFor';
import { useVoiceControl } from '../useVoiceControl';
import { endPushToTalk, isPushToTalkOpen, PUSH_TO_TALK_CAP_MS, startPushToTalk, usePushToTalk } from '../voiceSession';
import { VoiceStatusBar } from '../components/VoiceStatusBar';
import { CarStatusLine } from '../components/CarStatusLine';
import { WHEEL_TALK, carMic, carScore } from '../carStatus';
import type { Settings } from '../../store/types';
import './driveChecks.css';

type Answer = WheelCommand | 'skip';

interface ResultRow {
  id: DriveCheckId;
  status: DriveCheckStatus;
}

class Stopped extends Error {}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** How long a yes/no waits before asking once more, then counting as skipped. */
const ANSWER_WAIT_MS = 30_000;
/** After the microphone closes, the car needs a moment to hand the wheel back. */
const MIC_RELEASE_SETTLE_MS = 1_500;

function mark(check: DriveCheckId): { session: string; ms: number } {
  diag('test', 'drive-check-start', { check });
  const log = readDiagnosticLog();
  const last = [...log].reverse().find((e) => e.event === 'drive-check-start' && e.detail?.check === check);
  return { session: diagnosticSessionId, ms: last?.ms ?? 0 };
}

export function DriveChecks({
  settings,
  onSettingsChange,
  onBack,
}: {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onBack: () => void;
}) {
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [running, setRunning] = useState<null | 'drive' | 'parked' | DriveCheckId>(null);
  /** What a press would do right now: the suite and a passenger both read it. */
  const [waiting, setWaiting] = useState<null | 'answer' | 'entry'>(null);
  const [current, setCurrent] = useState<DriveCheckDef | null>(null);
  const [line, setLine] = useState<string>('');
  const [asking, setAsking] = useState(false);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [voiceOn, setVoiceOn] = useState(false);
  const [showMute, setShowMute] = useState(false);
  const [showStatusSample, setShowStatusSample] = useState(false);
  const pttOpen = usePushToTalk();

  const stoppedRef = useRef(false);
  /** The line last spoken, so its own echo is not taken as an answer arriving. */
  const lineRef = useRef('');
  const wheelWaiter = useRef<((a: Answer) => void) | null>(null);
  const voiceWaiter = useRef<((what: string) => void) | null>(null);
  const muteWaiter = useRef<(() => void) | null>(null);
  const entryRef = useRef<WheelNumberEntry | null>(null);
  const checkRef = useRef<DriveCheckId | null>(null);

  const set = useCallback(
    (next: Settings) => {
      saveSettings(next);
      onSettingsChange(next);
    },
    [onSettingsChange],
  );

  // The wheel: a number being entered takes the press, else whoever waits.
  useEffect(() => {
    ensureMediaSessionHandlers();
    setWheelCommandHandler((command) => {
      diag('test', 'drive-check-wheel', {
        command,
        check: checkRef.current ?? undefined,
        to: entryRef.current ? 'entry' : wheelWaiter.current ? 'answer' : 'nothing',
      });
      if (entryRef.current) {
        entryRef.current.press(command);
        return;
      }
      wheelWaiter.current?.(command);
    });
    return () => setWheelCommandHandler(null);
  }, []);

  // Audio up for the screen's life, as the field test does for a run.
  useEffect(() => {
    holdAudioFocus('speech');
    void requestWakeLock('drive-checks');
    return () => {
      stoppedRef.current = true;
      wheelWaiter.current?.('skip');
      entryRef.current?.reset();
      endPushToTalk('drive-checks-left');
      cancelSpeech();
      releaseWakeLock('drive-checks');
      releaseAudioFocus('speech');
    };
  }, []);

  const { status: voiceStatus } = useVoiceControl({
    enabled: voiceOn || pttOpen,
    context: DRIVE_CHECKS_CONTEXT,
    // These checks measure Auto; the Audio route setting must not change that.
    forceAutoRoute: true,
    onAction: (action) => voiceWaiter.current?.(`action:${action}`),
    onNotUnderstood: () => chime('again'),
    // The same "your turn" tone every drill gives; check 2 reads it back.
    onListening: () => chimeWhenQuiet('ready', { volume: settingsRef.current.audio.volume }),
    // Check 2 asks for mumbles, so every utterance there is an attempt.
    isAttempt: (heard) => (checkRef.current === 'misheard' ? true : looksLikeAnAttempt(heard)),
    escalation:
      checkRef.current === 'misheard'
        ? {
            promptKey: 'drive-check-misheard',
            reask: () => {
              diag('test', 'drive-check-reask', { said: DC_LINES.misheardPrompt });
              void sayRef.current(DC_LINES.misheardPrompt);
            },
          }
        : undefined,
  });
  // Check 8: the app's own Mute button (top right on every screen) pressed.
  useEffect(() => {
    if (!settings.audio.muted || !muteWaiter.current) return;
    diag('test', 'drive-check-muted', {});
    muteWaiter.current();
  }, [settings.audio.muted]);

  useEffect(() => {
    if (voiceStatus.heard === null || !voiceStatus.verdict) return;
    // A14: the app's own words, dropped, are not an answer arriving; letting
    // them end the wait let an echo stand in for the driver.
    if (voiceStatus.verdict === 'suppressed' && (voiceStatus.why === 'echo' || looksLikeSelfEcho(voiceStatus.heard, lineRef.current))) return;
    voiceWaiter.current?.(`heard:${voiceStatus.verdict}`);
  }, [voiceStatus]);

  /* ---------------- primitives ---------------- */

  const guard = () => {
    if (stoppedRef.current) throw new Stopped();
  };

  const say = async (text: string, opts?: { interrupt?: boolean; show?: boolean }): Promise<void> => {
    guard();
    // The yes/no reminder is not shown: the question stays on screen.
    if (opts?.show !== false) setLine(text);
    lineRef.current = text;
    await speakAsync(text, { ...speechOptsFrom(settingsRef.current.audio), interrupt: opts?.interrupt ?? false });
    guard();
  };
  const sayRef = useRef(say);
  sayRef.current = say;

  const waitWheel = (ms: number): Promise<Answer | null> =>
    new Promise((resolve) => {
      setWaiting('answer');
      const t = setTimeout(() => {
        wheelWaiter.current = null;
        setWaiting(null);
        resolve(null);
      }, ms);
      wheelWaiter.current = (a) => {
        clearTimeout(t);
        wheelWaiter.current = null;
        setWaiting(null);
        resolve(a);
      };
    });

  const waitVoice = (ms: number): Promise<string | null> =>
    new Promise((resolve) => {
      const t = setTimeout(() => {
        voiceWaiter.current = null;
        resolve(null);
      }, ms);
      voiceWaiter.current = (w) => {
        clearTimeout(t);
        voiceWaiter.current = null;
        resolve(w);
      };
    });

  /** Speak a question, take forward / back. Asked twice, then skipped. */
  const ask = async (question: string): Promise<YesNo> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await say(question);
      setAsking(true);
      const p = waitWheel(ANSWER_WAIT_MS);
      await say(DC_LINES.yesNo, { show: false }).catch(() => undefined);
      const a = await p;
      setAsking(false);
      guard();
      if (a === 'forward') return 'yes';
      if (a === 'back') return 'no';
      if (a === 'skip') return 'skip';
    }
    return 'skip';
  };

  /** A number on the wheel, from `origin`. Records the first press. */
  const enterNumber = (
    origin: number,
  ): Promise<{ value: number; first: number; dir: WheelCommand } | null> =>
    new Promise((resolve) => {
      let first: { value: number; dir: WheelCommand } | null = null;
      const giveUp = setTimeout(() => finish(null), ANSWER_WAIT_MS);
      const entry = createWheelNumberEntry<ReturnType<typeof setTimeout>>({
        schedule: (fn, ms) => setTimeout(fn, ms),
        cancel: (h) => clearTimeout(h),
        origin,
        readback: (v) =>
          speak(narrateReadback(v), { ...speechOptsFrom(settingsRef.current.audio), interrupt: true }),
        commit: (v) => finish(v),
      });
      setWaiting('entry');
      function finish(v: number | null) {
        clearTimeout(giveUp);
        entry.reset();
        entryRef.current = null;
        wheelWaiter.current = null;
        setWaiting(null);
        resolve(v === null || first === null ? null : { value: v, first: first.value, dir: first.dir });
      }
      entryRef.current = {
        press: (d) => {
          const v = entry.press(d);
          if (first === null) first = { value: v, dir: d };
          return v;
        },
        value: entry.value,
        reset: entry.reset,
      };
      // Stop resolves the waiter; route that to the entry too.
      wheelWaiter.current = (a) => {
        if (a === 'skip') finish(null);
      };
    });

  const settle = (def: DriveCheckDef, run: string, status: DriveCheckStatus, evidence: Evidence) => {
    logDriveCheck(run, def, status, evidence);
    setResults((prev) => [...prev.filter((r) => r.id !== def.id), { id: def.id, status }]);
  };

  /* ---------------- the checks ---------------- */

  const checks: Record<DriveCheckId, (def: DriveCheckDef, run: string) => Promise<void>> = {
    'voice-timing': async (def, run) => {
      const from = mark(def.id);
      await say(DC_LINES.voiceTimingIntro);
      setVoiceOn(true);
      let timeouts = 0;
      try {
        for (let i = 0; i < VOICE_TIMING_PROMPTS; i++) {
          await say(DC_LINES.voiceTimingPrompt);
          const got = await waitVoice(7_000);
          guard();
          if (got === null) timeouts += 1;
          await sleep(600);
        }
      } finally {
        setVoiceOn(false);
      }
      await sleep(MIC_RELEASE_SETTLE_MS);
      guard();
      const rows = voiceTimingRows(readDiagnosticLog(), from);
      const why = rows.length > 0 ? voiceTimingFailWhy(rows) : null;
      settle(def, run, voiceTimingStatus(rows), {
        prompts: VOICE_TIMING_PROMPTS,
        timeouts,
        ...summariseVoiceTiming(rows),
        ...(why ? { why } : {}),
      });
    },

    misheard: async (def, run) => {
      const from = mark(def.id);
      await say(DC_LINES.misheardIntro);
      setVoiceOn(true);
      try {
        await say(DC_LINES.misheardPrompt);
        const deadline = Date.now() + 30_000;
        const misses = () =>
          readDiagnosticLog().filter(
            (e) =>
              e.session === from.session &&
              e.ms >= from.ms &&
              e.event === 'misheard' &&
              e.detail?.context === DRIVE_CHECKS_CONTEXT,
          ).length;
        while (misses() < 2 && Date.now() < deadline) {
          await sleep(250);
          guard();
        }
        // The re-ask is spoken and its tone follows it.
        await sleep(4_000);
        guard();
      } finally {
        setVoiceOn(false);
      }
      await sleep(MIC_RELEASE_SETTLE_MS);
      const answer = await ask(DC_LINES.misheardQuestion);
      const ev = misheardEvidence(readDiagnosticLog(), from, DC_LINES.misheardPrompt);
      const status: DriveCheckStatus =
        ev.steps === '' && answer === 'skip'
          ? 'skipped'
          : answer === 'yes' && ev.sequenceOk
            ? 'pass'
            : answer === 'skip' && ev.sequenceOk
              ? 'skipped'
              : 'fail';
      settle(def, run, status, { answer, ...ev });
    },

    'talk-back': async (def, run) => {
      const before = settingsRef.current.drill.wheelMode;
      if (before !== 'talk') set({ ...settingsRef.current, drill: { ...settingsRef.current.drill, wheelMode: 'talk' } });
      try {
        await say(DC_LINES.talkBackIntro);
        const opened = await waitWheel(ANSWER_WAIT_MS);
        guard();
        if (opened !== 'forward') {
          settle(def, run, 'skipped', { wheelMode: 'talk', micOpened: false, press: opened ?? 'none' });
          return;
        }
        const pttFrom = mark(def.id);
        startPushToTalk(DRIVE_CHECKS_CONTEXT);
        const deadline = Date.now() + PUSH_TO_TALK_CAP_MS + 3_000;
        while (isPushToTalkOpen() && Date.now() < deadline) {
          await sleep(100);
          guard();
        }
        const closedAt = Date.now();
        // A13: from the log, not sampled: a word heard ends the window at once,
        // so a short live phase can open and close between two samples.
        if (!pushToTalkWentLive(readDiagnosticLog(), pttFrom)) {
          settle(def, run, 'fail', { wheelMode: 'talk', micOpened: false, why: 'mic-never-live' });
          return;
        }
        await sleep(MIC_RELEASE_SETTLE_MS);
        const from = mark(def.id);
        await say(DC_LINES.talkBackPress);
        const press = await waitWheel(10_000);
        guard();
        const reached = press === 'back';
        await say(reached ? DC_LINES.gotIt : DC_LINES.noPress);
        settle(def, run, press === 'skip' ? 'skipped' : reached ? 'pass' : 'fail', {
          wheelMode: 'talk',
          micOpened: true,
          press: press ?? 'none',
          reached,
          msAfterMicClose: reached ? Date.now() - closedAt : null,
          ...Object.fromEntries(
            Object.entries(backPressesSince(readDiagnosticLog(), from)).map(([k, v]) => [`back${k[0]!.toUpperCase()}${k.slice(1)}`, v]),
          ),
        });
      } finally {
        if (before !== 'talk') set({ ...settingsRef.current, drill: { ...settingsRef.current.drill, wheelMode: before } });
      }
    },

    'speech-queue': async (def, run) => {
      await say(DC_LINES.queueIntro);
      const from = mark(def.id);
      // Two lines, back to back, neither interrupting: the second must wait.
      await new Promise<void>((resolve) => {
        const opts = speechOptsFrom(settingsRef.current.audio);
        speak(COUNT_PAUSED_LINE, opts);
        speak(QUEUE_TTS_LINE, { ...opts, onEnd: resolve });
        setLine(`${COUNT_PAUSED_LINE} ${QUEUE_TTS_LINE}`);
      });
      guard();
      const answer = await ask(DC_LINES.queueQuestion);
      const ev = queueEvidence(readDiagnosticLog(), from, COUNT_PAUSED_LINE, QUEUE_TTS_LINE);
      // Yes means they DID overlap or cut off.
      const status: DriveCheckStatus =
        answer === 'skip' ? 'skipped' : answer === 'no' && ev.dropped !== true ? 'pass' : 'fail';
      settle(def, run, status, { overlapOrCut: answer, ...ev });
    },

    'wheel-speed': async (def, run) => {
      const profile = getActiveProfile();
      const s = settingsRef.current;
      const q = drawSpeedQuestion(speedModeOf(s.drill), handDeckFor(s.drill, profile), strategyRulesFor(profile), Date.now() >>> 0);
      if (!q) {
        settle(def, run, 'skipped', { why: 'nothing-to-ask-in-deck' });
        return;
      }
      await say(DC_LINES.speedIntro);
      const askedAt = Date.now();
      setAsking(true);
      const p = waitWheel(ANSWER_WAIT_MS);
      await say(narrateSpeedPrompt(q)).catch(() => undefined);
      const a = await p;
      setAsking(false);
      guard();
      if (a !== 'forward' && a !== 'back') {
        settle(def, run, 'skipped', { cell: q.cellId, mode: q.mode, press: a ?? 'none' });
        return;
      }
      const saidYes = a === 'forward';
      const correct = saidYes === q.answer;
      await say(narrateYesNoVerdict(correct, q.answer));
      const clear = await ask(DC_LINES.clearQuestion);
      settle(def, run, statusFromYes(clear), {
        cell: q.cellId,
        mode: q.mode,
        tc: q.tc,
        saidYes,
        correct,
        answerMs: Date.now() - askedAt,
        clear,
      });
    },

    'wheel-bet': async (def, run) => {
      const profile = getActiveProfile();
      const seed = Date.now() >>> 0;
      const scenario = makeBetSizingScenario(seed, profile.rules.decks, profile.spread, trayFloorDecks(profile), profile.wongExitTc);
      const tc = scenarioTc(scenario, profile.tcRounding);
      const prop = proposeBet(mulberry32(seed + 1), tc, profile);
      await say(DC_LINES.betIntro);
      setAsking(true);
      const p = waitWheel(ANSWER_WAIT_MS);
      await say(narrateBetProposition(scenario, prop.proposed)).catch(() => undefined);
      const a = await p;
      setAsking(false);
      guard();
      if (a !== 'forward' && a !== 'back') {
        settle(def, run, 'skipped', { tc, proposed: String(prop.proposed), press: a ?? 'none' });
        return;
      }
      const saidYes = a === 'forward';
      const ok = saidYes === gradeBetSizing(prop.proposed, tc, profile);
      await say(narrateBetVerdict(ok, correctBetAnswer(tc, profile.spread, profile.wongExitTc)));
      const clear = await ask(DC_LINES.clearQuestion);
      settle(def, run, statusFromYes(clear), { tc, proposed: String(prop.proposed), saidYes, correct: ok, clear });
    },

    'count-pause': async (def, run) => {
      const cards = driveCountCards(Date.now() >>> 0);
      await say(DC_LINES.countIntro);
      const facts: CountRunFacts = {
        checkpointAnswer: null,
        checkpointTruth: runningCountOf(cards.slice(0, COUNT_CHECKPOINT_AFTER)),
        paused: false,
        cardsWhilePaused: 0,
        resumedAt: null,
        expectedResumeAt: COUNT_CHECKPOINT_AFTER,
        finalFirstProposal: null,
        finalFirstDirection: null,
        finalAnswer: null,
        finalTruth: runningCountOf(cards),
      };
      const cardLines = new Set(cards.map((c) => narrateCard(c)));
      for (let i = 0; i < cards.length; i++) {
        if (i === COUNT_CHECKPOINT_AFTER) {
          await say(narrateCountPrompt());
          const cp = await enterNumber(0);
          guard();
          facts.checkpointAnswer = cp?.value ?? null;
          await say(DC_LINES.countPauseNow);
          const press = await waitWheel(15_000);
          guard();
          if (press === 'back') {
            facts.paused = true;
            diag('test', 'drive-check-count-paused', {});
            const pausedFrom = mark(def.id);
            await say(COUNT_PAUSED_LINE);
            await sleep(2_000);
            await say(DC_LINES.countResumeNow);
            await waitWheel(ANSWER_WAIT_MS);
            guard();
            // Anything that spoke a card while paused, from the log.
            facts.cardsWhilePaused = readDiagnosticLog().filter(
              (e) =>
                e.session === pausedFrom.session &&
                e.ms >= pausedFrom.ms &&
                e.category === 'speak' &&
                (e.event === 'path' || e.event === 'path-chosen') &&
                cardLines.has(String(e.detail?.said ?? '')),
            ).length;
            facts.resumedAt = i;
          }
        }
        await say(narrateCard(cards[i]!));
        await sleep(500);
      }
      await say(DC_LINES.countFinal);
      await say(narrateCountPrompt());
      const fin = await enterNumber(facts.checkpointAnswer ?? 0);
      guard();
      if (fin) {
        facts.finalFirstProposal = fin.first;
        facts.finalFirstDirection = fin.dir;
        facts.finalAnswer = fin.value;
      }
      await say(narrateCountAnswer(facts.finalTruth));
      const answer = await ask(DC_LINES.countQuestion);
      const mechanics = countRunMechanicsOk(facts);
      const status: DriveCheckStatus =
        facts.checkpointAnswer === null || fin === null
          ? 'skipped'
          : answer === 'yes' && mechanics
            ? 'pass'
            : answer === 'skip'
              ? 'skipped'
              : 'fail';
      settle(def, run, status, { answer, mechanics, ...countRunEvidence(facts) });
    },

    mute: async (def, run) => {
      await say(DC_LINES.muteIntro);
      setShowMute(true);
      const from = mark(def.id);
      let muted = false;
      let protectedSounding = false;
      const pressed = new Promise<void>((resolve) => {
        muteWaiter.current = () => {
          muted = true;
          muteWaiter.current = null;
          resolve();
        };
      });
      // A protected line (as Drive's opening line is) with an ordinary line
      // queued behind it, over and over until Mute is pressed.
      const loop = (async () => {
        const deadline = Date.now() + 90_000;
        while (!muted && !stoppedRef.current && Date.now() < deadline) {
          await new Promise<void>((resolve) => {
            const opts = speechOptsFrom(settingsRef.current.audio);
            protectedSounding = true;
            speak(DC_LINES.muteProtected, { ...opts, protect: true, onEnd: () => (protectedSounding = false) });
            speak(DC_LINES.muteQueued, { ...opts, onEnd: resolve });
          });
        }
      })();
      const timedOut = await Promise.race([pressed.then(() => false), loop.then(() => true)]);
      muteWaiter.current = null;
      if (timedOut || !muted) {
        setShowMute(false);
        settle(def, run, 'skipped', { pressed: false });
        return;
      }
      const protectedAtMute = protectedSounding;
      await sleep(500);
      const speakingAfterMs500 = isAppSpeaking();
      const log = readDiagnosticLog();
      const mutedAt = [...log].reverse().find((x) => x.event === 'drive-check-muted')?.ms ?? Infinity;
      const after = log.filter(
        (e) =>
          e.session === from.session &&
          e.ms > mutedAt &&
          e.category === 'speak' &&
          (e.event === 'path' || e.event === 'path-chosen'),
      ).length;
      const ev = muteEvidence(log, from, DC_LINES.muteQueued);
      // Sound back on for the question.
      set({ ...settingsRef.current, audio: { ...settingsRef.current.audio, muted: false } });
      setShowMute(false);
      await sleep(300);
      await say(DC_LINES.muteBack);
      const answer = await ask(DC_LINES.muteQuestion);
      const clean = !speakingAfterMs500 && after === 0;
      settle(def, run, answer === 'skip' ? 'skipped' : answer === 'yes' && clean ? 'pass' : 'fail', {
        pressed: true,
        protectedAtMute,
        speakingAfterMs500,
        linesStartedAfterMute: after,
        queuedSpoke: ev.queuedSpoke,
        queueDropped: ev.queueDropped,
        answer,
      });
    },

    'drive-button': async (def, run) => {
      const answer = await ask(DC_LINES.driveButtonQuestion);
      const ev = driveTapEvidence(readDiagnosticLog(), diagnosticSessionId);
      const logOk = ev.tapInLog === true && ev.speechMs !== null && ev.micMs !== null;
      settle(def, run, answer === 'skip' ? 'skipped' : answer === 'yes' && logOk ? 'pass' : 'fail', { answer, logOk, ...ev });
    },

    'status-line': async (def, run) => {
      setShowStatusSample(true);
      try {
        const answer = await ask(DC_LINES.statusLineQuestion);
        settle(def, run, statusFromYes(answer), { answer });
      } finally {
        setShowStatusSample(false);
      }
    },
  };

  /** Checks 1-8, checks 9-10, or one check on its own (a re-run after a skip). */
  const start = async (which: 'drive' | 'parked' | DriveCheckId) => {
    if (running) return;
    stoppedRef.current = false;
    setRunning(which);
    // The live check is drawn at the top; a Run tapped low in the list must not leave it scrolled away.
    try {
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch {
      /* a browser that will not scroll must still run the check */
    }
    const run = newDriveChecksRunId();
    const before = settingsRef.current;
    const tookAudio = !before.audio.enabled || before.audio.muted;
    if (tookAudio) {
      set({ ...before, audio: { ...before.audio, enabled: true, muted: false } });
    }
    setClipsEnabled(settingsRef.current.audio.useClips);
    setClipVoice(settingsRef.current.audio.clipVoice);
    diag('test', 'drive-checks-start', { run, which });
    try {
      if (settingsRef.current.audio.useClips) await prewarmClips();
      if (which === 'drive') await say(DC_LINES.intro, { interrupt: true });
      const todo = DRIVE_CHECKS.filter((d) =>
        which === 'drive' || which === 'parked' ? (which === 'parked') === (d.parked === true) : d.id === which,
      );
      for (const def of todo) {
        guard();
        setCurrent(def);
        checkRef.current = def.id;
        try {
          await checks[def.id](def, run);
        } catch (e) {
          if (e instanceof Stopped) throw e;
          diag('err', 'drive-check-threw', { check: def.id, error: e instanceof Error ? e.message : String(e) });
          settle(def, run, 'skipped', { why: 'threw' });
        }
      }
      if (which === 'drive') await say(DC_LINES.finished);
      diag('test', 'drive-checks-end', { run, which });
    } catch (e) {
      if (!(e instanceof Stopped)) throw e;
      diag('test', 'drive-checks-stopped', { run, at: checkRef.current ?? undefined });
    } finally {
      checkRef.current = null;
      setCurrent(null);
      setAsking(false);
      setWaiting(null);
      setVoiceOn(false);
      setShowMute(false);
      setShowStatusSample(false);
      // Audio given back as it was, if the run had to switch it on or unmute it.
      if (tookAudio) {
        set({
          ...settingsRef.current,
          audio: { ...settingsRef.current.audio, enabled: before.audio.enabled, muted: before.audio.muted },
        });
      }
      setRunning(null);
    }
  };

  const stop = () => {
    stoppedRef.current = true;
    wheelWaiter.current?.('skip');
    voiceWaiter.current?.('stopped');
    muteWaiter.current = null;
    entryRef.current?.reset();
    entryRef.current = null;
    endPushToTalk('drive-checks-stopped');
    cancelSpeech({ evenProtected: true });
  };

  const answerTap = (a: Answer) => {
    diag('test', 'drive-check-tap', { answer: a, check: checkRef.current ?? undefined });
    if (a === 'skip' && entryRef.current) {
      wheelWaiter.current?.('skip');
      return;
    }
    wheelWaiter.current?.(a);
  };

  const statusOf = (id: DriveCheckId) => results.find((r) => r.id === id)?.status;

  return (
    <div
      className="fieldtest-screen drive-checks"
      data-testid="drive-checks-screen"
      data-waiting={waiting ?? 'nothing'}
    >
      <header className="fieldtest-topbar">
        <button type="button" className="settings-back-btn" onClick={onBack} disabled={running !== null}>
          ← Field test
        </button>
        <h1 className="fieldtest-heading">Drive checks</h1>
      </header>

      <div className="fieldtest-body">
        {running === null ? (
          <>
            <p className="u-note">
              Start while stopped. Checks 1–8 are spoken: forward on the wheel is yes, back is no.
              Checks 9 and 10 need the screen — run them parked. Results go in the diagnostic log.
            </p>
            <button
              type="button"
              className="fieldtest-stamp fieldtest-good"
              data-testid="drive-checks-start"
              onClick={() => void start('drive')}
            >
              Start drive checks 1–8
            </button>
            <button
              type="button"
              className="fieldtest-stamp"
              data-testid="drive-checks-parked"
              onClick={() => void start('parked')}
            >
              Parked checks 9–10
            </button>
          </>
        ) : (
          <div className="dc-live" data-testid="drive-checks-live">
            <div className="dc-now" data-testid="drive-checks-current">
              {current ? `${current.n}. ${current.title}` : 'Starting…'}
            </div>
            <div className="dc-line" data-testid="drive-checks-line">
              {line}
            </div>
            {showStatusSample && (
              <div className="dc-sample" data-testid="drive-checks-status-sample">
                <CarStatusLine hand="Hard 16 v 10" wheel={WHEEL_TALK} mic={carMic('listening')} score={carScore(7, 9)} />
              </div>
            )}
            {showMute && (
              <div className="dc-mute" data-testid="drive-checks-mute">
                Press the app&rsquo;s Mute button now ↗
              </div>
            )}
            {(voiceOn || pttOpen) && <VoiceStatusBar status={voiceStatus} />}
            <div className="dc-answers">
              <button
                type="button"
                className="fieldtest-stamp fieldtest-good"
                data-testid="drive-checks-yes"
                disabled={!asking}
                onClick={() => answerTap('forward')}
              >
                Yes ▶
              </button>
              <button
                type="button"
                className="fieldtest-stamp"
                data-testid="drive-checks-no"
                disabled={!asking}
                onClick={() => answerTap('back')}
              >
                ◀ No
              </button>
            </div>
            <div className="dc-answers">
              <button type="button" className="fieldtest-stamp" data-testid="drive-checks-skip" onClick={() => answerTap('skip')}>
                Skip
              </button>
              <button type="button" className="fieldtest-stamp" data-testid="drive-checks-stop" onClick={stop}>
                Stop
              </button>
            </div>
          </div>
        )}

        <ol className="dc-list">
          {DRIVE_CHECKS.map((d) => {
            const s = statusOf(d.id);
            return (
              <li key={d.id} className="dc-item" data-testid={`drive-check-${d.id}`} data-status={s ?? 'pending'}>
                <span className="dc-n">{d.n}</span>
                <span className="dc-title">
                  {d.title}
                  {d.parked && <span className="dc-parked"> · parked</span>}
                </span>
                {running === null ? (
                  <button
                    type="button"
                    className={`dc-run dc-status-${s ?? 'pending'}`}
                    data-testid={`drive-check-run-${d.id}`}
                    aria-label={`Run check ${d.n}`}
                    onClick={() => void start(d.id)}
                  >
                    {s ?? 'Run'}
                  </button>
                ) : (
                  <span className={`dc-status dc-status-${s ?? 'pending'}`}>{s ?? '—'}</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
