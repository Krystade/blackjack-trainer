/**
 * Wave A: signed counts and true counts as the drills print them.
 *
 * The index labels have always used a real minus sign ("hit at TC ≤ −3"), but
 * the TC readouts, keypad, prompts and results beside them used the ASCII
 * hyphen, so "7,5 v 5 at TC -2" sat next to "TC ≤ −3" in one strip, and the
 * short hyphen is easy to misread at a glance -- the whole point of a quick
 * distraction or a flashed count.
 */

/** U+2212 MINUS SIGN. */
export const MINUS = '−';

/**
 * "+2", "−2", "0". `plusZero` prints "+0" for the screens that always carry a
 * sign (a TC readout reads "TC +0").
 */
export function signed(n: number, opts: { plusZero?: boolean } = {}): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${MINUS}${-n}`;
  return opts.plusZero ? '+0' : '0';
}

/** A number as read, with a real minus and no plus: "−3", "3". */
export function plainNumber(n: number): string {
  return n < 0 ? `${MINUS}${-n}` : String(n);
}

/**
 * Display text with every hyphen that is a sign or an operator ("-1 - (-4)")
 * turned into a real minus. A hyphen between two letters ("Hi-Lo") is left.
 */
export function withMinusSigns(text: string): string {
  return text.replace(/-(?=\s|\d|\()/g, MINUS);
}
