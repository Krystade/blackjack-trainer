import { BADGE_TEXT, type FigureLine } from '../../casinoFigureLine';

/** Wave W review S1: what a figure is -- an estimate, a partial run, or stale -- as Ranked marks it. */
export function FigureBadges({ line }: { line: FigureLine }) {
  if (line.badges.length === 0) return null;
  return (
    <>
      {line.badges.map((b) => (
        <span key={b} className="cas-badge" data-tone={b === 'estimate' ? 'info' : 'warn'} data-testid={`figure-${b}`}>
          {BADGE_TEXT[b]}
        </span>
      ))}
    </>
  );
}
