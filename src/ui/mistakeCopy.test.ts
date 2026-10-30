import { describe, it, expect } from 'vitest';
import { classCopyFor, CLASS_COPY } from './mistakeCopy';
import { correctPlay } from '../engine/strategy';
import { DEFAULT_RULES } from '../engine/ruleset';

/**
 * R2 (review of C11): at TC 0 with a negative running count, Play's miss
 * note said "the true count had passed the index" beside "TC +0". When the
 * running count decided the cell, the note says so.
 */
describe('the miss note names the count that decided', () => {
  const ctx = { canDouble: true, canSplit: true, canSurrender: false };
  const rcReason = correctPlay([{ rank: '10', suit: 's' }, { rank: '2', suit: 's' }], '4', 0, ctx, DEFAULT_RULES, -3).reason;

  it('a running-count rule gets running-count notes', () => {
    expect(classCopyFor('missed-deviation', rcReason).note).toBe(
      'Basic strategy is right at a running count of 0 or more, but the running count was negative, which decides this index whatever the true count rounds to.',
    );
    expect(classCopyFor('phantom-deviation', rcReason).note).toBe(
      'You deviated, but the running count was negative, so this index did not apply, whatever the true count rounds to.',
    );
    expect(classCopyFor('missed-deviation', rcReason).label).toBe(CLASS_COPY['missed-deviation'].label);
  });

  it('any other reason keeps the true-count notes', () => {
    expect(classCopyFor('missed-deviation', '12 v 4: stand at TC ≥ 0; hit below')).toEqual(CLASS_COPY['missed-deviation']);
    expect(classCopyFor('basic-error', rcReason)).toEqual(CLASS_COPY['basic-error']);
    expect(classCopyFor('phantom-deviation', undefined)).toEqual(CLASS_COPY['phantom-deviation']);
  });
});
