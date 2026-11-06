import type { Deviation, DeviationId } from '../../engine/deviations';
import type { StrategyRules } from '../../engine/ruleset';
import { askedIndexSet } from '../../drills/deviationQuiz';
import { groupByIndex, type IndexGroup, type PathState } from '../../drills/indexPath';
import { signed } from '../../drills/signed';
import { toEntry } from '../screens/indexChart';
import './indexByCount.css';

/**
 * Owner 2026-11-06: the indices grouped by the count they change at --
 * "+3: insurance, 12 v 2 stand, 10 v A double, 9 v 7 double" -- highest
 * first, then 0, then the counts below zero.
 */
export function IndexByCountList({
  devs,
  path,
}: {
  devs: readonly Deviation[];
  /** With the learning path: its current group is marked, learned rows ticked. */
  path?: PathState;
}) {
  const byId = new Map(devs.map((d) => [d.id, d]));
  const currentValue = path && path.current < path.order.length ? path.order[path.current]!.value : null;
  const groups = groupByIndex(devs);
  const below = groups.filter((g) => g.value < 0);
  const rest = groups.filter((g) => g.value >= 0);
  const block = (g: IndexGroup) => (
    <div
      className={`ibc-group${g.value === currentValue ? ' ibc-group-current' : ''}`}
      key={g.value}
      data-index-value={g.value}
    >
      <div className="ibc-value">{g.value === 0 ? '0' : signed(g.value)}</div>
      <ul className="ibc-rows">
        {g.ids.map((id) => {
          const e = toEntry(byId.get(id)!);
          const learned = path?.learned.has(id as DeviationId) === true;
          return (
            <li key={id} className="ibc-row" data-learned={learned || undefined}>
              <span className="ibc-hand">
                {e.hand} <span className="ibc-v">v</span> {e.dealer}
              </span>
              <span className="ibc-play" data-family={e.family}>
                {e.play}
                {e.below !== null && <span className="ibc-below"> · {e.below}</span>}
              </span>
              {path && <span className="ibc-tick" aria-label={learned ? 'learned' : 'not learned yet'}>{learned ? '✓' : ''}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
  return (
    <div className="ibc" data-testid="index-by-count">
      <p className="ibc-note">At this count or higher, make the play.</p>
      {rest.map(block)}
      {below.length > 0 && (
        <>
          <p className="ibc-note ibc-note-below">Below zero: stand at this count or higher, hit below it.</p>
          {below.map(block)}
        </>
      )}
    </div>
  );
}

/** Owner 2026-11-06: the learning path's line in the Deviation quiz, with the study list under it. */
export function IndexPathStatus({ path, rules }: { path: PathState; rules: StrategyRules }) {
  const devs = askedIndexSet(rules);
  const done = path.current >= path.order.length;
  const group = done ? null : path.order[path.current]!;
  const learnedHere = group ? group.ids.filter((id) => path.learned.has(id)).length : 0;
  const nextGroup = done ? null : path.order[path.current + 1];
  const name = (v: number) => (v === 0 ? '0' : signed(v));
  return (
    <details className="ibc-status" data-testid="index-path-status">
      <summary>
        {group ? (
          <>
            Learning the <strong>{name(group.value)}</strong> indices: {learnedHere} of {group.ids.length} learned
            {nextGroup ? <> · then {name(nextGroup.value)}</> : null}
          </>
        ) : (
          <>Every group learned: all indices, mixed</>
        )}
        <span className="ibc-status-open"> · study list</span>
      </summary>
      <p className="ibc-note">Three right in a row and an index is learned. Learn a group and the next one opens.</p>
      <IndexByCountList devs={devs} path={path} />
    </details>
  );
}
