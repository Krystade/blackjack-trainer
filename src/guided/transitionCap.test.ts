import { describe, expect, it } from 'vitest';
import { GUIDED_CLIP_MS } from './clipDurations';
import { allGuidedSentences, driveIntroLine, GUIDED_COMMANDS_HINT, transitionLine } from './lines';
import { SEGMENTS } from './plan';
import { DRIVE_CAP_MARGIN_MS, driveTransitionCapMs, spokenMs } from './transitionCap';

/** Review of A9: the Drive transition cap comes from measured clip durations plus 3 s. */
describe('the Drive transition cap', () => {
  it('has a measured duration for every guided sentence (re-run scripts/measure-guided-durations.py)', () => {
    const missing = [...allGuidedSentences(), GUIDED_COMMANDS_HINT].filter((s) => GUIDED_CLIP_MS[s] === undefined);
    expect(missing).toEqual([]);
  });

  it('is the measured lines, the listen beat and 3 s of margin', () => {
    const intro = driveIntroLine(5);
    const first = transitionLine(SEGMENTS[0]!, { kind: 'answers', n: 15 }, true);
    const measured = spokenMs(intro) + spokenMs(first);
    // The intro, hint and first line really are about 9 s of recorded speech.
    expect(measured).toBeGreaterThan(7000);
    expect(driveTransitionCapMs([intro, first], 3000)).toBe(measured + 3000 + DRIVE_CAP_MARGIN_MS);
    // A later transition is only its own line.
    expect(driveTransitionCapMs([first], 3000)).toBe(spokenMs(first) + 3000 + DRIVE_CAP_MARGIN_MS);
  });

  it('stretches for a slower voice', () => {
    const first = transitionLine(SEGMENTS[0]!, { kind: 'answers', n: 15 }, true);
    expect(spokenMs(first, 0.5)).toBe(spokenMs(first) * 2);
  });

  it('sums the sentences of a line from the table', () => {
    expect(spokenMs('Guided session. Five minutes.')).toBe(GUIDED_CLIP_MS['Guided session.']! + GUIDED_CLIP_MS['Five minutes.']!);
  });
});
