import { describe, it, expect } from 'vitest';
import { answerPauseDelayMs, nextQuestionDelayMs, NEXT_QUESTION_GAP_MS } from './answerPause';
import { estimateSpeechMs } from './speech';
import { DEFAULT_AUDIO } from '../store/types';

const TC_QUESTION = 'Running count plus fifteen. Five decks remaining';

describe('the answer pause', () => {
  /**
   * The regression, stated as a number.
   *
   * The old code passed `answerPauseMs` straight to `setTimeout` while the
   * question was still being spoken, so the thinking time on offer was the
   * pause MINUS the question. At the shipped default that was about two
   * tenths of a second to convert a true count.
   */
  it('leaves the whole configured pause AFTER the question, not during it', () => {
    const audio = { ...DEFAULT_AUDIO, answerPauseMs: 3000 };
    const spoken = estimateSpeechMs(TC_QUESTION, audio.rate);

    expect(spoken).toBeGreaterThan(2000); // vacuity guard: this question is long
    expect(answerPauseDelayMs(TC_QUESTION, audio)).toBe(spoken + 3000);
    // The failure being prevented: a delay that is merely the raw setting.
    expect(answerPauseDelayMs(TC_QUESTION, audio)).toBeGreaterThan(3000);
  });

  it('scales with the speech rate, because a fast voice finishes sooner', () => {
    const slow = answerPauseDelayMs(TC_QUESTION, { ...DEFAULT_AUDIO, rate: 0.75 });
    const fast = answerPauseDelayMs(TC_QUESTION, { ...DEFAULT_AUDIO, rate: 2 });
    expect(slow).toBeGreaterThan(fast);
  });

  it('still waits out the question when the pause is set to zero', () => {
    // Zero means "no extra thinking time", not "talk over yourself".
    const audio = { ...DEFAULT_AUDIO, answerPauseMs: 0 };
    expect(answerPauseDelayMs(TC_QUESTION, audio)).toBe(estimateSpeechMs(TC_QUESTION, audio.rate));
  });

  it('treats a negative stored pause as zero rather than as a head start', () => {
    const audio = { ...DEFAULT_AUDIO, answerPauseMs: -5000 };
    expect(answerPauseDelayMs(TC_QUESTION, audio)).toBe(estimateSpeechMs(TC_QUESTION, audio.rate));
  });
});

describe('the gap before the next question', () => {
  it('waits out the verdict and then leaves a beat', () => {
    const verdict = 'Wrong. True count plus three.';
    const audio = { ...DEFAULT_AUDIO };
    expect(nextQuestionDelayMs(verdict, audio)).toBe(
      estimateSpeechMs(verdict, audio.rate) + NEXT_QUESTION_GAP_MS,
    );
  });

  it('never runs the next question into the verdict', () => {
    const verdict = 'Correct. True count minus two.';
    expect(nextQuestionDelayMs(verdict, DEFAULT_AUDIO)).toBeGreaterThan(
      estimateSpeechMs(verdict, DEFAULT_AUDIO.rate),
    );
  });
});
