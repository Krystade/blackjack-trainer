import { trueCount, type TcRounding } from '../engine/count';
import type { DepthResolution } from './depthResolution';
import { signedTc, tcWorking } from './tcFeedback';

/**
 * T2-2B: the worked examples shown once before the first True count, Deck
 * estimation and Produce the true count run (DrillIntroCard), and kept after
 * that under each setup's "How it works".
 *
 * Pure text builders: every number is computed from the same functions the
 * drills grade with (trueCount, tcWorking), and the profile's own rounding
 * is passed in, so the example can never teach a different answer than the
 * drill will accept.
 */

export interface WorkedExample {
  title: string;
  lines: string[];
  /** The worked sums, one per line, set apart from the prose. */
  examples: string[];
  /** A discard tray to draw beside the example: cards dealt of the shoe. */
  tray?: { cardsDealt: number; decks: number };
}

const VERB: Record<TcRounding, string> = { floor: 'floors', truncate: 'truncates', round: 'rounds' };
const RULE: Record<TcRounding, string> = {
  floor: 'always down',
  truncate: 'toward zero, dropping the fraction',
  round: 'to the nearest whole number',
};

/** The example whose rounding matters: −5 ÷ 1.5 = −3.33 (floor −4, truncate and round −3). */
export const NEGATIVE_EXAMPLE = { runningCount: -5, decksRemaining: 1.5 } as const;

export function trueCountExample(rounding: TcRounding): WorkedExample {
  const { runningCount: rc, decksRemaining: d } = NEGATIVE_EXAMPLE;
  const others = (['floor', 'truncate', 'round'] as const).filter(
    (r) => r !== rounding && trueCount(rc, d, r) !== trueCount(rc, d, rounding),
  );
  const contrast = others.map((r) => `${r} would give ${signedTc(trueCount(rc, d, r))}`).join(', ');
  return {
    title: 'How the true count works',
    lines: [
      'True count = running count ÷ decks left.',
      `Your profile ${VERB[rounding]}: it rounds ${RULE[rounding]}. Set it in Profile › True count rounding.`,
      ...(contrast ? [`Below zero the rounding matters: ${contrast}.`] : []),
    ],
    examples: [tcWorking(6, 3, rounding), tcWorking(rc, d, rounding)],
  };
}

/** Deck estimation: a tray at 2½ of 6 decks. */
export const TRAY_EXAMPLE = { decksDealt: 2.5, decks: 6 } as const;

const RESOLUTION_LINE: Record<DepthResolution, string> = {
  half: 'Answer to the nearest half deck.',
  'last-deck': 'Answer to the nearest half deck, and to the nearest quarter once a deck or less is left.',
  quarter: 'Answer to the nearest quarter deck.',
};

export function deckEstimationExample(resolution: DepthResolution): WorkedExample {
  const { decksDealt, decks } = TRAY_EXAMPLE;
  return {
    title: 'How to read the tray',
    lines: [
      'Judge how many decks are in the discard tray, then take that from the shoe: what is left is what you divide by.',
      RESOLUTION_LINE[resolution],
    ],
    examples: [`The tray holds about ${plainDecks(decksDealt)} decks of ${decks}, so ${plainDecks(decks - decksDealt)} are left.`],
    tray: { cardsDealt: Math.round(decksDealt * 52), decks },
  };
}

/** Produce the true count: RC +8 with the tray at 2 of 6 decks. */
export const PRODUCE_EXAMPLE = { runningCount: 8, decksDealt: 2, decks: 6 } as const;

export function produceTcExample(rounding: TcRounding): WorkedExample {
  const { runningCount: rc, decksDealt, decks } = PRODUCE_EXAMPLE;
  const left = decks - decksDealt;
  return {
    title: 'How it works',
    lines: [
      '1. Keep the running count as the cards come out.',
      '2. Read the discard tray for the decks left.',
      `3. Divide, and round your profile's way (it ${VERB[rounding]}).`,
    ],
    examples: [
      `Running count ${signedTc(rc)}; the tray holds ${decksDealt} of ${decks} decks, so ${left} are left.`,
      tcWorking(rc, left, rounding),
    ],
    tray: { cardsDealt: decksDealt * 52, decks },
  };
}

/** "2½", "3½", "4". */
function plainDecks(n: number): string {
  const whole = Math.floor(n);
  const frac = n - whole;
  if (frac === 0) return String(whole);
  const glyph = frac === 0.5 ? '½' : frac === 0.25 ? '¼' : frac === 0.75 ? '¾' : null;
  return glyph ? `${whole === 0 ? '' : whole}${glyph}` : String(n);
}
