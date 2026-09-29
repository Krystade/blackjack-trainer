import { describe, it, expect } from 'vitest';
import {
  ANSWER_PHRASES,
  matchFieldTestAnswer,
  normaliseHeard,
  spokenHintFor,
} from './fieldTestVoice';
import {
  FIELD_TEST_CONDITIONS,
  FIELD_TEST_STEPS,
  resolveFieldTestSetup,
  stepResponses,
  type StepSlot,
} from './fieldTest';

/** Every answer set the protocol can present: one per step, whatever the condition. */
function everyOfferedSet(): { where: string; slots: readonly StepSlot[] }[] {
  return FIELD_TEST_STEPS.map((step) => ({ where: step.id, slots: stepResponses(step) }));
}

describe('the spoken vocabulary', () => {
  /**
   * THE INVARIANT THE WHOLE TABLE RESTS ON.
   *
   * `ANSWER_PHRASES` is deliberately loose across steps -- "quiet" is
   * `wheel-car-quiet` on a wheel step and `fallback-quiet` on a fallback one
   * -- and that is only safe because those two are never on screen together.
   * This walks every step of every condition and checks it, so the looseness
   * is a checked property rather than a hope.
   */
  it('never lets one phrase mean two things on one step', () => {
    const clashes: string[] = [];
    for (const { where, slots } of everyOfferedSet()) {
      const byPhrase = new Map<string, string[]>();
      for (const slot of slots) {
        if (!slot) continue;
        for (const phrase of ANSWER_PHRASES[slot.id] ?? []) {
          byPhrase.set(phrase, [...(byPhrase.get(phrase) ?? []), slot.id]);
        }
      }
      for (const [phrase, ids] of byPhrase) {
        if (ids.length > 1) clashes.push(`${where}: "${phrase}" -> ${ids.join(' & ')}`);
      }
    }
    expect(clashes, `a spoken answer would have been a coin flip:\n${clashes.join('\n')}`).toEqual(
      [],
    );
  });

  /**
   * A LONGER PHRASE MUST NOT BE SWALLOWED BY A SHORTER ONE on the same step.
   *
   * Separate from the clash test above, and it catches the subtler half: no
   * single phrase is shared, but saying one answer's phrase happens to
   * contain another answer's. "nothing to report" contains nothing offered
   * elsewhere only because `wheel-car-quiet`'s "nothing else" was written to
   * avoid it, and that is exactly the kind of thing that decays silently.
   */
  it('resolves every offered phrase to the answer it belongs to', () => {
    const wrong: string[] = [];
    for (const { where, slots } of everyOfferedSet()) {
      for (const slot of slots) {
        if (!slot) continue;
        for (const phrase of ANSWER_PHRASES[slot.id] ?? []) {
          const match = matchFieldTestAnswer(phrase, slots);
          if (match?.id !== slot.id) {
            wrong.push(`${where}: saying "${phrase}" gave ${match?.id ?? 'nothing'}, want ${slot.id}`);
          }
        }
      }
    }
    expect(wrong, `phrases that do not select their own answer:\n${wrong.join('\n')}`).toEqual([]);
  });

  /**
   * THE APP MUST NOT BE ABLE TO ANSWER FOR THE OPERATOR.
   *
   * `isSuppressed` drops most echo by the clock and the screen checks
   * `looksLikeSelfEcho` on top of it, but neither is a reason to leave a
   * step whose own spoken line CONTAINS one of its answers. That is a
   * vocabulary bug, not a timing one: it would stamp itself the moment
   * either guard had an off day, and the answer it stamps is about the very
   * utterance that said it.
   */
  it('never puts an answer into the line the step itself speaks', () => {
    const hazards: string[] = [];
    for (const condition of FIELD_TEST_CONDITIONS) {
      for (const [index, step] of FIELD_TEST_STEPS.entries()) {
        // THE READ-ALOUD INSTRUCTION IS A LINE TOO, on the steps where a
        // transcript is taken as an answer: the screen treats it as one
        // (`stepLines`), so a step whose instruction contains one of its own
        // answers is the same vocabulary bug. Not on the other steps -- the
        // microphone is shut there, and `route-1t` says "switched", which is
        // `route-moved` on its own stack and harmless with nothing listening.
        const heard =
          resolveFieldTestSetup(index).voice === true && step.transcriptIsEvidence !== true;
        const lines = [
          ...(step.say ?? []),
          ...(step.sayUnclipped ? [step.sayUnclipped] : []),
          ...(heard ? [step.instruction] : []),
        ];
        for (const line of lines) {
          const match = matchFieldTestAnswer(line, stepResponses(step));
          if (match) {
            hazards.push(`${condition.id}/${step.id}: says "${line}" -> ${match.id}`);
          }
        }
      }
    }
    expect(
      hazards,
      `a step's own voice would have answered it:\n${hazards.join('\n')}`,
    ).toEqual([]);
  });

  it('gives every answer in the protocol something to say', () => {
    const mute: string[] = [];
    for (const { where, slots } of everyOfferedSet()) {
      for (const slot of slots) {
        if (!slot) continue;
        if (!(ANSWER_PHRASES[slot.id]?.length ?? 0)) mute.push(`${where}: ${slot.id}`);
      }
    }
    // An answer with no phrase is a button the voice channel cannot reach,
    // which quietly makes the run un-finishable without looking.
    expect(mute, `answers with no spoken form:\n${mute.join('\n')}`).toEqual([]);
  });
});

describe('matching a transcript', () => {
  const routeStep = FIELD_TEST_STEPS.find((s) => s.id === 'route-1')!;
  const routeSlots = stepResponses(routeStep);

  it('takes the answer out of a sentence, not just a bare word', () => {
    expect(matchFieldTestAnswer('that came from the car', routeSlots)?.id).toBe('route-car');
    expect(matchFieldTestAnswer('uh, phone loud I think', routeSlots)?.id).toBe(
      'route-loudspeaker',
    );
  });

  it('refuses rather than guessing when two answers fit equally', () => {
    // A hand-built pair, so the refusal is tested even though the real
    // protocol is checked above never to present one.
    const slots: StepSlot[] = [
      { id: 'route-car', label: 'Car speakers', kind: 'route' },
      { id: 'wheel-car-quiet', label: 'The car did nothing else', kind: 'good' },
    ];
    // "car" belongs to route-car; "car quiet" is longer and belongs to the
    // other -- so the longer one wins rather than the pair being ambiguous.
    expect(matchFieldTestAnswer('car quiet', slots)?.id).toBe('wheel-car-quiet');
    // Two answers matching equally well in ONE utterance is the coin flip,
    // and it is what a corrected answer sounds like: "car -- no, top". The
    // recogniser inserting a stray word does the same thing.
    expect(
      matchFieldTestAnswer('car top', routeSlots),
      'a two-answer utterance was stamped as one of them instead of being refused',
    ).toBeNull();
    // ...and the refusal is about the tie, not about there being two words:
    // one clear answer with filler around it still lands.
    expect(matchFieldTestAnswer('er, the top one', routeSlots)?.id).toBe('route-earpiece');
  });

  it('prefers the longest phrase over one contained in it', () => {
    const slots: StepSlot[] = [
      { id: 'nothing-to-report', label: 'Nothing to report', kind: 'note' },
      { id: 'missed', label: 'Missed it', kind: 'note' },
    ];
    expect(matchFieldTestAnswer('nothing to report', slots)?.id).toBe('nothing-to-report');
    expect(matchFieldTestAnswer('missed it', slots)?.id).toBe('missed');
  });

  /**
   * "skip" is the name of the button `wheel-with-mic` asks for, with the
   * microphone open. It was a synonym for `missed`, so "I pressed skip
   * forward, nothing happened" stamped the step missed and lost the sample.
   */
  it('does not take the skip-forward button’s name as missed', () => {
    const slots: StepSlot[] = [
      { id: 'wheel-car-quiet', label: 'The car did nothing else', kind: 'good' },
      { id: 'missed', label: 'Missed it', kind: 'note' },
    ];
    expect(matchFieldTestAnswer('i pressed skip forward nothing happened', slots)).toBeNull();
    expect(matchFieldTestAnswer('skip', slots)).toBeNull();
  });

  it('matches whole words only', () => {
    // "carpet" must not be "car"; this is the failure mode of a plain
    // substring test, and in a car the recogniser produces exactly this
    // kind of near miss.
    expect(matchFieldTestAnswer('carpet', routeSlots)).toBeNull();
    expect(matchFieldTestAnswer('scar', routeSlots)).toBeNull();
  });

  it('is unbothered by punctuation, case and filler', () => {
    expect(normaliseHeard('  Car, speakers!  ')).toBe('car speakers');
    expect(matchFieldTestAnswer('CAR.', routeSlots)?.id).toBe('route-car');
  });

  it('says nothing for silence or for a transcript with no answer in it', () => {
    expect(matchFieldTestAnswer('', routeSlots)).toBeNull();
    expect(matchFieldTestAnswer('what was that', routeSlots)).toBeNull();
  });

  it('will not answer with something this step is not offering', () => {
    // "radio" is a real answer elsewhere in the protocol. On a route step it
    // must not stamp anything at all.
    expect(matchFieldTestAnswer('the radio changed track', routeSlots)).toBeNull();
  });
});

describe('the printed hint', () => {
  it('is the shortest way to select the answer, not its label', () => {
    const wheel = FIELD_TEST_STEPS.find((s) => s.wheel)!;
    const radio = stepResponses(wheel).find((r) => r?.id === 'wheel-radio')!;
    const hint = spokenHintFor(radio)!;
    expect(hint).toBe('radio');
    expect(hint.length, 'the hint is as long as the label it was meant to replace').toBeLessThan(
      radio.label.length,
    );
  });
});
