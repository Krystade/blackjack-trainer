import type { TermId } from './terms';

/**
 * T2-2B: plain copy with its glossary words made tappable -- the first time
 * each term appears, so a sentence never turns into a row of "?" badges.
 * Only for text OUTSIDE a button: a Term is a button, and a button inside a
 * button is invalid (and the outer one would swallow the tap).
 */
export const TEXT_TERMS: readonly [RegExp, TermId][] = [
  [/basic[ -]strategy/i, 'basic-strategy'],
  [/running count/i, 'rc'],
  [/true count/i, 'tc'],
  [/bet ramp/i, 'bet-ramp'],
  [/deviations?/i, 'deviation'],
  [/Hi-Lo/, 'hi-lo'],
  [/discard tray/i, 'discard-tray'],
];

/** The pieces of `text`: plain strings and [matched words, term] pairs. */
export function splitTerms(text: string): (string | [string, TermId])[] {
  const used = new Set<TermId>();
  const out: (string | [string, TermId])[] = [];
  let rest = text;
  for (;;) {
    let best: { at: number; len: number; id: TermId } | null = null;
    for (const [re, id] of TEXT_TERMS) {
      if (used.has(id)) continue;
      const m = re.exec(rest);
      if (m && (best === null || m.index < best.at)) best = { at: m.index, len: m[0].length, id };
    }
    if (!best) break;
    if (best.at > 0) out.push(rest.slice(0, best.at));
    out.push([rest.slice(best.at, best.at + best.len), best.id]);
    used.add(best.id);
    rest = rest.slice(best.at + best.len);
  }
  if (rest) out.push(rest);
  return out;
}
