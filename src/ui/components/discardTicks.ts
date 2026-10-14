/**
 * #38: the marks on the discard tray, one per whole deck dealt, so depth can
 * be read by eye like the lines on a real tray. A mark at deck k sits at
 * k/decks of the tray's length and is labelled k (decks dealt). The empty and
 * full ends get no mark: 0 and the whole shoe are the tray's own edges.
 */
export interface DiscardTick {
  decksDealt: number;
  pct: number;
}

export function discardTicks(decks: number): DiscardTick[] {
  const whole = Math.floor(decks);
  const ticks: DiscardTick[] = [];
  for (let k = 1; k < decks && k <= whole; k++) {
    ticks.push({ decksDealt: k, pct: (k / decks) * 100 });
  }
  return ticks;
}
