import { describe, it, expect } from 'vitest';
import { affirmsProposal, parseCountSpeech, speakableCount, MAX_COUNT } from './voiceNumber';

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

describe('A7: filler, homophones and dashes', () => {
  it('treats "oh" as filler when anything else was said', () => {
    expect(parseCountSpeech('Oh, minus three')).toEqual({ kind: 'value', value: -3 });
    expect(parseCountSpeech('Oh, plus')).toEqual({ kind: 'adjust', delta: 1 });
    expect(parseCountSpeech('oh')).toEqual({ kind: 'value', value: 0 });
  });

  it('does not hear numbers in ordinary talk', () => {
    expect(parseCountSpeech('go for it')).toBe(null);
    expect(parseCountSpeech('I want to')).toBe(null);
    expect(parseCountSpeech('oh no')).toBe(null);
    expect(parseCountSpeech('I won')).toBe(null);
  });

  it('still takes a homophone alone or right after a sign', () => {
    expect(parseCountSpeech('for')).toEqual({ kind: 'value', value: 4 });
    expect(parseCountSpeech('minus for')).toEqual({ kind: 'value', value: -4 });
    expect(parseCountSpeech('plus to')).toEqual({ kind: 'value', value: 2 });
    // A real number word next to a homophone is one number, not two.
    expect(parseCountSpeech('it was too minus three')).toEqual({ kind: 'value', value: -3 });
  });

  it('reads a typographic minus or a spaced one as the sign', () => {
    expect(parseCountSpeech('\u22123')).toEqual({ kind: 'value', value: -3 });
    expect(parseCountSpeech('\u2013 3')).toEqual({ kind: 'value', value: -3 });
    expect(parseCountSpeech('- 3')).toEqual({ kind: 'value', value: -3 });
  });

  it('"yes, minus three" confirms a standing minus three', () => {
    expect(affirmsProposal(['yes, minus three'], -3)).toBe(true);
    expect(affirmsProposal(['Yeah -3'], -3)).toBe(true);
    expect(affirmsProposal(['yes'], 2)).toBe(true);
    // A different number is a correction, not a yes.
    expect(affirmsProposal(['yes, minus four'], -3)).toBe(false);
    expect(affirmsProposal(['minus three'], -3)).toBe(false);
    expect(affirmsProposal(['yes minus three'], null)).toBe(false);
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

describe('affirmsProposal is never the readback itself (review of A7)', () => {
  it('a late "Correct" fragment of "minus 3. Correct?" does not confirm', () => {
    expect(affirmsProposal(['Correct'], -3)).toBe(false);
    expect(affirmsProposal(['correct minus 3'], -3)).toBe(false);
  });

  it("a passenger's \"okay\" does not confirm", () => {
    expect(affirmsProposal(['okay'], -3)).toBe(false);
    expect(affirmsProposal(['ok'], -3)).toBe(false);
  });

  it('"yes, minus three" still does', () => {
    expect(affirmsProposal(['yes minus 3'], -3)).toBe(true);
  });
});
