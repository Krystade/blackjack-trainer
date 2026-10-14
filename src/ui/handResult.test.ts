import { describe, expect, it } from 'vitest';
import type { GradedEvent } from '../engine/grade';
import type { Card } from '../engine/cards';
import { correctLine, handText, progressLostLine, resultHandLine, snapshotResult } from './handResult';

const event = (over: Partial<GradedEvent>): GradedEvent =>
  ({
    kind: 'flashcard',
    category: 'basic',
    correct: true,
    classification: 'correct',
    taken: 'hit',
    expected: 'hit',
    reason: 'r',
    tc: 0,
    ...over,
  }) as GradedEvent;

describe('B1 hand result', () => {
  it('prints the correct line with the exact cards', () => {
    const cards: Card[] = [{ rank: 'A', suit: 's' }, { rank: '2', suit: 'h' }];
    const r = snapshotResult(1, event({}), { cards, up: '7', tc: null });
    expect(correctLine(r)).toBe('Correct! A,2 v 7 — Hit');
  });

  it('names the count for a quiz hand, and insurance with no cards', () => {
    expect(resultHandLine({ cards: [{ rank: '9', suit: 's' }, { rank: '7', suit: 'd' }], up: '10', tc: 2 })).toBe(
      '9,7 v 10 at TC +2',
    );
    expect(handText(null, 'A')).toBe('Insurance v A');
  });

  it('snapshots the cards, so changing the live hand cannot change the result', () => {
    const cards: Card[] = [{ rank: '4', suit: 's' }, { rank: '4', suit: 'h' }];
    const r = snapshotResult(1, event({ correct: false, taken: 'stand', expected: 'split' }), {
      cards,
      up: '4',
      tc: null,
    });
    cards[0].rank = '10';
    cards.push({ rank: '2', suit: 'c' });
    expect(handText(r.cards, r.up)).toBe('4,4 v 4');
  });

  it('prints mastery progress lost', () => {
    expect(progressLostLine({ at: 120, of: 150 })).toBe('Run reset at 120/150');
  });
});
