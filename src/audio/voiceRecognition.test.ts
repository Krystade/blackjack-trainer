import { describe, it, expect, afterEach } from 'vitest';
import type { VoiceAction } from './voiceRecognition';
import { SPOKEN_FORM, looksLikeAnAttempt, matchSpokenAlternatives, matchVoiceAction, nearestVoiceAction, resolveSpoken, detectVoiceSupport, setUserVoiceAliases, voicePhrases, VOICE_ACTIONS } from './voiceRecognition';

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
      // A dictation dump naming three different commands with no retraction:
      // it was graded 'double' (last wins) until 2026-10-05, and is rejected now.
      ['hit hit hit hit hit stand HIT stand hold double double', null],
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

  /**
   * Reported 2026-09-11: a spoken count that missed earned no cue, because the
   * only test was length and an answer is often three words.
   */
  it('treats a longer try at a count as an attempt', () => {
    for (const heard of [
      "it's minus three",
      'minus three please',
      'uh plus fourteen',
      'i think minus two',
      'negative six yeah',
    ]) {
      expect(looksLikeAnAttempt(heard), `"${heard}" was someone answering`).toBe(true);
    }
  });

  /**
   * The reason the widening is on content and not on length. Both of these are
   * verbatim conversation from the 2026-09-10 drive and sit inside the longer
   * limit -- only the absence of a count keeps them quiet.
   */
  it('still stays silent for conversation of the same length', () => {
    for (const heard of ['how did that', 'how was your dad', "that's on her head"]) {
      expect(looksLikeAnAttempt(heard), `"${heard}" was conversation`).toBe(false);
    }
  });

  /** A count mentioned in a whole sentence is someone talking, not answering. */
  it('does not chime at a sentence that merely contains a number', () => {
    expect(looksLikeAnAttempt('we are about five minutes away from the exit')).toBe(false);
  });

  it('says nothing about an empty transcript', () => {
    expect(looksLikeAnAttempt('')).toBe(false);
    expect(looksLikeAnAttempt('   ')).toBe(false);
  });
});


/**
 * A SENTENCE IS NOT AN ANSWER, when the only thing matching in it is a "no".
 *
 * 2026-10-02, 19:00:32, with Jack telling the app its audio was broken:
 *
 *   heard="Ignored the app was speaking you're not saying anything
 *          there's no audio coming out"   -> verdict=no
 *
 * Thirteen words graded as an answer. "Yes" and "no" are among the commonest
 * words in English and the only two in the vocabulary that are; an action word
 * is not, which is why the gate is on the meta-words alone.
 */
describe('a meta-word only answers when the transcript is short', () => {
  it('refuses a "no" buried in a sentence', () => {
    expect(
      matchVoiceAction("Ignored the app was speaking you're not saying anything there's no audio coming out"),
    ).toBeNull();
  });

  it('refuses a "yes" buried in a sentence', () => {
    expect(matchVoiceAction('well yes I suppose that is what it sounded like')).toBeNull();
  });

  it('still takes a plain one or two word answer', () => {
    expect(matchVoiceAction('no')).toBe('no');
    expect(matchVoiceAction('nope')).toBe('no');
    expect(matchVoiceAction('uh yes')).toBe('yes');
    expect(matchVoiceAction('yeah okay')).toBe('yes');
    expect(matchVoiceAction('say again')).toBe('repeat');
  });

  it('still takes an ACTION however long the transcript', () => {
    // The other half, and the half that would cost a real play. "Stand" and
    // "surrender" are not words a passenger says in a car, so one buried in a
    // long transcript is still the answer -- and throwing it away makes the
    // drill sit in silence, which is what a dead microphone sounds like.
    expect(matchVoiceAction('um I think I am going to have to stand')).toBe('stand');
    expect(matchVoiceAction('okay well in that case let us double down')).toBe('double');
  });
});

/**
 * The operator's own aliases, consulted alongside the shipped ones.
 *
 * The shipped table guesses which mishearings are likely; Jack's drives show
 * it guessing wrong, and the true mapping is not recoverable from a log --
 * `heard=` is the engine's output, never what was said. So these come from
 * the person who spoke.
 */
describe('aliases the operator added', () => {
  afterEach(() => {
    setUserVoiceAliases({});
  });

  it('maps a word the shipped table has never heard of', () => {
    // Straight from his log: `heard=Strength verdict=rejected`, twice. The
    // consonant-skeleton fuzzer cannot save this one -- STRNGTH against STND
    // is more than one edit -- so nothing but a person saying "that meant
    // stand" will do.
    expect(matchVoiceAction('strength')).toBeNull();
    setUserVoiceAliases({ strength: 'stand' });
    expect(matchVoiceAction('strength')).toBe('stand');
  });

  it('matches inside a sentence, as the shipped aliases do', () => {
    setUserVoiceAliases({ strength: 'stand' });
    expect(matchVoiceAction('I think strength')).toBe('stand');
  });

  it('prefers a two-word alias over its own last token', () => {
    // The same rule the built-ins need for "double down": a phrase must win
    // over a token inside it, or the phrase is unreachable.
    setUserVoiceAliases({ 'stand pat': 'stand', pat: 'hit' });
    expect(matchVoiceAction('stand pat')).toBe('stand');
  });

  it('does not let a stale alias outlive the setting', () => {
    // A cleared setting must clear the behaviour, or the operator cannot undo
    // a word that turned out to fire in conversation.
    setUserVoiceAliases({ strength: 'stand' });
    setUserVoiceAliases({});
    expect(matchVoiceAction('strength')).toBeNull();
  });

  it('never lets a user alias shadow a shipped command', () => {
    /*
     * The asymmetry is deliberate. If "hit" could be rebound to STAND by a
     * typo in a settings field, the operator would say the most common word
     * in the game and watch the app do the opposite, with nothing on screen
     * to explain it. The shipped vocabulary is the floor.
     */
    setUserVoiceAliases({ hit: 'stand' });
    expect(matchVoiceAction('hit')).toBe('hit');
  });

  it('is reported in the phrase list, so the echo guard stays correct', () => {
    /*
     * audio/selfEcho.ts sizes its "too long to be a command" rule against
     * VOICE_PHRASES. A user alias that the list did not know about would sit
     * outside that calculation, and the app could start grading its own
     * prompt as an answer -- so the list has to include them.
     */
    setUserVoiceAliases({ 'stand pat': 'stand' });
    expect(voicePhrases()).toContain('stand pat');
  });
});

/**
 * THE CONSONANT SKELETON, pinned.
 *
 * `skeleton()` carried a line that read `.replace(/(.)+/g, '$1')` in every
 * editor and was in fact `.replace(/(.)\x01+/g, '$1')` -- a raw 0x01 control
 * byte where `\1` was meant. The byte made the line a no-op, which is the only
 * reason the matcher worked: written as it APPEARED, the pattern matches the
 * whole string greedily and `$1` is the last capture, so every skeleton
 * collapses to its final consonant.
 *
 * Measured, before the line was removed:
 *
 *   stand -> d      good -> d      said -> d
 *   well  -> l      double -> l
 *   sure  -> r      surrender -> r
 *
 * which makes "good", "said" and "stand" an exact match for one another. That
 * is the "it" bug -- an ordinary English word silently playing a hand -- for a
 * whole family of words at once, one invisible keystroke away.
 *
 * So these cases exist to fail loudly if the collapse ever comes back, whether
 * by a formatter, a paste, or somebody tidying a regex that looks redundant.
 * They assert through the public matcher rather than the private helper,
 * because what matters is the hand that gets played.
 */
describe('the consonant skeleton cannot swallow ordinary words', () => {
  it('still reaches the command it was built for', () => {
    // The near-miss rule earning its keep: the engine heard the consonants
    // and landed one edit away.
    expect(nearestVoiceAction('send')).toBe('stand');
  });

  it('does not take ordinary four-letter words as commands', () => {
    // Each of these collapses to the same single letter as a real command
    // under the broken pattern, and would be graded as a play.
    expect(nearestVoiceAction('good')).toBeNull();
    expect(nearestVoiceAction('said')).toBeNull();
    expect(nearestVoiceAction('well')).toBeNull();
    expect(nearestVoiceAction('food')).toBeNull();
    expect(nearestVoiceAction('mind')).toBeNull();
    expect(nearestVoiceAction('cool')).toBeNull();
    expect(nearestVoiceAction('sure')).toBeNull();
  });

  it('keeps the long commands distinguishable from each other', () => {
    // If skeletons collapsed, these would all be one letter and the
    // tie-cancel in nearestVoiceAction would fire on every utterance.
    expect(nearestVoiceAction('surrenda')).toBe('surrender');
    expect(nearestVoiceAction('spalit')).toBe('split');
  });
});

describe('the form the app asks for', () => {
  /*
   * MEASURED IN THE CAR, 2026-10-06, parked with Bluetooth on and the Corolla's
   * own microphone at 8kHz. Two rounds of ten:
   *
   *   one-word 3/10   two-word 8/10
   *
   * Per command, two-word was at least as good every time: "hit me" 2/2
   * against "hit" 0/2 (which was never heard AT ALL -- `offered=0`, twice,
   * each after a retry), "stand pat" 2/2 against 1/2, "double down" 1/2
   * against 0/2, "surrender this" 2/2 against 1/2. "split them" and "split"
   * tied at 1/2, so that one is a coin flip at this sample size and is carried
   * by the uniform rule rather than by its own evidence.
   *
   * The roadmap's decision table pre-registered this outcome: two-word becomes
   * the documented default, one-word stays as an alias. Nothing about matching
   * changes -- both still work -- only what the app tells him to say.
   */
  it('asks for the two-word form of every action it measured', () => {
    expect(SPOKEN_FORM.hit).toBe('hit me');
    expect(SPOKEN_FORM.stand).toBe('stand pat');
    expect(SPOKEN_FORM.double).toBe('double down');
    expect(SPOKEN_FORM.split).toBe('split them');
    expect(SPOKEN_FORM.surrender).toBe('surrender this');
  });

  it('leaves yes, no and repeat alone, because the car never measured them', () => {
    // The calibrate step asks for the five hand actions only. Changing an
    // unmeasured word on the strength of a result about other words would be
    // inventing evidence.
    expect(SPOKEN_FORM.yes).toBe('yes');
    expect(SPOKEN_FORM.no).toBe('no');
    expect(SPOKEN_FORM.repeat).toBe('repeat');
  });

  it('never asks for a phrase its own matcher would reject', () => {
    /*
     * THE ONE INVARIANT THAT MUST HOLD. This record is printed on the drill
     * screen as "Say: ..." -- an eyes-free instruction at the wheel. A phrase
     * here that the matcher does not accept would have him repeating a word
     * the app itself cannot take, with no way to tell why.
     */
    for (const [action, phrase] of Object.entries(SPOKEN_FORM)) {
      expect(matchVoiceAction(phrase), `the app asks for "${phrase}" and rejects it`).toBe(action);
    }
  });
});

describe('a two-word form for every command', () => {
  /*
   * WHY THESE EXIST. iOS hardcodes `taskHint` to Dictation -- a long-form
   * prose model -- and nothing on the web can change it. A bare monosyllable
   * is that model's worst case. The room test of 2026-10-05 is the cleanest
   * evidence: quiet room, the phone's own wideband microphone, and
   * `audiostart afterStartMs=0` so nothing was clipped, and "hit" still came
   * back as "Add". These give the model the shape it was built for.
   */
  const COMMANDS: VoiceAction[] = ['hit', 'stand', 'double', 'split', 'surrender', 'yes', 'no', 'repeat'];

  it('offers one for every command, so none is left on a bare syllable', () => {
    for (const command of COMMANDS) {
      const twoWord = voicePhrases().filter(
        (p) => p.includes(' ') && matchVoiceAction(p) === command,
      );
      expect(twoWord.length, `no two-word form for "${command}"`).toBeGreaterThan(0);
    }
  });

  it('keeps every phrase inside the echo guard', () => {
    /*
     * `selfEcho.ts` never dismisses a transcript shorter than ECHO_MIN_WORDS
     * as the app's own voice, so a three-word command would leave the app
     * unable to tell its own prompt from an answer -- and it would then grade
     * its own corrections. The cap is two words, and it is a correctness
     * boundary rather than a style rule.
     */
    for (const phrase of voicePhrases()) {
      expect(phrase.trim().split(/\s+/).length, `"${phrase}" is too long`).toBeLessThanOrEqual(2);
    }
  });

  it('matches the two-word forms as the command they stand for', () => {
    // Through `matchVoiceAction`, the entry the drill screens actually call.
    // An earlier draft asserted through `nearestVoiceAction`, which is the
    // consonant-skeleton FUZZY matcher and only ever answers from
    // FUZZY_TARGETS -- so it could not see an alias at all and the test
    // failed for a reason that had nothing to do with the aliases.
    expect(matchVoiceAction('hit me')).toBe('hit');
    expect(matchVoiceAction('stand pat')).toBe('stand');
    expect(matchVoiceAction('split them')).toBe('split');
    expect(matchVoiceAction('yes please')).toBe('yes');
    expect(matchVoiceAction('no thanks')).toBe('no');
    expect(matchVoiceAction('double down')).toBe('double');
    expect(matchVoiceAction('say again')).toBe('repeat');
  });
});

/**
 * 2026-10-05, Flashcards, a pair of sevens. The engine returned
 *   heard="But" conf=0.353, six alternatives, the runners-up scoring 0.149 and below
 * and the app played SPLIT ("split (approximate)"). The winner "But" is three
 * letters and cannot approximate anything; the split came from a RUNNER-UP
 * that was one consonant away from SPLT. A second opinion at 0.149 confidence
 * must never be allowed to play a hand on consonants alone.
 */
describe('a runner-up cannot play a hand on consonants alone', () => {
  it('rejects the real "But" utterance whatever its runners-up are', () => {
    // Runners-up reduce to one edit from split / stand / double / surrender.
    for (const alt of ['Plot', 'Spot', 'Slit', 'Sand', 'Bill', 'Spilt', 'Splat']) {
      expect(resolveSpoken(['But', alt, 'Bud', 'Butt']), `alt "${alt}"`).toBe(null);
      expect(matchSpokenAlternatives(['But', alt])).toBe(null);
    }
  });

  it('still lets a runner-up that SAYS a command rescue the winner', () => {
    expect(resolveSpoken(['But', 'Split'])).toEqual({ action: 'split', via: 'alternative' });
    expect(resolveSpoken(['Band', 'Send', 'Stand'])).toEqual({ action: 'stand', via: 'alternative' });
  });

  it('still approximates from the winner itself', () => {
    expect(resolveSpoken(['send', 'xyz'])).toEqual({ action: 'stand', via: 'approximate' });
    expect(resolveSpoken(['selit'])).toEqual({ action: 'split', via: 'approximate' });
  });
});

describe('ordinary words cannot approximate a hand-playing command', () => {
  it('needs a skeleton long enough that one edit means something', () => {
    // DBL is three letters, so one edit reaches all of these.
    for (const word of ['bill', 'deal', 'dial', 'able', 'dull', 'bold', 'build', 'doll']) {
      expect(nearestVoiceAction(word), `"${word}"`).toBe(null);
    }
    // A skeleton of two letters is never enough on its own.
    // "upto" is PT, one edit from RPT; only the length floor stops it.
    for (const word of ['upto', 'but', 'bat', 'beat', 'bait', 'boot']) {
      expect(nearestVoiceAction(word), `"${word}"`).toBe(null);
    }
  });

  it('keeps the exact-skeleton rescue for double, and the repeat near-miss', () => {
    expect(nearestVoiceAction('doable')).toBe('double');
    expect(nearestVoiceAction('read it')).toBe('repeat');
  });
});

/**
 * "Stand hit hit hit" was graded hit, "Split them surrender" surrender, and
 * the 2026-10-05 phone log had both. Last-word-wins is right for a CORRECTION
 * ("hit no stand") and wrong for a stutter or a list, and the two differ in
 * one observable way: a correction carries a retraction word between the
 * commands. No marker, no play: the cost is saying one word again.
 */
describe('a transcript naming several different commands', () => {
  it('is rejected when nothing says one retracts the other', () => {
    expect(matchVoiceAction('Stand hit hit hit')).toBe(null);
    expect(matchVoiceAction('Split them surrender')).toBe(null);
    expect(matchVoiceAction('hit stand')).toBe(null);
    expect(resolveSpoken(['Stand hit hit hit'])).toBe(null);
    expect(resolveSpoken(['Split them surrender', 'surrender'])).toBe(null);
    expect(resolveSpoken(['hit stand', 'stand'])).toBe(null);
  });

  it('keeps the last command when a retraction sits between', () => {
    expect(matchVoiceAction('hit no stand')).toBe('stand');
    expect(matchVoiceAction('hit sorry stand')).toBe('stand');
    expect(matchVoiceAction('stand no hit')).toBe('hit');
    expect(matchVoiceAction('split wait surrender')).toBe('surrender');
  });

  it('does not touch repeats of the same command', () => {
    expect(matchVoiceAction('hit hit hit')).toBe('hit');
    expect(matchVoiceAction('Hit that again')).toBe('hit');
  });
});
