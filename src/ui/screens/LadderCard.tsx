import type { Ladder, NextStep, StartTarget } from './nextStep';
import './driveButton.css';
import { CATEGORY_TARGET, MIN_CATEGORY_ANSWERS, goalPct, pctDown } from './handProgress';

/**
 * B2: Home's Next step card. The step (title, why, one gold Start) over the
 * seven rungs in casino order. Every row opens its own drill, locked ones
 * too: the ladder recommends, it never gates.
 */
export function LadderCard({
  ladder,
  onStart,
  drive,
}: {
  ladder: Ladder;
  /** C-R3: one tap back into the last eyes-free / voice drill. */
  drive?: { label: string; onDrive: () => void };
  /** A review step carries its due cells or indexes; a rung row only its target. */
  onStart: (t: StartTarget & Pick<NextStep, 'reviewCells' | 'reviewIndexes'>) => void;
}) {
  const { step, rungs, current } = ladder;
  return (
    <section className="next-step" aria-label="Next step" data-step={step.kind} data-card={step.card}>
      <span className="readiness-label">Next step</span>
      <div className="next-step-head">
        <div className="next-step-text">
          <h2 className="next-step-title">{step.title}</h2>
          <p className="next-step-why">{step.why}</p>
        </div>
        {/* W13: the one gold primary on Home. */}
        <button
          type="button"
          className="u-btn u-btn-primary next-step-btn"
          data-launch={step.kind}
          onClick={() => onStart(step)}
        >
          Start
        </button>
      </div>
      {/* C-R3: secondary, directly under Start -- Start stays the one gold. */}
      {drive && (
        <button type="button" className="u-btn next-step-drive" onClick={drive.onDrive}>
          Drive: {drive.label}
        </button>
      )}
      {/* s02: per-category progress while basic strategy is the rung. */}
      {current === 0 && step.progress && (
        <ul className="next-step-progress" aria-label="Basic strategy progress">
          {step.progress.map((c) => (
            <li
              key={c.prefix}
              className="next-step-progress-row"
              data-hand={c.prefix}
              data-on-target={c.onTarget ? 'true' : 'false'}
            >
              <span className="next-step-progress-label">{c.label}</span>
              <span className="next-step-progress-value">
                {c.thin
                  ? `${c.n}/${MIN_CATEGORY_ANSWERS} answers`
                  : c.onTarget
                    ? `✓ ${goalPct(c.pct)}`
                    : `${goalPct(c.pct)} (goal ${pctDown(CATEGORY_TARGET)})`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ol className="ladder">
        {rungs.map((rung, i) => {
          const state = rung.passed ? 'done' : i === current ? 'current' : 'locked';
          const suffix = state === 'done' ? 'done' : state === 'current' ? 'current' : 'not yet';
          return (
            <li key={rung.id}>
              <button
                type="button"
                className="ladder-row"
                data-rung={rung.id}
                data-state={state}
                aria-current={state === 'current' ? 'step' : undefined}
                aria-label={`${i + 1}. ${rung.label}, ${suffix}`}
                onClick={() => onStart(rung.start)}
              >
                <span className="ladder-mark" aria-hidden="true">
                  {state === 'done' ? '✓' : i + 1}
                </span>
                <span className="ladder-label">{rung.label}</span>
                {state === 'current' && <span className="ladder-progress">{rung.progress}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
