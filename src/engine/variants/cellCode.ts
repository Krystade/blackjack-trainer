/**
 * Wave L: reading a variant chart cell code (chartGen.ts's notation).
 *
 * Shared by the grader (variants/strategy.ts) and the published-chart
 * comparison (compare.ts), so the play a cell is graded as and the play it is
 * compared as are decided by the same function.
 */

import type { SuitState, VAct } from './ev';

export interface ParsedCode {
  /** The code without its step number or mark, e.g. 'S', 'Dh', 'Rh', 'P$'. */
  base: string;
  /** Spanish 21: hit once the hand has this many cards. */
  step: number | null;
  /** Spanish 21 6-7-8 mark: * any suits, ' suited, " spades. */
  mark: '' | '*' | "'" | '"';
}

export function parseCode(code: string): ParsedCode {
  const mark = (/[*'"]$/.test(code) ? code.slice(-1) : '') as ParsedCode['mark'];
  const bare = mark ? code.slice(0, -1) : code;
  const m = /^([A-Za-z$]+?)(\d)?$/.exec(bare);
  if (!m) throw new Error(`unreadable cell code ${code}`);
  return { base: m[1]!, step: m[2] ? Number(m[2]) : null, mark };
}

/**
 * The play a cell code calls for with `n` cards, or on a two-card 6-7-8 /
 * 7-7-7 start with suit state `suit` (m mixed, s suited, p spades). With
 * surrender or doubling available; the caller applies the fallbacks.
 */
export function playFor(code: string, n: number, suit: SuitState | null = null): VAct {
  const { base, step, mark } = parseCode(code);
  if (suit !== null && mark) {
    const hits = mark === '*' || (mark === "'" && suit !== 'm') || (mark === '"' && suit === 'p');
    if (hits) return 'H';
  }
  if (step !== null && n >= step) return 'H';
  if (base === 'P$') return 'P';
  if (base.startsWith('R')) {
    if (n === 2) return 'R';
    return fallbackOf(base);
  }
  if (base === 'D') return 'D';
  if (base === 'Dh' || base === 'Ds') return n === 2 ? 'D' : fallbackOf(base);
  return base as VAct;
}

/** The second letter of a two-letter code: what to do when the first is not allowed. */
export function fallbackOf(base: string): VAct {
  const letter = base[1];
  return letter === 's' ? 'S' : letter === 'p' ? 'P' : 'H';
}
