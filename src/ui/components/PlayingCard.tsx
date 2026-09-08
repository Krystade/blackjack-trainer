import type { CSSProperties } from 'react';
import type { Card, Suit } from '../../engine/cards';

interface PlayingCardProps {
  card?: Card;
  faceDown?: boolean;
  /** Cycle-2 Task 6: bot seat rows render smaller cards than the player's own
   * hands. Defaults to 'normal' so every existing (v1 + cycle-2 player-hand)
   * call site is unaffected. */
  size?: 'normal' | 'compact';
  /** Position of THIS card within the round's `game.dealOrder` (Table
   * Realism, Request B) -- undefined for any card dealt outside the opening
   * two-pass deal (a hit, a double, a split, a dealer settlement draw), which
   * always plays its entrance the instant it mounts, with no extra delay.
   * Feeds the `--deal-i` custom property, consumed by app.css's
   * `card-deal-in` keyframe via
   * `animation-delay: calc(var(--deal-i, 0) * var(--deal-speed, 0ms))`. */
  dealIndex?: number;
}

export const SUIT_GLYPH: Record<Suit, string> = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
};

const SUIT_NAME: Record<Suit, string> = {
  s: 'Spades',
  h: 'Hearts',
  d: 'Diamonds',
  c: 'Clubs',
};

function isRed(suit: Suit): boolean {
  return suit === 'h' || suit === 'd';
}

/** Short text label for a card, e.g. "10♣" — used by bot action narration
 * (Cycle-2 Task 6), which needs the same rank+suit glyph text the card face
 * renders, outside of any DOM node. */
export function formatCard(card: Card): string {
  return `${card.rank}${SUIT_GLYPH[card.suit]}`;
}

export function PlayingCard({ card, faceDown, size = 'normal', dealIndex }: PlayingCardProps) {
  const sizeClass = size === 'compact' ? ' card-compact' : '';
  // `undefined` (no --deal-i set at all) falls back to app.css's own
  // `var(--deal-i, 0)` default -- identical to explicitly passing 0 -- so
  // this cast is only ever reached with a real index to set.
  const style = dealIndex === undefined ? undefined : ({ ['--deal-i']: dealIndex } as CSSProperties);

  if (!card || faceDown) {
    return <div className={`card card-back${sizeClass}`} aria-label="face-down card" style={style} />;
  }

  const red = isRed(card.suit);
  return (
    <div
      className={`card ${red ? 'card-red' : 'card-black'}${sizeClass}`}
      data-card={`${card.rank}${card.suit}`}
      aria-label={`${card.rank} of ${SUIT_NAME[card.suit]}`}
      style={style}
    >
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{SUIT_GLYPH[card.suit]}</span>
    </div>
  );
}
