import type { GradedCheckpoint } from './countCheckpoints';
import { signedTc as signed } from './tcFeedback';

/**
 * Wave A (s04): one checkpoint row, said as a verdict on its own stretch.
 *
 * The read-back used to print the absolute "you said 1, it was 1" beside the
 * ADJUSTED grade (#46), so matching numbers showed in red and mismatched ones
 * in green, and the "expected / graded from / adjusted" note read as engine
 * output. Now the verdict leads ("off by −2" or "right") and the detail says
 * why in the same terms. Only the first stop, which is graded absolutely,
 * shows "you said / it was".
 */
export interface StretchLine {
  /** First card of the stretch, 1-based. */
  fromCard: number;
  /** Last card of the stretch: the stop itself. */
  toCard: number;
  /** "right" or "off by +2" -- always agrees with `correct`. */
  verdict: string;
  /** One sentence of why. */
  detail: string;
}

function moved(n: number): string {
  return n === 0 ? 'stayed put' : `moved ${signed(n)}`;
}

export function stretchLine(g: GradedCheckpoint): StretchLine {
  const fromCard = (g.from?.cardsShown ?? 0) + 1;
  const verdict = g.correct ? 'right' : `off by ${signed(g.answer - g.expected)}`;
  let detail: string;
  if (!g.from) {
    detail = `You said ${signed(g.answer)}; it was ${signed(g.actual)}.`;
  } else {
    const yours = g.answer - g.from.answer;
    const cards = g.expected - g.from.answer;
    detail = g.correct
      ? `Your count ${moved(yours)}, as the cards did.`
      : `Your count ${moved(yours)}; the cards ${moved(cards)}.`;
  }
  return { fromCard, toCard: g.cardsShown, verdict, detail };
}

/** "cards 25–47", or "card 52" for a one-card stretch. */
export function cardsLabel(line: Pick<StretchLine, 'fromCard' | 'toCard'>): string {
  return line.fromCard === line.toCard ? `card ${line.toCard}` : `cards ${line.fromCard}–${line.toCard}`;
}
