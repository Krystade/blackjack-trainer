import { useEffect, useRef, useState } from 'react';
import type { Profile, Settings } from '../../../store/types';
import {
  makeProduceTcRound,
  gradeProducedTc,
  producedTcBand,
  produceTcSlack,
} from '../../../drills/produceTcDrill';
import type { ProduceTcRound } from '../../../drills/produceTcDrill';
import { PlayingCard } from '../../components/PlayingCard';
import { NumPad } from '../../components/NumPad';
import { useAudio } from '../../../audio/useAudio';
import { speak } from '../../../audio/speech';
import { speechOptsFrom } from '../../../audio/speechOpts';
import { requestWakeLock, releaseWakeLock } from '../../../audio/wakeLock';
import {
  narrateCards,
  narrateTc,
  narrateReadback,
  narrateDecksRemaining,
  capitalizeSpoken,
  NO_TRUE_COUNT_YET,
  DID_YOU_HAVE_IT,
  DECLINED_NEXT,
  SAY_YES_NEXT,
} from '../../../audio/narrate';
import { loadStats, saveStats } from '../../../store/persist';
import { enableAudioNow } from '../../audioGate';
import { useVoiceControl } from '../../useVoiceControl';
import { useWheelCommand } from '../../useWheelCommand';
import { useWheelNumber } from '../../useWheelNumber';
import { detectVoiceSupport, VOICE_ACTIONS } from '../../../audio/voiceRecognition';
import type { VoiceAction } from '../../../audio/voiceRecognition';
import { parseCountSpeech, speakableCount, COUNT_BIAS_PHRASES } from '../../../audio/voiceNumber';
import { VoiceStatusBar } from '../../components/VoiceStatusBar';
import { useVoiceToggle, usePushToTalk, startPushToTalk } from '../../voiceSession';
import {
  depthTolerance,
  formatDepthSlack,
  isLastDeckTightened,
} from '../../../drills/depthResolution';

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

function formatDecks(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * V3-2 (docs/BACKLOG.md, red-team v3): the "produce a true count" drill. Unlike
 * the true-count drill (which hands you RC + decks), here you MAINTAIN the count
 * as cards flash, ESTIMATE decks-remaining from a discard tray, and PRODUCE the
 * true count from the two — the real live-table composition.
 *
 * EYES-FREE CHANGES ONE OF THOSE THREE, and it has to. Judging a discard tray
 * is a visual act; there is no way to hear a tray. So the eyes-free version
 * STATES the depth ("two and a half decks remaining") after reading the cards
 * out, and what remains under test is the other two thirds: holding a running
 * count through a stream you cannot see, and converting it. That is still the
 * part that fails at a table, and it was previously the one voice drill you
 * could not run in a car — the gap the operator named on 2026-09-16.
 *
 * The depth tolerance goes with the tray. Eyes-on, the band exists because you
 * READ the tray and could be half a deck out; told the depth outright, there is
 * nothing to forgive, so the eyes-free path grades on the stated depth exactly
 * as the true-count drill does.
 */
/**
 * V4-3 (docs/BACKLOG.md): the shoe size comes from the ACTIVE PROFILE.
 *
 * It used to be a hardcoded 6 here AND separately in the drill module, while
 * the app happily runs 1-, 2-, 6- and 8-deck profiles. A double-deck player
 * was being drilled on 6-deck conversions: the divisor range they actually
 * face is 0.5-2, and every question they ever saw ran to 6.
 */
type Phase = 'setup' | 'flashing' | 'answering' | 'selfcheck' | 'selfreport' | 'result';

export function ProduceTcDrillView({
  settings,
  activeProfile,
  onBack,
  onSettingsChange,
}: {
  settings: Settings;
  activeProfile: Profile;
  onBack: () => void;
  // Needed so the eyes-free toggle can enable audio itself rather than sitting
  // disabled and pointing at another screen -- see ui/audioGate.ts.
  onSettingsChange: (settings: Settings) => void;
}) {
  const totalDecks = activeProfile.rules.decks;
  const audio = useAudio(settings.audio);
  const resolution = settings.drill.depthResolution;
  const [round, setRound] = useState<ProduceTcRound>(() =>
    makeProduceTcRound(
      settings.drill.countLengthCards,
      settings.drill.countGroup,
      randomSeed(),
      totalDecks,
      activeProfile.tcRounding,
    ),
  );

  const [phase, setPhaseState] = useState<Phase>('setup');
  /**
   * The phase, readable synchronously -- see the same ref in CountDrillView.
   * A steering-wheel press arrives from outside React, and two of them can
   * land in one tick.
   */
  const phaseRef = useRef<Phase>('setup');
  const wheelResetRef = useRef<() => void>(() => {});
  const setPhase = (next: Phase): void => {
    phaseRef.current = next;
    wheelResetRef.current();
    setPendingTc(null);
    setPhaseState(next);
  };

  const [shownIndex, setShownIndex] = useState(0);
  const [answer, setAnswer] = useState<{ produced: number; correct: boolean } | null>(null);
  const [honorCheck, setHonorCheck] = useState(false);
  const runIdRef = useRef(0);

  const [eyesFree, setEyesFree] = useState(false);
  const [strictMode, setStrictMode] = useState(false);
  const [voiceOn, setVoiceOn] = useVoiceToggle('produce-tc-drill');
  const pushToTalkOpen = usePushToTalk();
  const voiceSupport = detectVoiceSupport();

  /**
   * Nothing spoken is submitted directly: a number is a PROPOSAL, read back
   * and confirmed. Same contract as every other counting surface here.
   */
  const [pendingTc, setPendingTc] = useState<number | null>(null);

  const groups = round.round.groups;

  useEffect(() => {
    if (!settings.audio.enabled) setEyesFree(false);
  }, [settings.audio.enabled]);

  /** Say something, unconditionally -- eyes-free, a reply IS the output. */
  const sayBack = (text: string, interrupt = false) => {
    speak(text, speechOptsFrom(settings.audio, interrupt ? { interrupt: true } : {}));
  };

  const decksSentence = capitalizeSpoken(narrateDecksRemaining(round.decksRemaining));
  const narrateAnswer = (): string => `True count ${narrateTc(round.correctTc)}.`;

  // Flash the groups on the configured interval, then ask.
  useEffect(() => {
    if (phase !== 'flashing') return undefined;
    const runId = runIdRef.current;
    const isLast = shownIndex >= groups.length - 1;
    const t = setTimeout(() => {
      if (runIdRef.current !== runId) return;
      if (isLast) setPhase(eyesFree && !strictMode ? 'selfcheck' : 'answering');
      else setShownIndex((i) => i + 1);
    }, settings.drill.countIntervalMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, shownIndex, groups.length, settings.drill.countIntervalMs, eyesFree, strictMode]);

  // Read each group out. Eyes-free speaks regardless of verbosity and
  // interrupts, so a fast interval cuts the previous card off rather than
  // letting narration queue and fall behind the stream -- the count drill's
  // precedent, and the same reason.
  useEffect(() => {
    if (phase !== 'flashing') return;
    const g = groups[shownIndex];
    if (!g) return;
    if (eyesFree) {
      speak(
        narrateCards(g, settings.audio.cardDetail),
        speechOptsFrom(settings.audio, { interrupt: true }),
      );
    } else {
      audio.sayFull(narrateCards(g, settings.audio.cardDetail));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, shownIndex, groups, eyesFree]);

  // The depth, which cannot be seen with the eyes shut, stated on the way into
  // the answer.
  useEffect(() => {
    if (phase !== 'answering') return;
    if (eyesFree) sayBack(`${decksSentence}. Produce the true count.`, true);
    else audio.sayFull(`${decksSentence}. Produce the true count.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /**
   * The honour-system self-check: say the depth, wait, say the answer, ask.
   * No keypad and no guess recorded -- only whether it was had.
   */
  useEffect(() => {
    if (phase !== 'selfcheck') return undefined;
    const runId = runIdRef.current;
    sayBack(`${decksSentence}. Produce the true count.`, true);
    const t = setTimeout(() => {
      if (runIdRef.current !== runId) return;
      sayBack(narrateAnswer());
      sayBack(DID_YOU_HAVE_IT);
      setHonorCheck(true);
      setPhase('selfreport');
    }, settings.audio.answerPauseMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase === 'result') void releaseWakeLock();
  }, [phase]);

  useEffect(() => {
    return () => {
      void releaseWakeLock();
    };
  }, []);

  const recordResult = (produced: number | null, correct: boolean): void => {
    const stats = loadStats();
    saveStats({
      ...stats,
      produceTc: {
        history: [
          ...stats.produceTc.history,
          {
            date: new Date().toISOString(),
            // A self-report says WHETHER it was had, never what was said, so
            // no guess is written -- recording the right answer there would
            // report every admitted miss as an exact hit in Stats.
            ...(produced === null ? {} : { produced }),
            correctTc: round.correctTc,
            correct,
          },
        ],
      },
    });
  };

  const submit = (produced: number) => {
    // V5-5: the forgiveness band is the depth slack the player has signed up
    // for, not a fixed half deck. Grading and the explanation below read the
    // SAME value, or the result screen states a range the grader did not use.
    //
    // Eyes-free there is no slack to grant: the depth was stated, not read off
    // a tray, so nothing was estimated and nothing needs forgiving.
    const slack = produceTcSlack(eyesFree, round.decksRemaining, resolution);
    const correct = gradeProducedTc(produced, round, slack);
    setAnswer({ produced, correct });
    setHonorCheck(false);
    setPhase('result');
    audio.ding(correct ? 'good' : 'bad');

    const verdict = `${correct ? 'Correct.' : 'Wrong.'} ${narrateAnswer()}`;
    if (eyesFree) sayBack(verdict, true);
    else audio.sayFull(verdict);

    recordResult(produced, correct);
  };

  const handleSelfReport = (correct: boolean) => {
    sayBack(correct ? 'Correct.' : 'Wrong.', true);
    setAnswer({ produced: round.correctTc, correct });
    setPhase('result');
    recordResult(null, correct);
  };

  const start = () => {
    runIdRef.current += 1;
    setRound(
      makeProduceTcRound(
        settings.drill.countLengthCards,
        settings.drill.countGroup,
        randomSeed(),
        totalDecks,
        activeProfile.tcRounding,
      ),
    );
    setShownIndex(0);
    setAnswer(null);
    setHonorCheck(false);
    setPhase('flashing');
    if (eyesFree) void requestWakeLock();
  };

  const handleBack = () => {
    void releaseWakeLock();
    onBack();
  };

  /**
   * First refusal on every transcript, for the thing the command vocabulary
   * deliberately does not contain: a number.
   */
  const interpretSpeech = (heard: string, offered: readonly string[] = [heard]): string | null => {
    if (phaseRef.current !== 'answering') return null;
    const readings = offered.length > 0 ? offered : [heard];
    let parsed: ReturnType<typeof parseCountSpeech> = null;
    for (const reading of readings) {
      parsed = parseCountSpeech(reading);
      if (parsed) break;
    }
    if (!parsed) return null;
    const next = parsed.kind === 'value' ? parsed.value : (pendingTc ?? 0) + parsed.delta;
    setPendingTc(next);
    sayBack(narrateReadback(next), true);
    return `true count ${speakableCount(next)}`;
  };

  const handleVoiceCommand = (action: VoiceAction) => {
    switch (phaseRef.current) {
      case 'setup':
        if (action === 'yes') start();
        return;

      case 'answering':
        if (action === 'yes') {
          if (pendingTc === null) {
            sayBack(NO_TRUE_COUNT_YET, true);
            return;
          }
          const confirmed = pendingTc;
          setPendingTc(null);
          submit(confirmed);
          return;
        }
        if (action === 'no') {
          setPendingTc(null);
          sayBack(`${decksSentence}. Produce the true count.`, true);
          return;
        }
        if (action === 'repeat') {
          sayBack(
            pendingTc === null
              ? `${decksSentence}. Produce the true count.`
              : narrateReadback(pendingTc),
            true,
          );
        }
        return;

      case 'selfreport':
        if (action === 'yes') handleSelfReport(true);
        else if (action === 'no') handleSelfReport(false);
        else if (action === 'repeat') {
          sayBack(narrateAnswer(), true);
          sayBack(DID_YOU_HAVE_IT);
        }
        return;

      case 'result':
        if (action === 'yes') start();
        else if (action === 'repeat') sayBack(`${narrateAnswer()} ${SAY_YES_NEXT}`, true);
        else if (action === 'no') sayBack(DECLINED_NEXT, true);
        return;

      // 'flashing' and 'selfcheck' are the app's turn to talk.
      default:
        return;
    }
  };

  const wheelNumber = useWheelNumber({
    readback: (value) => sayBack(narrateReadback(value), true),
    commit: (value) => {
      setPendingTc(null);
      submit(value);
    },
  });
  wheelResetRef.current = wheelNumber.reset;

  useWheelCommand((command) => {
    if (settings.drill.wheelMode === 'talk') {
      if (command === 'forward') {
        startPushToTalk('produce-tc-drill');
        audio.ding('attention');
      } else {
        handleVoiceCommand('repeat');
      }
      return;
    }
    switch (phaseRef.current) {
      case 'answering':
        setPendingTc(wheelNumber.press(command));
        return;
      case 'selfreport':
        handleVoiceCommand(command === 'forward' ? 'yes' : 'no');
        return;
      default:
        handleVoiceCommand(command === 'forward' ? 'yes' : 'repeat');
    }
  });

  const voice = useVoiceControl({
    enabled: voiceOn || pushToTalkOpen,
    onAction: handleVoiceCommand,
    onTranscript: interpretSpeech,
    onNotUnderstood: () => audio.ding('attention'),
    biasPhrases: [...Object.keys(VOICE_ACTIONS), ...COUNT_BIAS_PHRASES],
    context: 'produce-tc-drill',
  });

  // Offer the next round out loud, and take the recogniser's restart gap on
  // the result screen -- the only reliably quiet moment in the drill.
  useEffect(() => {
    if (!voiceOn || phase !== 'result') return;
    voice.cycleIfStale();
    sayBack(SAY_YES_NEXT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceOn, phase]);

  const currentGroup = shownIndex < groups.length ? groups[shownIndex] : null;
  const dealtFraction = (totalDecks - round.decksRemaining) / totalDecks;
  const fillPct = Math.min(98, Math.max(2, dealtFraction * 100));

  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={handleBack}>
          Back
        </button>
        <div className="drill-heading">Produce the True Count</div>
      </div>

      {(voiceOn || pushToTalkOpen) && <VoiceStatusBar status={voice.status} />}

      {phase === 'setup' && (
        <div className="count-setup">
          <label className="count-toggle">
            <input
              type="checkbox"
              checked={eyesFree}
              onChange={(e) => {
                if (e.target.checked && !settings.audio.enabled) {
                  enableAudioNow(settings, onSettingsChange);
                }
                setEyesFree(e.target.checked);
              }}
            />
            Eyes-free audio
          </label>
          {eyesFree && settings.audio.enabled && (
            <>
              <label className="count-toggle">
                <input
                  type="checkbox"
                  checked={strictMode}
                  onChange={(e) => setStrictMode(e.target.checked)}
                />
                Strict mode (entry, graded)
              </label>
              {/* Stated rather than left to be discovered: the tray is the one
                  third of this drill that cannot survive the eyes shutting. */}
              <div className="settings-row settings-note-row u-note">
                The cards are read out and the depth is told to you, so what is being
                drilled is holding the count and converting it — not judging the tray.
                Graded exactly, with no estimation slack, because nothing was estimated.
              </div>
            </>
          )}
          {voiceSupport.api && (
            <label className="count-toggle">
              <input
                type="checkbox"
                checked={voiceOn}
                onChange={(e) => setVoiceOn(e.target.checked)}
              />
              Voice answers
            </label>
          )}
          <button type="button" className="drill-replay-btn" onClick={start}>
            Start
          </button>
        </div>
      )}

      {phase === 'flashing' && (
        <div className="count-flash-area">
          {eyesFree ? (
            <div className="count-flash-progress">Listen for the cards — keep the count</div>
          ) : (
            <>
              <div className="count-flash-cards">
                {currentGroup?.map((c, i) => (
                  <PlayingCard key={i} card={c} />
                ))}
              </div>
              <div className="count-flash-progress">
                {shownIndex + 1} / {groups.length} — keep the running count
              </div>
            </>
          )}
        </div>
      )}

      {phase === 'selfcheck' && (
        <div className="count-flash-area">
          <div className="count-flash-progress">Say the true count…</div>
        </div>
      )}

      {(phase === 'answering' || phase === 'result') && !eyesFree && (
        <>
          <div className="settings-row settings-note-row">
            Judge the tray for decks remaining, then produce the TRUE count.
          </div>
          <div className="table-discard-tray" aria-label="Discard tray">
            <span className="table-discard-label">Discard</span>
            <div className="table-discard-frame">
              <div className="table-discard-fill" style={{ width: `${fillPct}%` }} />
            </div>
          </div>
          {/* V4-3: the shoe size is the profile's now, so the tray alone is
              ambiguous -- a half-full tray is 1 deck left in a 2-deck shoe and
              3 in a 6-deck one. Same line DeckEstimationView carries. */}
          <div className="deck-tray-context deck-tray-context-flow">{totalDecks}-deck shoe</div>
        </>
      )}

      {(phase === 'answering' || phase === 'result') && eyesFree && (
        <div className="settings-row settings-note-row">{decksSentence}.</div>
      )}

      {phase === 'answering' && (
        <>
          {pendingTc !== null && (
            <div className="count-voice" data-pending={true}>
              Heard: {formatSigned(pendingTc)} — say “yes” to submit, or wait for the wheel.
            </div>
          )}
          <NumPad label="Enter the true count" onSubmit={submit} />
        </>
      )}

      {phase === 'selfreport' && (
        <div className="drill-result">
          <div className="result-detail">True count was {formatSigned(round.correctTc)}.</div>
          <button type="button" className="drill-replay-btn" onClick={() => handleSelfReport(true)}>
            I had it
          </button>
          <button type="button" className="drill-back-btn" onClick={() => handleSelfReport(false)}>
            I missed it
          </button>
        </div>
      )}

      {phase === 'result' && answer && (
        <div className="drill-result">
          <div className={answer.correct ? 'result-correct' : 'result-wrong'}>
            {answer.correct ? 'Correct!' : 'Off'}
          </div>
          <div className="result-detail">
            {honorCheck ? (
              <>
                Self-reported, and recorded. True count was {formatSigned(round.correctTc)} (running
                count {formatSigned(round.round.finalRc)} ÷ {formatDecks(round.decksRemaining)}{' '}
                decks).
              </>
            ) : (
              <>
                You produced {formatSigned(answer.produced)}; true count was{' '}
                {formatSigned(round.correctTc)} (running count {formatSigned(round.round.finalRc)} ÷{' '}
                {formatDecks(round.decksRemaining)} decks).
                {(() => {
                  // Say what was actually accepted, or the grade looks arbitrary:
                  // the range comes from reading the tray a resolution's worth
                  // either way, and it is far wider late in the shoe than early.
                  // Eyes-free there is no range at all -- the depth was stated.
                  if (eyesFree) return null;
                  const slack = eyesFree ? 0 : depthTolerance(round.decksRemaining, resolution);
                  const band = producedTcBand(round, slack);
                  return band.min === band.max ? null : (
                    <>
                      {' '}
                      Reading the tray {formatDepthSlack(slack)} either way puts it between{' '}
                      {formatSigned(band.min)} and {formatSigned(band.max)}, so anything in that
                      range counts.
                      {isLastDeckTightened(round.decksRemaining, resolution) && (
                        <> A tighter range than usual &mdash; this is the last deck.</>
                      )}
                    </>
                  );
                })()}
              </>
            )}
          </div>
          <button type="button" className="drill-replay-btn" onClick={start}>
            Next
          </button>
          <button type="button" className="drill-back-btn" onClick={handleBack}>
            Back to Drills
          </button>
        </div>
      )}
    </div>
  );
}
