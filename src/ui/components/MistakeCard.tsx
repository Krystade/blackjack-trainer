import type { Action } from '../../engine/deviations';
import type { MistakeClass } from '../../engine/grade';

/**
 * The shared "here is what you got wrong" panel, used by the table overlay
 * and all three drill views (flashcards, deviation quiz, mixed session).
 *
 * It replaces a one-line `Wrong — correct: HIT` plus a raw `cellId`, which
 * told the learner the verdict but nothing they could act on. Three things
 * that line could not do, and this panel must:
 *
 *  1. NAME THE KIND OF ERROR. "Basic error", "missed deviation" and
 *     "phantom deviation" are different failures with different fixes, and
 *     the engine already classifies them (engine/grade.ts) -- the UI was
 *     simply throwing that away. Telling a learner they deviated when the
 *     count did not call for it is the correction; "wrong" is not.
 *  2. ANCHOR TO THE CHART. The correct play is drawn as a ringed chart
 *     CELL, in the same notation as the strategy tables, so the panel reads
 *     as the thing being memorised rather than a generic error toast. It is
 *     also the visual bridge to "Show me the table".
 *  3. SURVIVE NOT BEING LOOKED AT. In eyes-free use the correction is
 *     spoken and the screen may be dimmed, so `eyesFree` collapses this to
 *     a glanceable verdict instead of a wall of text nobody can read while
 *     driving. Nothing here is the ONLY carrier of the correction.
 */

/** Strategy-chart notation for an action, matching the chart tables the
 * learner studies. Double and surrender collapse to their base letter --
 * the Dh/Ds and Rh/Rs distinction encodes a FALLBACK, which is a property
 * of the cell, not of the play that was correct here. */
const ACTION_CHART_LETTER: Record<Action, string> = {
  hit: 'H',
  stand: 'S',
  double: 'D',
  split: 'P',
  surrender: 'R',
};

const ACTION_LABEL: Record<Action, string> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  surrender: 'Surrender',
};

/**
 * What each classification actually means, in the second person. These are
 * the sentences that turn a verdict into a lesson, so they name the fix
 * rather than restating the error.
 */
const CLASS_COPY: Record<Exclude<MistakeClass, 'correct'>, { label: string; note: string }> = {
  'basic-error': {
    label: 'Basic error',
    note: 'The count was not involved — this one is pure basic strategy.',
  },
  'missed-deviation': {
    label: 'Missed deviation',
    note: 'Basic strategy was right at neutral, but the count had moved past the index.',
  },
  'phantom-deviation': {
    label: 'Phantom deviation',
    note: 'You deviated, but the count had not reached the index yet. Basic strategy still applied.',
  },
  'wrong-anyway': {
    label: 'Wrong anyway',
    note: 'Neither basic strategy nor the index play — worth a slow look at this hand.',
  },
};

/** Actions the drills can grade that are not table plays. */
function labelFor(value: string): string {
  if (value in ACTION_LABEL) return ACTION_LABEL[value as Action];
  if (value === 'take-insurance') return 'Take insurance';
  if (value === 'decline-insurance') return 'Decline insurance';
  return value;
}

function letterFor(value: string): string | null {
  if (value in ACTION_CHART_LETTER) return ACTION_CHART_LETTER[value as Action];
  return null;
}

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

export interface MistakeCardProps {
  /** What the learner played. */
  taken: string;
  /** What the engine graded as correct. */
  expected: string;
  /** Raw `GradedEvent.reason`. Displayed as written — the index notation is
   * readable on screen and is itself worth learning. The SPOKEN form goes
   * through narrateReason (see audio/narrate.ts). */
  reason: string;
  tc: number;
  /** e.g. "10,6 v 10" — the matchup, in table notation. */
  hand?: string;
  classification?: MistakeClass;
  /** Collapses to a glanceable verdict; the correction is carried by audio. */
  eyesFree?: boolean;
  /** Opens the strategy chart on this exact cell. Omitted when unavailable. */
  onShowTable?: () => void;
  /** Advance. Optional because the drills keep their own Next in the action
   * bar (one Next per screen, always in the same place); the table overlay
   * has no action bar and passes its dismiss here instead. */
  onNext?: () => void;
  /** Extra detail rendered under the correction — the drills pass the chart
   * cell id / index label, which names the exact row being learned. */
  footnote?: string;
}

export function MistakeCard({
  taken,
  expected,
  reason,
  tc,
  hand,
  classification,
  eyesFree = false,
  onShowTable,
  onNext,
  footnote,
}: MistakeCardProps) {
  const expectedLetter = letterFor(expected);
  const copy =
    classification && classification !== 'correct' ? CLASS_COPY[classification] : undefined;

  // The drills populate `hand`, `reason` and the cell-id footnote from the
  // SAME source: gradeAnswer.ts sets reason and hand to `card.cellId` for a
  // flashcard and to `item.label` for a quiz item. Rendered naively that
  // prints one identical string three times, which reads as a bug and buries
  // the parts that differ. Show each distinct value once, in priority order.
  const seen = new Set<string>();
  const once = (value: string | undefined): string | undefined => {
    if (!value || seen.has(value)) return undefined;
    seen.add(value);
    return value;
  };
  const handLine = once(hand);
  const reasonLine = once(reason);
  const footnoteLine = once(footnote);

  // Eyes-free: the spoken correction is the real channel. Anything that
  // needs reading is dropped rather than shrunk, leaving only what survives
  // a glance from a car mount.
  if (eyesFree) {
    return (
      <div className="mistake-card mistake-card-eyes-free" role="alert">
        <div className="mistake-verdict result-wrong">Wrong</div>
        <div className="mistake-eyes-free-answer">{labelFor(expected)}</div>
        {onNext && (
          <button type="button" className="drill-next-btn" onClick={onNext}>
            Next
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mistake-card" role="alert">
      <div className="mistake-head">
        {/* `result-wrong` is kept alongside the panel's own class: it is the
            app-wide marker for "this answer was wrong", relied on by the e2e
            specs as the single stable hook for a graded verdict. Dropping it
            would make the panel a second, silent vocabulary for the same
            event. `.mistake-verdict` is defined later in app.css, so it wins
            on the styling the two rules share. */}
        <span className="mistake-verdict result-wrong">Wrong</span>
        {copy && <span className="mistake-class">{copy.label}</span>}
      </div>

      <div className="mistake-plays">
        <div className="mistake-play mistake-play-taken">
          <span className="mistake-play-role">You played</span>
          <span className="mistake-play-value">{labelFor(taken)}</span>
        </div>
        <div className="mistake-play mistake-play-expected">
          <span className="mistake-play-role">Correct</span>
          <span className="mistake-play-value">
            {expectedLetter && <span className="mistake-cell">{expectedLetter}</span>}
            {labelFor(expected)}
          </span>
        </div>
      </div>

      <div className="mistake-context">
        {handLine && <span className="mistake-hand">{handLine}</span>}
        <span className="mistake-tc">TC {formatSigned(tc)}</span>
      </div>

      {copy && <p className="mistake-note">{copy.note}</p>}
      {reasonLine && <p className="mistake-reason">{reasonLine}</p>}
      {footnoteLine && <div className="feedback-cell">{footnoteLine}</div>}

      {(onShowTable || onNext) && (
        <div className="mistake-actions">
          {onShowTable && (
            <button type="button" className="mistake-table-btn" onClick={onShowTable}>
              Show me the table
            </button>
          )}
          {onNext && (
            <button type="button" className="drill-next-btn" onClick={onNext}>
              Next
            </button>
          )}
        </div>
      )}
    </div>
  );
}
