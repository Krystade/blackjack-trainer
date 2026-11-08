/**
 * Track 3: what Play says when it took a shoe back from disk (ui/tableResume.ts).
 * Pure, so the wording is tested without a table.
 */

export interface ResumeFacts {
  /** The last round played to its end. */
  roundNo: number;
  /** The round the page died in, voided; null when it died between rounds. */
  cutOff: number | null;
  savedAt: number;
}

/** "just now", "4 min ago", "2 h ago" -- how long the shoe sat. */
export function sinceText(savedAt: number, now: number): string {
  const min = Math.floor(Math.max(0, now - savedAt) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} h ago`;
}

/** The note's headline: "Shoe resumed after round 14 (4 min ago)." */
export function resumeTitle(f: ResumeFacts, now: number): string {
  return `Shoe resumed after round ${f.roundNo} (${sinceText(f.savedAt, now)}).`;
}

/** The second line, only when a round was cut off. */
export function cutOffText(f: ResumeFacts): string | null {
  if (f.cutOff === null) return null;
  return `Round ${f.cutOff} was cut off: its cards are burned and counted, the bet is void.`;
}

/** Eyes-free: said once, on the resumed mount. */
export function resumeSpoken(f: ResumeFacts): string {
  const cut = f.cutOff === null ? '' : ` Round ${f.cutOff} was cut off; its cards stay counted.`;
  return `Shoe resumed after round ${f.roundNo}.${cut}`;
}
