import { describe, it, expect } from 'vitest';
import { parseCountSpeech, speakableCount, MAX_COUNT } from './voiceNumber';

/**
 * The count is the one answer where being wrong is invisible: a misheard
 * "hit" costs a hand and is obvious, a misheard count silently corrupts the
 * session's score. Everything here therefore either produces a PROPOSAL that
 * will be read back, or refuses.
 */

describe('stating a value', () => {
  it('reads a plain number', () => {
    expect(parseCountSpeech('seven')).toEqual({ kind: 'value', value: 7 });
    expect(parseCountSpeech('zero')).toEqual({ kind: 'value', value: 0 });
    expect(parseCountSpeech('twenty')).toEqual({ kind: 'value', value: 20 });
  });

  it('reads digits, which is how engines usually return numbers', () => {
    expect(parseCountSpeech('12')).toEqual({ kind: 'value', value: 12 });
    expect(parseCountSpeech('-3')).toEqual({ kind: 'value', value: -3 });
  });

  /**
   * The distinction the whole design rests on: a sign word BESIDE a number
   * names the value, while a sign word alone nudges. Collapse these and
   * "minus three" would walk the count down three instead of setting it.
   */
  it('treats a sign next to a number as the value, not as nudges', () => {
    expect(parseCountSpeech('minus three')).toEqual({ kind: 'value', value: -3 });
    expect(parseCountSpeech('plus five')).toEqual({ kind: 'value', value: 5 });
    expect(parseCountSpeech('negative twelve')).toEqual({ kind: 'value', value: -12 });
  });

  it('ignores the filler engines pad short answers with', () => {
    expect(parseCountSpeech("uh, it's minus three")).toEqual({ kind: 'value', value: -3 });
    expect(parseCountSpeech('the count is four')).toEqual({ kind: 'value', value: 4 });
  });

  // Said while a prompt is open and read back before it counts, so a
  // substitution that would be reckless in conversation is safe here.
  it('accepts the substitutions engines make for spoken digits', () => {
    expect(parseCountSpeech('ate')).toEqual({ kind: 'value', value: 8 });
    expect(parseCountSpeech('tree')).toEqual({ kind: 'value', value: 3 });
    expect(parseCountSpeech('minus for')).toEqual({ kind: 'value', value: -4 });
  });

  it('refuses a count too large to be real', () => {
    expect(parseCountSpeech(String(MAX_COUNT + 1))).toBe(null);
  });

  // Two numbers in one breath is a sentence, not an answer, and guessing
  // which was meant is exactly the guess this must not make.
  it('refuses two numbers rather than picking one', () => {
    expect(parseCountSpeech('three four')).toBe(null);
  });
});

describe('nudging by one', () => {
  it('moves by one per sign word', () => {
    expect(parseCountSpeech('plus')).toEqual({ kind: 'adjust', delta: 1 });
    expect(parseCountSpeech('minus')).toEqual({ kind: 'adjust', delta: -1 });
  });

  // The operator's shorthand: three taps up, said rather than tapped.
  it('accumulates repeats, so "plus plus plus" is three', () => {
    expect(parseCountSpeech('plus plus plus')).toEqual({ kind: 'adjust', delta: 3 });
    expect(parseCountSpeech('minus minus')).toEqual({ kind: 'adjust', delta: -2 });
  });

  /**
   * A nudge that nets to nothing is not a request. Refusing says so out loud;
   * returning a zero-delta adjustment would silently do nothing to a value
   * that is about to be submitted.
   */
  it('refuses a nudge that cancels itself out', () => {
    expect(parseCountSpeech('plus minus')).toBe(null);
  });
});

describe('refusing', () => {
  it('rejects speech with no count in it at all', () => {
    for (const junk of ['', '   ', 'what was that', 'hit', 'hello']) {
      expect(parseCountSpeech(junk)).toBe(null);
    }
  });

  // "no" is the retry word at the confirmation step and must never be read as
  // a value -- "none" is zero, "no" is not.
  it('does not read a refusal as a number', () => {
    expect(parseCountSpeech('no')).toBe(null);
    expect(parseCountSpeech('nope')).toBe(null);
  });
});

/**
 * The read-back is the safety net for everything above, so the sign has to
 * survive it. Voices render "-3" inconsistently and sometimes drop the minus
 * entirely, which would turn the confirmation into a trap.
 */
describe('speaking a value back', () => {
  it('says the sign as a word', () => {
    expect(speakableCount(-3)).toBe('minus 3');
    expect(speakableCount(5)).toBe('plus 5');
  });

  it('says zero as zero, not as plus nothing', () => {
    expect(speakableCount(0)).toBe('zero');
  });
});
