import { describe, it, expect } from 'vitest';
import {
  dealerErrorsValue,
  dealerMistakesOn,
  foulVerdictText,
  missedErrorText,
  sessionDealerErrors,
  sessionsDealerErrors,
} from './dealerErrorCopy';
import { sessionRowFor } from './sessionRow';
import { EMPTY_DEALER_ERROR_TALLY } from '../engine/dealerErrors';
import type { Stats } from '../store/types';

type Row = Stats['sessions'][number];
const row = (extra: Partial<Row> = {}): Row => ({ date: '2026-10-17', rounds: 10, graded: 10, correct: 9, bankrollDelta: 0, ...extra });

describe('G2: dealer-error copy', () => {
  it('the setting is off unless set, and always off eyes-free', () => {
    expect(dealerMistakesOn({}, false)).toBe(false);
    expect(dealerMistakesOn({ dealerMistakes: true }, false)).toBe(true);
    expect(dealerMistakesOn({ dealerMistakes: true }, true)).toBe(false);
  });

  it('words the verdicts', () => {
    expect(foulVerdictText({ correct: true, error: { kind: 'overpay' } as never })).toBe(
      'Foul called. The dealer overpaid your win by 1 unit. Payout corrected.',
    );
    expect(foulVerdictText({ correct: false, error: null })).toBe('No foul: that payout was right.');
    expect(missedErrorText({ kind: 'pay-push' })).toBe('Missed: last hand the dealer paid your push as a win.');
    expect(missedErrorText({ kind: 'take-win' })).toContain('took your winning hand');
    expect(missedErrorText({ kind: 'underpay' })).toContain('underpaid');
  });

  it('caught of made, with false calls beside it', () => {
    expect(dealerErrorsValue({ made: 3, caught: 2, falseCalls: 0 })).toBe('2/3');
    expect(dealerErrorsValue({ made: 3, caught: 2, falseCalls: 1 })).toBe('2/3 · 1 false call');
    expect(dealerErrorsValue({ made: 0, caught: 0, falseCalls: 2 })).toBe('0/0 · 2 false calls');
  });

  it('the session row carries the tally only for a session played with the setting on', () => {
    expect(sessionDealerErrors(EMPTY_DEALER_ERROR_TALLY, false)).toEqual({});
    expect(sessionDealerErrors(EMPTY_DEALER_ERROR_TALLY, true)).toEqual({ dealerErrors: { made: 0, caught: 0, falseCalls: 0 } });
    const t = { made: 2, caught: 1, missed: 1, falseCalls: 1 };
    expect(sessionDealerErrors(t, true)).toEqual({ dealerErrors: { made: 2, caught: 1, falseCalls: 1 } });
    const input = {
      id: 's-1', date: '2026-10-17', rounds: 3, hands: 3, events: [], bankrollDelta: 1,
      profileId: 'p', profileName: 'P', peeks: 0, hotShoe: false, provisional: false,
    };
    expect(sessionRowFor({ ...input, ...sessionDealerErrors(t, true) }).dealerErrors).toEqual({ made: 2, caught: 1, falseCalls: 1 });
    expect('dealerErrors' in sessionRowFor({ ...input, ...sessionDealerErrors(EMPTY_DEALER_ERROR_TALLY, false) })).toBe(false);
  });

  it('Stats pools only the sessions that played with it, and none is null', () => {
    expect(sessionsDealerErrors([row(), row()])).toBeNull();
    expect(
      sessionsDealerErrors([
        row({ dealerErrors: { made: 2, caught: 1, falseCalls: 0 } }),
        row(),
        row({ dealerErrors: { made: 3, caught: 3, falseCalls: 2 } }),
      ]),
    ).toEqual({ made: 5, caught: 4, falseCalls: 2 });
    // Junk in storage counts as nothing rather than NaN.
    expect(
      sessionsDealerErrors([row({ dealerErrors: { made: Number.NaN, caught: -1, falseCalls: 1 } as never })]),
    ).toEqual({ made: 0, caught: 0, falseCalls: 1 });
  });
});
