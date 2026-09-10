import { describe, it, expect, afterEach } from 'vitest';
import { looksLikeAnAttempt, matchSpokenAlternatives, matchVoiceAction, nearestVoiceAction, resolveSpoken, detectVoiceSupport, VOICE_ACTIONS } from './voiceRecognition';

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

/**
 * The car drive of 2026-09-10: iPhone, installed PWA, car microphone.
 *
 * 40 utterances, 18 understood. The failures were not the engine mishearing
 * beyond recognition -- they were the engine ranking an ordinary English word
 * above the command and the app reading only the winner.
 */
describe('what the car actually produced', () => {
  /**
   * Verbatim from the probe log. `heard` is what the app acted on; `alts` are
   * the runners-up it never looked at.
   */
  it('rescues the command the engine ranked second', () => {
    expect(matchSpokenAlternatives(['Band', 'Send', 'Stand'])).toBe('stand');
    expect(matchSpokenAlternatives(['Split send', 'Split sand', 'Split stand'])).toBe('split');
  });

  it('still prefers the winner when the winner is already a command', () => {
    // "No" won at 0.56 with "Now" behind it. The winner must not be displaced.
    expect(matchSpokenAlternatives(['No', 'Now'])).toBe('no');
    expect(matchSpokenAlternatives(['Split', 'Dead split', 'Head split'])).toBe('split');
  });

  /**
   * The guard. This is the operator narrating a steering-wheel test, and it
   * has to stay rejected no matter what the engine offers behind it -- a
   * sentence is someone talking, not someone answering.
   */
  it('refuses to rescue a command out of a sentence', () => {
    const narration = "I'm pressing button for a lot of buttons now bud is being great";
    expect(matchSpokenAlternatives([narration, 'hit', 'stand'])).toBe(null);
    expect(matchSpokenAlternatives(['How was your dad', 'no'])).toBe(null);
    expect(matchSpokenAlternatives(["That's on her head", 'hit'])).toBe(null);
  });

  it('refuses a rescue that is itself a sentence', () => {
    expect(matchSpokenAlternatives(['Sweat', 'i think you should split'])).toBe(null);
  });

  it('keeps the ranking the engine gave, rather than picking a favourite', () => {
    // "no" is offered ahead of "hit"; the engine's order decides.
    expect(matchSpokenAlternatives(['Nnn', 'no', 'hit'])).toBe('no');
    expect(matchSpokenAlternatives(['Nnn', 'hit', 'no'])).toBe('hit');
  });

  it('is unchanged where there is only one guess', () => {
    expect(matchSpokenAlternatives(['stand'])).toBe('stand');
    expect(matchSpokenAlternatives(['banana'])).toBe(null);
    expect(matchSpokenAlternatives([])).toBe(null);
  });
});

/**
 * From the same drive: "Hit that again" was graded REPEAT, because "again" is
 * an alias for repeat and the rule took the last token. The operator had asked
 * to hit, and got the previous card read back instead.
 */
describe('an action outranks a word about an action', () => {
  it('plays the hand rather than repeating the question', () => {
    expect(matchVoiceAction('Hit that again')).toBe('hit');
    expect(matchVoiceAction('yes hit')).toBe('hit');
    expect(matchVoiceAction('no, stand')).toBe('stand');
  });

  it('still hears a meta-word said on its own', () => {
    expect(matchVoiceAction('again')).toBe('repeat');
    expect(matchVoiceAction('Repeat')).toBe('repeat');
    expect(matchVoiceAction('no')).toBe('no');
    expect(matchVoiceAction('yes')).toBe('yes');
  });

  it('still takes the last of two actions, which is the correction', () => {
    expect(matchVoiceAction('stand no hit')).toBe('hit');
    expect(matchVoiceAction('hit sorry stand')).toBe('stand');
  });

  // Verbatim, and they graded correctly before -- they must still.
  it('leaves the readings that already worked alone', () => {
    expect(matchVoiceAction('I would hit that')).toBe('hit');
    expect(matchVoiceAction('Snake stand')).toBe('stand');
    expect(matchVoiceAction('Another hit that')).toBe('hit');
    expect(matchVoiceAction('Repeat it')).toBe('repeat');
    expect(matchVoiceAction('No no')).toBe('no');
  });
});

/**
 * The near-miss rule, measured against the drive that motivated it.
 *
 * 22 rejections, most of them the engine landing on an ordinary English word
 * one sound away from the command. Listing each as an alias would never end
 * and would put real English into the vocabulary, which is forbidden.
 */
describe('near-miss matching', () => {
  it('recovers the words the drive actually lost', () => {
    // Verbatim rejections, with the count each came back.
    expect(nearestVoiceAction('read it')).toBe('repeat'); // x3
    expect(nearestVoiceAction('send')).toBe('stand'); // x3
    expect(nearestVoiceAction('selit')).toBe('split'); // x2
    expect(nearestVoiceAction('sand')).toBe('stand'); // x1
  });

  /**
   * THE RULE THAT MAKES THIS SAFE. Dropping vowels reduces "hit", "hat",
   * "hot", "heat" and "height" all to HT, so the three short commands are
   * excluded from near-miss matching entirely: they match exactly or not at
   * all. Without this the vocabulary would swallow half of English.
   */
  it('never approximates its way to a short command', () => {
    for (const word of ['hat', 'hot', 'heat', 'height', 'hut', 'yeast', 'knee', 'gnaw', 'now']) {
      expect(nearestVoiceAction(word), `"${word}" must not become a command`).toBe(null);
    }
  });

  it('leaves ordinary words that are not close enough alone', () => {
    for (const word of [
      'and', 'end', 'hand', 'land', 'brand', 'grand', 'sad', 'said',
      'around', 'about', 'ready', 'right', 'wait', 'great', 'button',
      'buttons', 'good', 'should', 'would', 'could', 'render', 'sender',
    ]) {
      expect(nearestVoiceAction(word), `"${word}" must not become a command`).toBe(null);
    }
  });

  /**
   * The length floor, tested with words that WOULD match without it.
   * "apt" and "opt" reduce to PT, one edit from repeat's RPT -- so a
   * three-letter word would otherwise answer a flashcard.
   */
  it('refuses anything too short to be evidence', () => {
    expect(nearestVoiceAction('apt')).toBe(null);
    expect(nearestVoiceAction('opt')).toBe(null);
    for (const word of ['sad', 'no', 'a', 'the', 'up']) {
      expect(nearestVoiceAction(word)).toBe(null);
    }
  });

  /**
   * A transcript equally close to two commands is not evidence for either,
   * and guessing between them at 70mph is the exact mistake this module
   * exists to avoid.
   */
  it('refuses to choose between two equally close commands', () => {
    // "spot" reduces to SPT, which is exactly one edit from both split (SPLT)
    // and repeat (RPT). Picking either would be a coin toss at 70mph.
    expect(nearestVoiceAction('spot')).toBe(null);
  });
});

/**
 * Provenance. The three ways a word can be understood are different facts
 * about the engine, and flattening them would make the log unable to answer
 * whether the near-miss rule is earning its place.
 */
describe('resolveSpoken', () => {
  it('prefers what was actually said over what was nearly said', () => {
    // "send" is one sound from stand, but a runner-up says "stand" outright.
    expect(resolveSpoken(['send', 'stand'])).toEqual({ action: 'stand', via: 'alternative' });
  });

  it('prefers the winner over any runner-up', () => {
    expect(resolveSpoken(['no', 'stand'])).toEqual({ action: 'no', via: 'direct' });
  });

  it('falls back to a near miss only when nothing said it', () => {
    expect(resolveSpoken(['send', 'sending'])).toEqual({ action: 'stand', via: 'approximate' });
  });

  it('will not approximate out of a sentence', () => {
    const narration = "I'm pressing button for a lot of buttons now bud is being great";
    expect(resolveSpoken([narration])).toBe(null);
    expect(resolveSpoken([narration, 'send'])).toBe(null);
  });

  it('reports a plain match as plain', () => {
    expect(resolveSpoken(['stand'])).toEqual({ action: 'stand', via: 'direct' });
    expect(resolveSpoken(['I would hit that'])).toEqual({ action: 'hit', via: 'direct' });
  });
});

/**
 * Telling an attempt from a conversation.
 *
 * Eyes-free, a rejection is silence, and silence cannot be told apart from a
 * dead microphone -- the drive of 2026-09-10 produced 22 of them. A cue fixes
 * that only if it stays quiet while people talk; length is the signal,
 * because every command is one or two words.
 */
describe('looksLikeAnAttempt', () => {
  it('treats the drive’s failed answers as attempts', () => {
    for (const heard of ['send', 'band', 'sand', 'selit', 'read it', 'read that', 'bad']) {
      expect(looksLikeAnAttempt(heard), `"${heard}" was someone answering`).toBe(true);
    }
  });

  // Verbatim from the same drive, and none of it aimed at the app.
  it('stays silent for conversation', () => {
    for (const heard of [
      'how was your dad',
      "that's on her head",
      "that's another head",
      'how did that',
      "I'm pressing button for a lot of buttons now bud is being great",
    ]) {
      expect(looksLikeAnAttempt(heard), `"${heard}" was conversation`).toBe(false);
    }
  });

  it('says nothing about an empty transcript', () => {
    expect(looksLikeAnAttempt('')).toBe(false);
    expect(looksLikeAnAttempt('   ')).toBe(false);
  });
});
