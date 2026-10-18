import type { ReactNode } from 'react';
import type { Profile } from '../../../store/types';
import type { Card, Rank } from '../../../engine/cards';
import { PlayingCard } from '../../components/PlayingCard';
import { MistakeCard } from '../../components/MistakeCard';
import { ShotClockBar } from '../../components/ShotClockBar';
import { StudyChartOverlay } from '../../components/StudyChartOverlay';
import { HandResultStrip } from '../../components/HandResultStrip';
import { MissHistoryLine } from './MissHistoryLine';
import type { DrillHandResult } from './drillMiss';
import type { HandResult } from '../../handResult';
import type { AnswerFeedback } from './handDrillShared';
import type { AnswerSession, ShotClock } from './useAnswerSession';

/*
 * W2-25: the pieces of screen the three hand drills (Flashcards, Deviation
 * quiz, Mixed) drew three copies of. Markup unchanged -- the class names and
 * test ids are what the layout CSS and the specs read.
 */

export function DrillTopBar({
  title,
  onBack,
  audioEnabled,
  onReplay,
}: {
  title: ReactNode;
  onBack: () => void;
  audioEnabled: boolean;
  onReplay: () => void;
}) {
  return (
    <div className="drill-topbar">
      <button type="button" className="drill-back-btn" onClick={onBack}>
        Back
      </button>
      <div className="drill-heading">{title}</div>
      {audioEnabled && (
        <button type="button" className="repeat-btn" onClick={onReplay}>
          Repeat
        </button>
      )}
    </div>
  );
}

/**
 * The revealed play, while the wheel waits to be told whether it was had. On
 * screen as well as spoken so the wheel can be checked at a desk -- the
 * operator asked for uses they could verify, and an audio-only affordance is
 * unverifiable.
 */
export function SelfCheckBanner({ testId, label }: { testId: string; label: string }) {
  return (
    <div className="selfcheck-banner" data-testid={testId}>
      <strong>{label}</strong>
      <span>Wheel: next = I had it &middot; prev = I missed it</span>
    </div>
  );
}

/** The correction panel's verdict: "Correct!" or the mistake card. */
export function FeedbackVerdict({
  feedback,
  eyesFree,
  onShowTable,
}: {
  feedback: AnswerFeedback;
  eyesFree: boolean;
  onShowTable?: () => void;
}) {
  if (feedback.correct) return <div className="result-correct">Correct!</div>;
  return (
    <MistakeCard
      taken={feedback.event.taken}
      expected={feedback.event.expected}
      reason={feedback.event.reason}
      tc={feedback.event.tc}
      hand={feedback.event.hand}
      classification={feedback.event.classification}
      eyesFree={eyesFree}
      onShowTable={onShowTable}
    />
  );
}

/** B1: the previous item's result, under the item now being asked. An
 *  insurance question has no chart cell to open. */
export function LastResult({ session, result }: { session: AnswerSession; result: DrillHandResult }) {
  return (
    <>
      <HandResultStrip
        result={result}
        onShowChart={result.cards ? session.openChartOn : undefined}
        onWrongTap={session.wrongTapFor(result)}
      />
      <MissHistoryLine result={result} />
    </>
  );
}

export function NextBar({ onNext }: { onNext: () => void }) {
  return (
    <div className="action-bar">
      <button type="button" className="drill-next-btn" onClick={onNext}>
        Next
      </button>
    </div>
  );
}

export function InsuranceBar({ onAnswer }: { onAnswer: (taken: string) => void }) {
  return (
    <div className="action-bar">
      <button type="button" className="action-btn" onClick={() => onAnswer('take-insurance')}>
        Take insurance
      </button>
      <button type="button" className="action-btn" onClick={() => onAnswer('decline-insurance')}>
        Decline insurance
      </button>
    </div>
  );
}

/** The dealer's up card over the player's hand, or the insurance question. */
export function DealtHand({ cards, up }: { cards: Card[] | null; up: Rank }) {
  if (cards === null) return <div className="quiz-insurance-prompt">Dealer shows an Ace. Insurance?</div>;
  return (
    <>
      <div className="dealer-area">
        <PlayingCard card={{ rank: up, suit: 's' }} />
      </div>
      <div className="hands-row">
        <div className="player-hand">
          <div className="hand-cards">
            {cards.map((c, i) => (
              <PlayingCard key={i} card={c} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export function DrillChart({ session, activeProfile }: { session: AnswerSession; activeProfile: Profile }) {
  const { showChart, chartTarget } = session;
  if (!showChart || !chartTarget) return null;
  return (
    <StudyChartOverlay
      activeProfile={activeProfile}
      cards={chartTarget.cards}
      dealerUp={chartTarget.up}
      graded={chartTarget.graded}
      onClose={session.closeChart}
    />
  );
}

/**
 * Between the hand and the answer, which is where the eye already is.
 * Paused rather than hidden once an answer is in, so the bar does not vanish
 * out from under a glance at the correction.
 */
export function ShotClockArea({ clock, session }: { clock: ShotClock; session: AnswerSession }) {
  return (
    <>
      <ShotClockBar
        limitMs={clock.clockSuspended ? 0 : clock.shotClockMs}
        restartKey={session.runIdRef.current}
        paused={session.feedback !== null || session.showChart || clock.clockIdle}
        delayMs={session.clockGraceRef.current}
      />
      {clock.clockIdle && !clock.clockSuspended && (
        <div className="shot-clock-idle" data-testid="shot-clock-idle">
          Shot clock stopped: nobody answered. Answer to start it again.
        </div>
      )}
    </>
  );
}

/** R7: a review's "what and how much is left" line, in place of the deck controls. */
export function ReviewStatusLine({ text }: { text: string }) {
  return (
    <div className="review-status" role="status" data-testid="review-status">
      {text}
    </div>
  );
}

/**
 * R7 (#42): the end of a review or session deck -- the dealing stops, says
 * so, and offers the way back. `lastResult` keeps the final answer readable.
 */
export function ReviewDone({
  heading,
  line,
  onBack,
  onHome,
  lastResult,
}: {
  heading: string;
  line: string;
  onBack: () => void;
  onHome?: () => void;
  lastResult: HandResult | null;
}) {
  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={onBack}>
          Back
        </button>
        <div className="drill-heading">{heading}</div>
      </div>
      <div className="review-done" role="status" data-testid="review-done">
        <div className="result-correct">{line}</div>
        {lastResult && <HandResultStrip result={lastResult} />}
        <div className="review-done-actions">
          {onHome && (
            <button type="button" className="u-btn u-btn-primary" onClick={onHome}>
              Back to Home
            </button>
          )}
          <button type="button" className="u-btn" onClick={onBack}>
            Drills
          </button>
        </div>
      </div>
    </div>
  );
}
