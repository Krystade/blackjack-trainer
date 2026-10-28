import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Profile, Settings } from '../../../store/types';
import { loadStats, saveSettings } from '../../../store/persist';
import { strategyRulesFor } from '../../../store/profiles';
import { askedIndexSet } from '../../../drills/deviationQuiz';
import { launchSettings } from '../../drillLaunch';
import { segmentDef, type PlannedSegment } from '../../../guided/plan';
import {
  begin,
  current,
  endEarly,
  endsOnAnswer,
  finishSegment,
  addTally,
  pause,
  resume,
  summarize,
  verdictOnTick,
  withActiveMs,
  type GuidedSession,
  type GuidedSummary,
} from '../../../guided/session';
import { recordFinished, saveActive } from '../../../guided/store';
import { tallyDelta, tallySignature } from '../../../guided/tally';
import { setGuidedCommandHandler, type GuidedCommand } from '../../../guided/voiceCommands';
import {
  GUIDED_DONE,
  GUIDED_ENDED,
  GUIDED_NO_ANSWERS,
  GUIDED_PAUSED,
  GUIDED_SKIPPED,
  bestSentence,
  improvedSentence,
  percentSentence,
  resumeSentence,
  transitionLine,
} from '../../../guided/lines';
import { checkAchievementsNow, onStatsSaved } from '../../../habits/progressStore';
import { isAppSpeaking, speak } from '../../../audio/speech';
import { speechOptsFrom } from '../../../audio/speechOpts';
import { setEyesFreeOn } from '../../eyesFreeSession';
import { setVoiceOn, useVoiceToggle } from '../../voiceSession';
import { useVoiceControl } from '../../useVoiceControl';
import { useWheelCommand } from '../../useWheelCommand';
import { FlashcardsView } from '../drills/FlashcardsView';
import { SpeedDrillView } from '../drills/SpeedDrillView';
import { CountDrillView } from '../drills/CountDrillView';
import { TrueCountDrillView } from '../drills/TrueCountDrillView';
import { DeviationQuizView } from '../drills/DeviationQuizView';
import { BetSizingView } from '../drills/BetSizingView';
import { GuidedSummaryPanel } from './GuidedSummaryPanel';
import { formatClock, segmentProgressText } from './guidedFormat';
import './guidedSession.css';

/**
 * Wave L (lane v): the guided session. Each segment is an existing drill view,
 * mounted as it is, with this host around it: a strip naming the segment and
 * its progress, a transition between segments (spoken in Drive), a pause
 * screen, and the summary.
 *
 * Progress is counted from stats saves (habits/progressStore onStatsSaved), so
 * the drills report nothing to it and are graded, recorded and credited to the
 * daily goal exactly as when opened from the picker.
 */

/** Tap mode: how long the "Up next" card shows before the segment starts by itself. */
export const TAP_TRANSITION_MS = 2500;
/** Drive: the most a transition line may hold the segment (a line that never reports its end). */
const DRIVE_TRANSITION_CAP_MS = 12_000;
/** After the answer that ends a segment, let its verdict be said: at least this... */
const END_SETTLE_MIN_MS = 700;
/** ...and at most this, before the transition cuts in. */
const END_SETTLE_MAX_MS = 4000;

type IntroReason = 'first' | 'next' | 'skip' | 'resume';

export function GuidedSessionView({
  initial,
  settings,
  activeProfile,
  onSettingsChange,
  onHome,
  onAgain,
}: {
  initial: GuidedSession;
  settings: Settings;
  activeProfile: Profile;
  onSettingsChange: (settings: Settings) => void;
  onHome: () => void;
  /** The summary's "Again": a fresh session of the same length and mode. */
  onAgain: (prev: GuidedSession) => void;
}) {
  // A stored session reopens in its transition: whatever was running was
  // unmounted with the page, and the transition says where it picks up.
  const [session, setSessionState] = useState<GuidedSession>(() =>
    initial.phase === 'running' || initial.phase === 'paused' ? { ...initial, phase: initial.phase === 'paused' ? 'paused' : 'intro' } : initial,
  );
  const sessionRef = useRef(session);
  const setSession = (next: GuidedSession) => {
    sessionRef.current = next;
    setSessionState(next);
  };
  const introReason = useRef<IntroReason>(
    initial.phase === 'intro' && initial.index === 0 && initial.progress[0]!.answers === 0 && initial.progress[0]!.activeMs === 0 ? 'first' : 'resume',
  );
  // Time in the running segment: what earlier stretches banked, plus the
  // stretch running since `runningSince` (null when not running).
  const runningSince = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const endingRef = useRef(false);
  const audioRef = useRef(settings.audio);
  audioRef.current = settings.audio;
  const [summary, setSummary] = useState<GuidedSummary | null>(null);

  const activeMsNow = (s: GuidedSession = sessionRef.current, at = Date.now()): number => {
    const base = s.progress[s.index]?.activeMs ?? 0;
    return runningSince.current === null ? base : base + Math.max(0, at - runningSince.current);
  };
  /** Bank the running stretch into the session (before any phase change). */
  const banked = (s: GuidedSession = sessionRef.current): GuidedSession => {
    if (runningSince.current === null) return s;
    const ms = activeMsNow(s);
    runningSince.current = null;
    return withActiveMs(s, ms);
  };

  const say = (text: string, opts: { interrupt?: boolean; onEnd?: () => void } = {}) => {
    if (!sessionRef.current.drive) {
      opts.onEnd?.();
      return;
    }
    speak(text, { ...speechOptsFrom(audioRef.current, { interrupt: opts.interrupt ?? true }), ...(opts.onEnd ? { onEnd: opts.onEnd } : {}) });
  };

  // Eyes-free and voice as the session was started (a resumed session on a new page load too).
  useEffect(() => {
    setEyesFreeOn(initial.drive, 'guided');
    if (initial.drive) setVoiceOn(true, 'guided');
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------ moving the session on -- */

  const finishCurrent = (skipped: boolean) => {
    endingRef.current = false;
    const s = banked();
    introReason.current = skipped ? 'skip' : 'next';
    const next = finishSegment(s, skipped);
    setSession(next);
  };

  /** The segment has met its target: let the drill's verdict be said, then move on. */
  const endSoon = () => {
    if (endingRef.current || sessionRef.current.phase !== 'running') return;
    endingRef.current = true;
    const started = Date.now();
    const settle = () => {
      if (!endingRef.current) return;
      const waited = Date.now() - started;
      const drive = sessionRef.current.drive;
      if (waited < END_SETTLE_MIN_MS || (drive && isAppSpeaking() && waited < END_SETTLE_MAX_MS)) {
        window.setTimeout(settle, 150);
        return;
      }
      finishCurrent(false);
    };
    window.setTimeout(settle, 150);
  };

  const skip = () => {
    const s = sessionRef.current;
    if (s.phase === 'done') return;
    finishCurrent(true);
  };

  const pauseNow = (spoken = true) => {
    const s = sessionRef.current;
    if (s.phase !== 'running' && s.phase !== 'intro') return;
    endingRef.current = false;
    setSession(pause(banked(s)));
    if (spoken) say(GUIDED_PAUSED);
  };

  const resumeNow = () => {
    if (sessionRef.current.phase !== 'paused') return;
    introReason.current = 'resume';
    setSession(resume(sessionRef.current));
  };

  const endNow = () => {
    const s = sessionRef.current;
    if (s.phase === 'done') return;
    endingRef.current = false;
    setSession(endEarly(banked(s)));
  };

  // The microphone's commands (guided/voiceCommands.ts), taken while mounted.
  useEffect(() => {
    setGuidedCommandHandler((cmd: GuidedCommand) => {
      const phase = sessionRef.current.phase;
      if (phase === 'done') return false;
      if (cmd === 'resume') {
        if (phase !== 'paused') return false;
        window.setTimeout(resumeNow, 0);
        return true;
      }
      if (cmd === 'pause') {
        if (phase === 'paused') return false;
        window.setTimeout(() => pauseNow(), 0);
        return true;
      }
      if (cmd === 'skip') {
        window.setTimeout(skip, 0);
        return true;
      }
      window.setTimeout(endNow, 0);
      return true;
    });
    return () => setGuidedCommandHandler(null);
    // The handlers read the session through its ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Answers, from every stats save the running segment's drill makes.
  useEffect(() => {
    let sig = tallySignature(loadStats());
    return onStatsSaved((written, replaced, untrimmed) => {
      const before = sig;
      sig = tallySignature(written);
      if (replaced) return;
      const s = sessionRef.current;
      if (s.phase !== 'running') return;
      const t = tallyDelta(before, untrimmed);
      if (t.answers === 0 && t.right === 0) return;
      const next = addTally(s, t);
      setSession(next);
      // Each answer is a resume point: a reload or a killed tab keeps it.
      saveActive(withActiveMs(next, activeMsNow(next)));
      const seg = current(next);
      if (seg && endsOnAnswer(seg, next.progress[next.index]!, activeMsNow(next))) endSoon();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The clock: the strip's countdown, the caps, and a resume point every few seconds.
  useEffect(() => {
    if (session.phase !== 'running') return;
    runningSince.current = Date.now();
    let lastSaved = Date.now();
    const id = window.setInterval(() => {
      const at = Date.now();
      setNow(at);
      const s = sessionRef.current;
      const seg = current(s);
      if (!seg || endingRef.current) return;
      const verdict = verdictOnTick(seg, s.progress[s.index]!, activeMsNow(s, at));
      if (verdict === 'end') {
        finishCurrent(false);
        return;
      }
      if (verdict === 'idle') {
        pauseNow();
        return;
      }
      if (at - lastSaved >= 5000) {
        lastSaved = at;
        saveActive(withActiveMs(s, activeMsNow(s, at)));
      }
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
    // Per segment and per phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.phase, session.index]);

  // Every phase change is a resume point (and the end records the session).
  useEffect(() => {
    if (session.phase === 'done') {
      const store = recordFinished(session);
      setSummary(summarize(session, store.history.filter((h) => h.at !== session.startedAt)));
      checkAchievementsNow();
      return;
    }
    saveActive(session.phase === 'running' ? session : banked(session));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.phase, session.index]);

  // Left mid-session (a tab, Home): kept as a paused resume point.
  useEffect(
    () => () => {
      const s = sessionRef.current;
      if (s.phase !== 'done') saveActive({ ...banked(s), phase: 'paused' });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // The transition: said in Drive (the segment starts when the line ends), a
  // short card when tapping.
  useEffect(() => {
    if (session.phase !== 'intro') return;
    const seg = current(session);
    if (!seg) return;
    const def = segmentDef(seg.id);
    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      if (sessionRef.current.phase === 'intro') setSession(begin(sessionRef.current));
    };
    const reason = introReason.current;
    const line =
      reason === 'resume'
        ? resumeSentence(def)
        : `${reason === 'skip' ? `${GUIDED_SKIPPED} ` : ''}${transitionLine(def, seg.target, reason === 'first')}`;
    let timer: number;
    if (session.drive) {
      // The first line queues behind the protected "Guided session." said in the tap.
      say(line, { interrupt: reason !== 'first', onEnd: () => window.setTimeout(go, 300) });
      timer = window.setTimeout(go, DRIVE_TRANSITION_CAP_MS);
    } else {
      timer = window.setTimeout(go, TAP_TRANSITION_MS);
    }
    return () => {
      started = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.phase, session.index]);

  // The summary, said briefly in Drive.
  useEffect(() => {
    if (!summary || !session.drive) return;
    const parts = [session.outcome === 'ended' ? GUIDED_ENDED : GUIDED_DONE];
    if (summary.pct === null) parts.push(GUIDED_NO_ANSWERS);
    else {
      parts.push(percentSentence(summary.pct));
      if (summary.best) parts.push(bestSentence(segmentDef(summary.best)));
      if (summary.improved) parts.push(improvedSentence(segmentDef(summary.improved)));
    }
    say(parts.join(' '), { interrupt: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary]);

  /* ---------------------------------------------------------------- views -- */

  const seg = current(session);
  const total = session.plan.length;

  if (session.phase === 'done') {
    return (
      <GuidedSummaryPanel
        session={session}
        summary={summary ?? summarize(session, [])}
        onDone={onHome}
        onAgain={() => onAgain(session)}
      />
    );
  }
  if (!seg) return null;
  const def = segmentDef(seg.id);
  const prog = session.progress[session.index]!;

  if (session.phase === 'intro' || session.phase === 'paused') {
    const paused = session.phase === 'paused';
    return (
      <div className="guided-panel" data-testid={paused ? 'guided-paused' : 'guided-transition'} data-segment={seg.id}>
        <header className="guided-panel-head">
          <span className="guided-kicker">
            Guided session · {session.preset} min{session.drive ? ' · Drive' : ''}
          </span>
        </header>
        <SegmentRail session={session} />
        <section className="guided-up-next" aria-live="polite">
          <span className="guided-up-next-label">
            {paused ? 'Paused' : introReason.current === 'resume' ? 'Picking up' : introReason.current === 'first' ? 'First up' : 'Up next'}
          </span>
          <h1 className="guided-up-next-title">{def.label}</h1>
          <p className="guided-up-next-target">
            {segmentProgressText(seg, prog, prog.activeMs)} · segment {session.index + 1} of {total}
          </p>
          {!paused && !session.drive && <div className="guided-countdown" style={{ animationDuration: `${TAP_TRANSITION_MS}ms` }} />}
          {paused && session.drive && (
            <p className="guided-hint">Say “resume” or press the wheel to go on.</p>
          )}
        </section>
        <div className="guided-actions">
          {paused ? (
            <button type="button" className="u-btn u-btn-primary guided-main-btn" onClick={resumeNow}>
              Resume
            </button>
          ) : (
            <button type="button" className="u-btn u-btn-primary guided-main-btn" onClick={() => setSession(begin(sessionRef.current))}>
              Start now
            </button>
          )}
          <div className="guided-actions-row">
            <button type="button" className="u-btn guided-small-btn" onClick={skip}>
              Skip segment
            </button>
            {paused ? (
              <button type="button" className="u-btn guided-small-btn" onClick={endNow}>
                End session
              </button>
            ) : (
              <button type="button" className="u-btn guided-small-btn" onClick={() => pauseNow()}>
                Pause
              </button>
            )}
          </div>
        </div>
        {paused && session.drive && <PausedListener onResume={resumeNow} onRepeat={() => say(GUIDED_PAUSED)} />}
      </div>
    );
  }

  // Running: the strip over the segment's drill.
  const activeMs = runningSince.current === null ? prog.activeMs : prog.activeMs + Math.max(0, now - runningSince.current);
  const frac = Math.min(1, seg.target.kind === 'time' ? activeMs / seg.target.ms : prog.answers / seg.target.n);
  return (
    <div className="guided-host" data-testid="guided-running" data-segment={seg.id}>
      <div
        className="guided-strip"
        role="status"
        aria-label="Guided session"
        style={{ '--guided-frac': String(Math.max(0, frac)) } as CSSProperties}
      >
        <button type="button" className="guided-strip-btn" onClick={() => pauseNow()}>
          Pause
        </button>
        <div className="guided-strip-text">
          <span className="guided-strip-step">
            {session.index + 1}/{total}
          </span>
          <span className="guided-strip-name">{def.label}</span>
          <span className="guided-strip-progress" data-testid="guided-strip-progress">
            {seg.target.kind === 'time'
              ? formatClock(Math.max(0, seg.target.ms - activeMs))
              : `${prog.answers}/${seg.target.n}`}
          </span>
        </div>
        <button type="button" className="guided-strip-btn" onClick={skip}>
          Skip
        </button>
      </div>
      <SegmentDrill
        key={`${session.startedAt}:${session.index}`}
        seg={seg}
        drive={session.drive}
        settings={settings}
        activeProfile={activeProfile}
        onSettingsChange={onSettingsChange}
        onPause={() => pauseNow()}
        onReviewDone={endSoon}
      />
    </div>
  );
}

/** The six (or three) segments as a row of dots: done, skipped, current, to come. */
function SegmentRail({ session }: { session: GuidedSession }) {
  return (
    <ol className="guided-rail" aria-label="Segments">
      {session.plan.map((p, i) => {
        const pr = session.progress[i]!;
        const state = pr.skipped ? 'skipped' : pr.done ? 'done' : i === session.index ? 'current' : 'todo';
        return (
          <li key={p.id} className="guided-rail-item" data-state={state}>
            <span className="guided-rail-dot" aria-hidden="true" />
            <span className="guided-rail-label">{segmentDef(p.id).short}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Drive, paused: the microphone stays open for "resume" (claimed by the
 * guided commands) and "yes", and the wheel's forward button resumes.
 */
function PausedListener({ onResume, onRepeat }: { onResume: () => void; onRepeat: () => void }) {
  const [voiceOn] = useVoiceToggle('guided-paused');
  useWheelCommand((command) => (command === 'forward' ? onResume() : onRepeat()));
  useVoiceControl({
    enabled: voiceOn,
    onAction: (a) => {
      if (a === 'yes') onResume();
      else if (a === 'repeat') onRepeat();
    },
    // No cue: the pause line has just been said, and a tone after it would
    // read as a prompt to answer a question nobody asked.
    onListening: () => {},
    context: 'guided-paused',
  });
  return null;
}

/** Settings the segment's drill runs with, in memory only (never saved): see `keepOwn`. */
function segmentSettings(seg: PlannedSegment, drive: boolean, settings: Settings): Settings {
  if (seg.id === 'warmup' && (seg.cells?.length ?? 0) === 0) return launchSettings('flash', undefined, settings);
  if (seg.id === 'speed' && !drive) {
    const chart = launchSettings('flash', undefined, settings);
    // The user's shot clock when one is set; five seconds when it is off.
    return { ...chart, drill: { ...chart.drill, shotClockMs: settings.drill.shotClockMs > 0 ? settings.drill.shotClockMs : 5000 } };
  }
  return settings;
}

/**
 * A drill that saves a change while running on segment settings would save
 * the segment's deck and clock with it. Those fields are put back to the
 * user's own before anything reaches storage.
 */
function keepOwn(next: Settings, own: Settings): Settings {
  return {
    ...next,
    drill: {
      ...next.drill,
      deck: own.drill.deck,
      scopes: own.drill.scopes,
      flashCategory: own.drill.flashCategory,
      shotClockMs: own.drill.shotClockMs,
    },
  };
}

function SegmentDrill({
  seg,
  drive,
  settings,
  activeProfile,
  onSettingsChange,
  onPause,
  onReviewDone,
}: {
  seg: PlannedSegment;
  drive: boolean;
  settings: Settings;
  activeProfile: Profile;
  onSettingsChange: (s: Settings) => void;
  onPause: () => void;
  onReviewDone: () => void;
}): ReactNode {
  const run = segmentSettings(seg, drive, settings);
  const overridden = run !== settings;
  const change = overridden
    ? (next: Settings) => {
        const own = keepOwn(next, settings);
        saveSettings(own);
        onSettingsChange(own);
      }
    : onSettingsChange;
  const common = { settings: run, activeProfile, onBack: onPause, onSettingsChange: change };
  switch (seg.id) {
    case 'warmup':
      return (seg.cells?.length ?? 0) > 0 ? (
        <FlashcardsView {...common} handOver={{ ids: seg.cells!, source: 'review' }} onReviewDone={onReviewDone} />
      ) : (
        <FlashcardsView {...common} />
      );
    case 'speed':
      return drive ? <SpeedDrillView {...common} /> : <FlashcardsView {...common} />;
    case 'count':
      return <CountDrillView settings={run} autoStart onBack={onPause} onSettingsChange={change} />;
    case 'truecount':
      return <TrueCountDrillView {...common} autoStart />;
    case 'deviations': {
      const askable = new Set(askedIndexSet(strategyRulesFor(activeProfile)).map((d) => d.id as string));
      const ids = (seg.indexes ?? []).filter((id) => askable.has(id));
      return <DeviationQuizView {...common} reviewIds={ids.length > 0 ? ids : null} onReviewDone={onReviewDone} />;
    }
    case 'bets':
      return <BetSizingView {...common} />;
  }
}
