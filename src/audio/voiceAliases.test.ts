/**
 * Words the operator adds himself, because the built-in table is not enough.
 *
 * WHY THIS EXISTS. Jack's 2026-10-04 drive, after the audio was finally
 * audible: "The voice detection is pretty rough. I think we need to come up
 * with some new code words or something ... maybe set a setting where I can
 * put in a bunch of different aliases for the different words just to help so
 * I can say something that's easier for it to pick out."
 *
 * His log is full of readings nothing in the table covers -- `heard=Strength`,
 * `heard=Touch`, `heard=Definitely`, `heard="That's for sure"`, all rejected.
 * What those were in his mouth is unrecoverable: the log records what the
 * ENGINE returned, never what was said. So the app cannot guess the mapping,
 * and the operator is the only one who can supply it.
 *
 * I had claimed from those same lines that multi-word commands "graded
 * correctly every time". `heard="That's for sure" verdict=rejected` appears
 * twice in the log I was quoting. Jack: "This is straight up wrong." It was,
 * and it is the reason this module takes its mappings from a person rather
 * than from a theory about which utterances work.
 */
import { describe, it, expect } from 'vitest';
import { aliasProblem, normaliseAlias, MAX_ALIAS_WORDS } from './voiceAliases';

describe('accepting an alias', () => {
  it('takes an ordinary one-word alias', () => {
    expect(aliasProblem('strength')).toBeNull();
  });

  it('takes a two-word alias, which the built-ins also use', () => {
    // "double down" and "say again" are both in the shipped table.
    expect(aliasProblem('stand pat')).toBeNull();
  });

  it('refuses a three-word alias, to keep the self-echo guard honest', () => {
    /*
     * THE CONTRACT THIS PROTECTS, from audio/selfEcho.ts: a late transcript is
     * dismissed as the app's own voice once it is longer than anything the
     * operator could have said, and "longer than" is measured against the
     * alias list itself. Admit a three-word alias and the app can no longer
     * tell its own prompt from a command -- it would start grading its own
     * voice as an answer, which is the failure the whole suppression system
     * exists to prevent.
     *
     * So this is not a style rule. It is the one limit that cannot be relaxed
     * without breaking a guarantee two modules away.
     */
    expect(aliasProblem('i would like to stand')).toMatch(/two words/i);
    expect(MAX_ALIAS_WORDS).toBe(2);
  });

  it('refuses an empty or blank alias', () => {
    expect(aliasProblem('')).toBeTruthy();
    expect(aliasProblem('   ')).toBeTruthy();
  });

  it('refuses digits and punctuation, which a recogniser renders inconsistently', () => {
    // The same utterance comes back as "21" or "twenty one" depending on the
    // engine's mood, so an alias containing a digit matches unpredictably.
    expect(aliasProblem('hit 21')).toBeTruthy();
  });

  it('warns when the alias is already a built-in command', () => {
    // Not an error -- harmless -- but worth saying, because the operator is
    // trying to fix a word that already works and the real problem is
    // elsewhere.
    expect(aliasProblem('stand')).toMatch(/already/i);
  });
});

describe('normalising an alias', () => {
  it('lowercases and collapses whitespace, matching the recogniser path', () => {
    expect(normaliseAlias('  Stand   Pat ')).toBe('stand pat');
  });

  it('strips the punctuation an engine adds unbidden', () => {
    // Transcripts arrive with trailing full stops and stray apostrophes; the
    // stored alias has to be comparable to a cleaned transcript or it never
    // matches once.
    expect(normaliseAlias("That's for sure.")).toBe('thats for sure');
  });
});
