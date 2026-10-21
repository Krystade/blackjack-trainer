import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { matchVoiceAction, nearestVoiceAction } from '../src/audio/voiceRecognition';
import { narrateVariantPrompt, narrateVariantCorrection, VARIANT_OPENERS } from '../src/audio/narrateVariant';
import type { Card } from '../src/engine/cards';

describe('Wave L voice: "rescue this"', () => {
  it('"rescue this" surrenders; bare "rescue" is not a command', () => {
    expect(matchVoiceAction('rescue this')).toBe('surrender');
    expect(matchVoiceAction('rescue')).toBeNull();
    expect(nearestVoiceAction('rescue')).toBeNull();
  });

  it('collides with no other command, and the app never says it', () => {
    // Its consonant skeleton is nowhere near another command's.
    expect(nearestVoiceAction('rescue this')).not.toBe('stand');
    const phrases = JSON.parse(readFileSync(new URL('./spoken-phrases.json', import.meta.url), 'utf8')) as string[];
    expect(phrases.some((p) => p.toLowerCase().includes('rescue'))).toBe(false);
  });
});

describe('variant drill speech', () => {
  const c = (rank: Card['rank']): Card => ({ rank, suit: 'h' });
  it('opens a free hand, a doubled hand and a multi-card hand with its own sentence', () => {
    expect(narrateVariantPrompt({ kind: 'free', cards: [c('10'), c('4')], up: '2' })).toMatch(/^Free hand\. You have fourteen\./);
    expect(narrateVariantPrompt({ kind: 'afterDouble', cards: [c('5'), c('6'), c('2')], up: '10' })).toMatch(/^Doubled\. /);
    expect(narrateVariantPrompt({ kind: 'multi', cards: [c('2'), c('3'), c('4'), c('5')], up: '6' })).toMatch(/^Four cards\. /);
    expect(narrateVariantPrompt({ kind: 'hand', cards: [c('10'), c('6')], up: '6' })).toMatch(/^You have sixteen\./);
    expect(Object.values(VARIANT_OPENERS)).toHaveLength(5);
  });

  it('a correction names the play and says no true count', () => {
    const text = narrateVariantCorrection(false, 'surrender', 'Basic surrender vs dealer 10');
    expect(text).toBe('Wrong. Basic surrender versus dealer ten. Correct play was surrender.');
    expect(narrateVariantCorrection(true, 'hit', 'x')).toBe('Correct.');
  });
});
