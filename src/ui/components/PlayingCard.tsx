import type { Card, Suit } from '../../engine/cards';

interface PlayingCardProps {
  card?: Card;
  faceDown?: boolean;
}

const SUIT_GLYPH: Record<Suit, string> = {
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

export function PlayingCard({ card, faceDown }: PlayingCardProps) {
  if (!card || faceDown) {
    return <div className="card card-back" aria-label="face-down card" />;
  }

  const red = isRed(card.suit);
  return (
    <div
      className={`card ${red ? 'card-red' : 'card-black'}`}
      data-card={`${card.rank}${card.suit}`}
      aria-label={`${card.rank} of ${SUIT_NAME[card.suit]}`}
    >
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{SUIT_GLYPH[card.suit]}</span>
    </div>
  );
}
