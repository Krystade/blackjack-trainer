import { describe, it, expect } from 'vitest';
import { looksLikeSelfEcho } from './selfEcho';

describe('telling the app apart from the operator', () => {
  it('calls a fragment of what the app is saying an echo', () => {
    expect(looksLikeSelfEcho('correct play was stand', 'Wrong. Correct play was stand. True count was zero.')).toBe(true);
  });

  it('calls a single word of it an echo too, which is the common case', () => {
    expect(looksLikeSelfEcho('Stand', 'Correct play was stand.')).toBe(true);
  });

  it('does not call an answer an echo just because the app is talking', () => {
    // The operator talking over the end of the prompt: this is the utterance
    // that used to vanish in silence, and the one that must earn a cue.
    expect(looksLikeSelfEcho('double', 'Eight and eight, dealer shows six.')).toBe(false);
  });

  it('will not match across a word boundary', () => {
    // "and" is inside "stand", and a substring test without boundaries would
    // suppress the cue for half the vocabulary.
    expect(looksLikeSelfEcho('and', 'Correct play was stand.')).toBe(false);
  });

  it('ignores punctuation and case, because recognition returns neither', () => {
    expect(looksLikeSelfEcho('true count was plus three', 'True count was plus three.')).toBe(true);
  });

  it('says no when the app is not speaking at all', () => {
    expect(looksLikeSelfEcho('stand', null)).toBe(false);
    expect(looksLikeSelfEcho('stand', '')).toBe(false);
  });

  it('says no to an empty utterance rather than matching everything', () => {
    // A bare substring test makes '' a match against any prompt, which would
    // silently disable the cue.
    expect(looksLikeSelfEcho('', 'Correct play was stand.')).toBe(false);
    expect(looksLikeSelfEcho('  ', 'Correct play was stand.')).toBe(false);
  });
});
