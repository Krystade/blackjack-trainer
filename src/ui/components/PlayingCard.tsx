import type { Card, Suit } from '../../engine/cards';

interface PlayingCardProps {
  card?: Card;
  faceDown?: boolean;
  /** Cycle-2 Task 6: bot seat rows render smaller cards than the player's own
   * hands. Defaults to 'normal' so every existing (v1 + cycle-2 player-hand)
   * call site is unaffected. */
  size?: 'normal' | 'compact';
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

export function PlayingCard({ card, faceDown, size = 'normal' }: PlayingCardProps) {
  const sizeClass = size === 'compact' ? ' card-compact' : '';

  if (!card || faceDown) {
    return <div className={`card card-back${sizeClass}`} aria-label="face-down card" />;
  }

  const red = isRed(card.suit);
  return (
    <div
      className={`card ${red ? 'card-red' : 'card-black'}${sizeClass}`}
      data-card={`${card.rank}${card.suit}`}
      aria-label={`${card.rank} of ${SUIT_NAME[card.suit]}`}
    >
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{SUIT_GLYPH[card.suit]}</span>
    </div>
  );
}
