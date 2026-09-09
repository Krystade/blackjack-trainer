import { describe, it, expect, afterEach } from 'vitest';
import { matchVoiceAction, detectVoiceSupport, VOICE_ACTIONS } from './voiceRecognition';

/**
 * Matching is the half of voice input that can be tested without a
 * microphone, and it is also the half where a mistake is most dangerous:
 * acting on a misheard word mid-drill grades an answer the operator never
 * gave. So the rule under test throughout is REJECT RATHER THAN GUESS.
 */

describe('matchVoiceAction', () => {
  it('matches every action by its own name', () => {
    for (const action of Object.keys(VOICE_ACTIONS)) {
      expect(matchVoiceAction(action)).toBe(action);
    }
  });

  it('is case- and punctuation-insensitive', () => {
    expect(matchVoiceAction('Hit!')).toBe('hit');
    expect(matchVoiceAction('  STAND.  ')).toBe('stand');
  });

  // Engines mishear short commands in predictable ways; these are the
  // substitutions that actually occur rather than invented ones.
  it('accepts the common mishearings', () => {
    expect(matchVoiceAction('hid')).toBe('hit');
    expect(matchVoiceAction('stan')).toBe('stand');
    expect(matchVoiceAction('dubble')).toBe('double');
    expect(matchVoiceAction('spit')).toBe('split');
    // Observed in real use: "stand" came back as "Stant" and was rejected.
    // It passes the rule that keeps this table safe -- it is a garbled
    // non-word, not something anyone says in conversation.
    expect(matchVoiceAction('stant')).toBe('stand');
  });

  /**
   * Engines routinely prepend filler. The operator's answer is what they said
   * LAST, so "uh, stand" is a stand -- but a first-token match would read the
   * filler instead.
   */
  it('takes the last recognised word, not the first', () => {
    expect(matchVoiceAction('uh stand')).toBe('stand');
    expect(matchVoiceAction('okay hit')).toBe('hit');
    // The dangerous case: a correction. "hit no stand" must be a stand.
    expect(matchVoiceAction('hit no stand')).toBe('stand');
  });

  // A two-word alias must beat its own trailing token, which means nothing.
  it('prefers a whole-phrase alias over its last word', () => {
    expect(matchVoiceAction('double down')).toBe('double');
  });

  /**
   * The safety property. Anything unrecognised is REJECTED so the caller can
   * ask again -- never coerced to a nearest guess, which would grade an
   * answer the operator did not give.
   */
  it('rejects rather than guesses', () => {
    for (const junk of ['', '   ', 'banana', 'what', 'hmm', '12345', 'stand up and hit the road maybe']) {
      const out = matchVoiceAction(junk);
      if (junk.includes('hit') || junk.includes('stand')) continue; // that one legitimately contains commands
      expect(out).toBe(null);
    }
    expect(matchVoiceAction('banana')).toBe(null);
    expect(matchVoiceAction('')).toBe(null);
  });

  it('does not match a word merely containing a command as a substring', () => {
    // "hitting" is not "hit"; matching substrings would fire on stray speech.
    expect(matchVoiceAction('hitting')).toBe(null);
    expect(matchVoiceAction('understand')).toBe(null);
  });

  /**
   * Every transcript from the first real-device probe run, with the verdict
   * each one SHOULD get. Recorded verbatim, including the casing and the
   * swearing, because invented test phrases are exactly what let the bug
   * below through: nothing anyone writes on purpose looks like line 11.
   *
   * That line -- "damn this shit works really well does it" -- was graded as
   * a HIT, because "it" was listed as a mishearing of "hit". A recogniser
   * transcribes the whole room, so an alias that is also an ordinary English
   * word will eventually play a hand nobody asked for.
   */
  it('gives the right verdict on every transcript from the device probe', () => {
    const captured: Array<[string, string | null]> = [
      ['hello', null],
      ['hit', 'hit'],
      ['stand hold', 'stand'],
      ['double', 'double'],
      ['hit hit hit hit hit stand HIT stand hold double double', 'double'],
      ['Split', 'split'],
      ['surrender', 'surrender'],
      ['test', null],
      ['oh wow okay', null],
      ['damn this shit works really well does it', null],
      ['welcome home', null],
      ['yippee', null],
      ['okay minimize', null],
      ['typing in a different window', null],
    ];
    for (const [heard, expected] of captured) {
      expect(matchVoiceAction(heard), `heard: "${heard}"`).toBe(expected);
    }
  });

  /**
   * The rule that keeps the table safe, enforced rather than remembered.
   *
   * An alias is allowed to be a command word or a garbled non-word. It is not
   * allowed to be a word that turns up in ordinary speech, because the
   * microphone is open to the whole room and every such alias is a latent
   * misfire. This list is the filler heard in one two-minute probe run.
   */
  it('lists no alias that is an ordinary conversational word', () => {
    const conversational = [
      'it', 'is', 'a', 'the', 'and', 'so', 'well', 'okay', 'oh', 'this',
      'that', 'does', 'up', 'down', 'one', 'two', 'to', 'too', 'go', 'do',
    ];
    for (const word of conversational) {
      expect(matchVoiceAction(word), `"${word}" must not be an action`).toBe(null);
    }
  });
});

describe('detectVoiceSupport', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else delete (globalThis as { window?: unknown }).window;
  });

  it('reports none when the API is absent', () => {
    Object.defineProperty(globalThis, 'window', { value: {}, configurable: true, writable: true });
    expect(detectVoiceSupport()).toMatchObject({ api: false, flavour: 'none' });
  });

  it('reports the vendor flavour it found', () => {
    Object.defineProperty(globalThis, 'window', {
      value: { webkitSpeechRecognition: function () {} },
      configurable: true,
      writable: true,
    });
    expect(detectVoiceSupport()).toMatchObject({ api: true, flavour: 'webkit' });
  });

  it('prefers the unprefixed API when both exist', () => {
    Object.defineProperty(globalThis, 'window', {
      value: { SpeechRecognition: function () {}, webkitSpeechRecognition: function () {} },
      configurable: true,
      writable: true,
    });
    expect(detectVoiceSupport().flavour).toBe('standard');
  });

  it('is safe with no window at all', () => {
    delete (globalThis as { window?: unknown }).window;
    expect(() => detectVoiceSupport()).not.toThrow();
  });
});
