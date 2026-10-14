import './rulesChip.css';

/**
 * #26: the rules a drill or quiz prompt is asked under ("No surrender",
 * "Surrender OK", "No double"), shown before the answer, beside the TC.
 * The labels come from the pure helpers in drills/legalActions.ts and
 * drills/deviationQuiz.ts, so the chip states the grader's own context.
 */
export function RulesChip({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <div className="rules-chip-row" data-testid="rules-chip">
      {labels.map((l) => (
        <span key={l} className={`rules-chip${l.startsWith('No ') ? ' rules-chip--off' : ''}`}>
          {l}
        </span>
      ))}
    </div>
  );
}
