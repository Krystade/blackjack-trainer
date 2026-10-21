import { describe, expect, it } from 'vitest';
import {
  SIDE_BET_LINES,
  SIDE_BIAS,
  SIDE_OFF_LINE,
  SIDE_OFF_WORDS,
  SIDE_ON_LINE,
  SIDE_ON_WORDS,
  SIDE_SAYS_BET,
  SIDE_SAYS_SKIP,
  dollars,
  sideMissFeedback,
  sideResultText,
  sideWordIn,
  triggerText,
} from './sideBetFeedback';
import { aliasProblem, MAX_ALIAS_WORDS } from '../audio/voiceAliases';
import { matchVoiceAction, nearestVoiceAction, VOICE_PHRASES } from '../audio/voiceRecognition';
import { parseCountSpeech, COUNT_BIAS_PHRASES } from '../audio/voiceNumber';
import { TOGGLE_WORDS, toggleWordIn } from './backCountWords';
import { DEAL_WORDS, isDealWord } from './dealWord';
import type { SideBetConfig, SideBetDecision } from '../engine/sideBets/tableBet';
import { payTableOf } from '../engine/sideBets/payTables';
import { normaliseAlias } from '../audio/voiceAliases';
import SPOKEN from '../../scripts/spoken-phrases.json';

const TEN = { id: 'jacobson-ten', name: 'Ten', kind: 'tags' as const, tags: [0, 1, 1, 1, 1, 1, 1, 1, 1, -2, -2, -2, -2] };
const cfg: SideBetConfig = {
  bet: 'luckyLadies',
  name: 'Lucky Ladies',
  pays: payTableOf('luckyLadies', 'll-a')!.pays,
  plan: { always: false, count: TEN, trigger: 6, betBelow: false },
  stake: 25,
};
const decision = (over: Partial<SideBetDecision>): SideBetDecision => ({ round: 3, placed: false, expected: true, correct: false, rc: 12, tc: 6, ...over });

describe('the side bet in words', () => {
  it('a missed bet names the count and the call, in the bet-miss style', () => {
    expect(sideMissFeedback(cfg, decision({}))).toEqual({ text: 'Lucky Ladies count +6 — bet it (from +6)', spoken: SIDE_SAYS_BET });
    expect(sideMissFeedback(cfg, decision({ placed: true, expected: false, tc: 5 }))).toEqual({
      text: 'Lucky Ladies count +5 — no side bet (from +6)',
      spoken: SIDE_SAYS_SKIP,
    });
    expect(sideMissFeedback(cfg, decision({ correct: true }))).toBeNull();
  });

  it('review N7: a bet worth making every hand quotes no count', () => {
    const always = { ...cfg, name: 'Royal Match', plan: { always: true, count: null, trigger: null, betBelow: false } };
    expect(sideMissFeedback(always, decision({ tc: 0 }))).toEqual({ text: 'Royal Match pays every hand — bet it', spoken: SIDE_SAYS_BET });
  });

  it('says when a bet is made', () => {
    expect(triggerText({ ...cfg.plan, trigger: -5, betBelow: true })).toBe('at −5 and below');
    expect(triggerText({ ...cfg.plan, always: true })).toBe('every hand');
    expect(triggerText({ ...cfg.plan, trigger: null })).toMatch(/^never/);
  });

  it('the result line: what it made, and the money', () => {
    expect(sideResultText(cfg, decision({ placed: true, outcome: 'suited20', net: 225 }))).toBe('Lucky Ladies: suited 20 — +$225');
    expect(sideResultText(cfg, decision({ placed: true, outcome: null, net: -25 }))).toBe('Lucky Ladies: lost — −$25');
    expect(sideResultText(cfg, decision({ placed: false }))).toBeNull();
    expect(dollars(12.5)).toBe('+$12.50');
  });
});

describe('the chip\'s voice words', () => {
  const words = [...SIDE_ON_WORDS, ...SIDE_OFF_WORDS];

  it('are valid aliases: letters, at most two words, not a command', () => {
    for (const w of words) {
      expect(aliasProblem(w), w).toBeNull();
      expect(w.split(' ').length).toBeLessThanOrEqual(MAX_ALIAS_WORDS);
    }
    expect(SIDE_BIAS).toEqual(words);
  });

  it('collide with nothing the table already listens for', () => {
    for (const w of words) {
      expect(matchVoiceAction(w), w).toBeNull();
      expect(nearestVoiceAction(w), w).toBeNull();
      expect(toggleWordIn([w]), w).toBeNull();
      expect(isDealWord([w]), w).toBe(false);
      expect(parseCountSpeech(w), w).toBeNull();
      expect(VOICE_PHRASES).not.toContain(w);
      expect(TOGGLE_WORDS).not.toContain(w);
      expect(DEAL_WORDS).not.toContain(w);
      expect(COUNT_BIAS_PHRASES).not.toContain(w);
    }
    // And the table's own words are not taken by the chip.
    for (const w of [...VOICE_PHRASES, ...TOGGLE_WORDS, ...DEAL_WORDS]) expect(sideWordIn([w]), w).toBeNull();
  });

  it('only the top reading counts, as for the In/Out toggle', () => {
    expect(sideWordIn(['side on'])).toBe(true);
    expect(sideWordIn(['Skip side.'])).toBe(false);
    expect(sideWordIn(['sit out', 'side off'])).toBeNull();
    expect(sideWordIn([])).toBeNull();
  });
});

describe('review S3: no chip word is an echo of something the app says', () => {
  // Everything the app can say that a clip covers (held to the code by
  // spokenPhrases.test.ts), and the side lines themselves.
  const sentences = [...new Set([...(SPOKEN as string[]), ...SIDE_BET_LINES])];
  const wordsOf = (t: string) => normaliseAlias(t).split(' ').filter(Boolean);
  const contains = (line: string, word: string) => ` ${wordsOf(line).join(' ')} `.includes(` ${wordsOf(word).join(' ')} `);

  it('the sentence list is the real one', () => {
    expect(sentences.length).toBeGreaterThan(500);
    expect(sentences).toContain(SIDE_OFF_LINE);
    expect(sentences).toContain(SIDE_ON_LINE);
  });

  it('an ON word is in no spoken line but the ON confirmation; an OFF word in none but the OFF one', () => {
    for (const w of SIDE_ON_WORDS) expect(sentences.filter((s) => s !== SIDE_ON_LINE && contains(s, w)), w).toEqual([]);
    for (const w of SIDE_OFF_WORDS) expect(sentences.filter((s) => s !== SIDE_OFF_LINE && contains(s, w)), w).toEqual([]);
  });

  it('no fragment of "Side bet off." turns the chip on, and none of "Side bet on." turns it off', () => {
    const fragments = (line: string) => {
      const w = wordsOf(line);
      const out: string[] = [];
      for (let i = 0; i < w.length; i++) for (let j = i + 1; j <= w.length; j++) out.push(w.slice(i, j).join(' '));
      return out;
    };
    // The late echo the review traced: "side bet", the head of the OFF line.
    expect(fragments(SIDE_OFF_LINE)).toContain('side bet');
    for (const f of fragments(SIDE_OFF_LINE)) expect(sideWordIn([f]), f).not.toBe(true);
    for (const f of fragments(SIDE_ON_LINE)) expect(sideWordIn([f]), f).not.toBe(false);
  });
});
