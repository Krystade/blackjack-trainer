/**
 * T2-2B: the glossary. Every bit of jargon the app puts on screen, with a
 * plain definition of one to three sentences -- what a beginner needs to read
 * the screen, not a strategy lesson. A `Term` (Term.tsx) shows one of these in
 * a bottom sheet when its word is tapped.
 *
 * Plain on purpose: a definition never leans on another term's abbreviation
 * without spelling it out (terms.test.ts holds that), so no definition sends
 * you to a second one.
 */

export type TermId =
  | 'h17'
  | 's17'
  | 'das'
  | 'ls'
  | 'rsa'
  | 'surrender'
  | 'double'
  | 'split'
  | 'insurance'
  | 'six-five'
  | 'hole-card'
  | 'soft-hand'
  | 'hard-hand'
  | 'stiff'
  | 'bust-card'
  | 'shoe'
  | 'cut-card'
  | 'penetration'
  | 'discard-tray'
  | 'decks-remaining'
  | 'hi-lo'
  | 'rc'
  | 'tc'
  | 'tc-rounding'
  | 'resolution'
  | 'index'
  | 'deviation'
  | 'illustrious-18'
  | 'fab-4'
  | 'bja-extras'
  | 'phantom-deviation'
  | 'wong-in'
  | 'wong-out'
  | 'bet-ramp'
  | 'spread'
  | 'unit'
  | 'cover'
  | 'hot-shoe'
  | 'side-count'
  | 'countdown'
  | 'ev'
  | 'risk-of-ruin'
  | 'score'
  | 'push'
  | 'natural';

export interface TermEntry {
  /** The word as the sheet titles it. */
  label: string;
  /** One to three plain sentences. */
  def: string;
  /** Other names for it ("Also called ..."). */
  aka?: string[];
  /**
   * The abbreviations this entry owns. Any other definition that uses one
   * must spell it out (terms.test.ts).
   */
  abbr?: string[];
}

export const TERMS: Record<TermId, TermEntry> = {
  h17: {
    label: 'H17 (dealer hits soft 17)',
    def: 'The dealer takes another card on a soft 17, a 17 that counts an ace as 11. It is slightly worse for you than a dealer who stands there.',
    abbr: ['H17'],
  },
  s17: {
    label: 'S17 (dealer stands on soft 17)',
    def: 'The dealer stops on every 17, including a soft 17 (one that counts an ace as 11). It is slightly better for you than a dealer who hits soft 17.',
    abbr: ['S17'],
  },
  das: {
    label: 'DAS (double after split)',
    def: 'After you split a pair, you may still double down on either new hand. Tables that allow it make splitting worth more, so the chart splits a little more often.',
    abbr: ['DAS'],
  },
  ls: {
    label: 'LS (late surrender)',
    def: 'You may give up your first two cards and get half your bet back, but only after the dealer has checked for blackjack.',
    abbr: ['LS'],
  },
  rsa: {
    label: 'RSA (resplit aces)',
    def: 'If you split aces and catch another ace, you may split again. Most tables do not allow it.',
    abbr: ['RSA'],
  },
  surrender: {
    label: 'Surrender',
    def: 'Give up the hand before playing it and get half your bet back. Worth it only where you would lose more than half the time by playing on.',
  },
  double: {
    label: 'Double',
    def: 'Double your bet and take exactly one more card. You do it when you are the favourite, to get more money out while it is good.',
    aka: ['Double down'],
  },
  split: {
    label: 'Split',
    def: 'Turn a pair into two hands, each with its own bet the size of the first. Each hand then gets a second card and is played on its own.',
  },
  insurance: {
    label: 'Insurance',
    def: 'A side bet, offered when the dealer shows an ace, that the dealer has blackjack. It pays 2 to 1 and loses money unless the remaining cards are rich in tens.',
  },
  'six-five': {
    label: '6:5 blackjack',
    def: 'A blackjack pays 6 for every 5 you bet instead of the usual 3 for 2. It costs you far more than any other common rule; avoid these tables.',
  },
  'hole-card': {
    label: 'Hole card',
    def: "The dealer's face-down card. With a 10 or an ace showing, the dealer peeks at it for blackjack before anyone plays.",
    aka: ['Peek'],
  },
  'soft-hand': {
    label: 'Soft hand',
    def: 'A hand with an ace counted as 11, such as ace-6, a soft 17. One more card can never bust it, because the ace can drop to 1.',
  },
  'hard-hand': {
    label: 'Hard hand',
    def: 'A hand with no ace, or with an ace that has to count as 1. A big enough card can bust it.',
  },
  stiff: {
    label: 'Stiff',
    def: 'A hard 12 to 16: too low to win often by standing, and one card from busting if you hit.',
  },
  'bust-card': {
    label: 'Bust card',
    def: "A dealer's 2 to 6 showing. The dealer must keep drawing to 17, so these cards bust most often, and you stand on more hands against them.",
  },
  shoe: {
    label: 'Shoe',
    def: 'The box the cards are dealt from, usually holding six or eight decks shuffled together.',
  },
  'cut-card': {
    label: 'Cut card',
    def: 'A plastic card placed in the shoe. When it comes out, the dealer finishes the round and shuffles.',
  },
  penetration: {
    label: 'Penetration',
    def: 'How far into the shoe the dealer goes before shuffling, as a share of the cards. Deeper is better for a counter: the count means more near the end.',
    aka: ['Pen'],
  },
  'discard-tray': {
    label: 'Discard tray',
    def: 'Where played cards go. You judge how many decks are left by how full it is.',
  },
  'decks-remaining': {
    label: 'Decks remaining',
    def: 'How many decks are still to be dealt: the shoe minus what is in the discard tray. You divide the running count by it.',
  },
  'hi-lo': {
    label: 'Hi-Lo',
    def: 'The counting system the app teaches: 2 to 6 are +1, 7 to 9 are 0, and 10s and aces are −1. Add up the cards as they come out.',
  },
  rc: {
    label: 'Running count (RC)',
    def: 'The sum of the Hi-Lo values of every card seen since the shuffle. A high positive count means many low cards are gone and the rest of the shoe is rich in tens and aces.',
    abbr: ['RC'],
  },
  tc: {
    label: 'True count (TC)',
    def: 'The running count divided by the decks still to be dealt. It says how rich the rest of the shoe is per deck, which is what your bets and plays follow.',
    abbr: ['TC'],
  },
  'tc-rounding': {
    label: 'True count rounding',
    def: 'How a fraction becomes a whole true count. Floor always rounds down (−1.5 is −2), truncate drops the fraction (−1.5 is −1), and round goes to the nearest.',
  },
  resolution: {
    label: 'Resolution',
    def: 'How finely you judge the decks left: to the nearest half deck, or to the nearest quarter.',
  },
  index: {
    label: 'Index',
    def: 'The true count at which a play changes. Stand on 16 against a 10 at true count 0 or higher, for example, though the chart says hit.',
    aka: ['Indices', 'Indexes', 'Index number'],
  },
  deviation: {
    label: 'Deviation',
    def: 'Playing differently from the basic strategy chart because the count says to. Each deviation has an index, the count where it starts.',
  },
  'illustrious-18': {
    label: 'Illustrious 18',
    def: 'The 18 count-based play changes that earn the most, from insurance to standing on 16 against a 10.',
    aka: ['I18'],
  },
  'fab-4': {
    label: 'Fab 4',
    def: 'Four surrender plays that change with the count, such as surrendering 15 against a 10 at a true count of 0 or higher.',
  },
  'bja-extras': {
    label: 'BJA H17 extras',
    def: 'A few more count-based plays from the Blackjack Apprenticeship chart for tables where the dealer hits soft 17.',
  },
  'phantom-deviation': {
    label: 'Phantom deviation',
    def: 'Changing your play for the count when the count did not call for it. It is a mistake, not a deviation.',
  },
  'wong-in': {
    label: 'Wong in',
    def: 'Join a table mid-shoe only once the count is good, after watching it from behind.',
  },
  'wong-out': {
    label: 'Wong out',
    def: 'Leave the table when the count drops low enough, rather than play on through a bad shoe.',
  },
  'bet-ramp': {
    label: 'Bet ramp',
    def: 'Your table of how much to bet at each true count: the minimum at low counts, more as the count rises.',
  },
  spread: {
    label: 'Bet spread',
    def: 'The range from your smallest bet to your biggest, such as 1 to 8 units.',
  },
  unit: {
    label: 'Unit',
    def: 'Your basic betting amount. Bets are written in units so the same ramp works at any stakes.',
  },
  cover: {
    label: 'Cover',
    def: 'Small departures from your bet ramp so the casino cannot spot you counting, such as one step off the ramp now and then.',
  },
  'hot-shoe': {
    label: 'Hot shoe',
    def: 'A practice shoe stacked to run high, so you get many big-count hands to practise your bets and plays on.',
  },
  'side-count': {
    label: 'Side count',
    def: 'A second count kept alongside the main one, usually of aces, for a few extra decisions.',
  },
  countdown: {
    label: 'Countdown',
    def: "A deck is dealt with one card held back. A full deck counts to 0, so the count you end on tells you the held-back card's Hi-Lo value.",
  },
  ev: {
    label: 'EV (expected value)',
    def: 'What a bet or play wins or loses on average over many hands. A play with higher expected value is the better one.',
    abbr: ['EV'],
  },
  'risk-of-ruin': {
    label: 'Risk of ruin',
    def: 'The chance of losing your whole bankroll before you win what you are playing for.',
  },
  score: {
    label: 'SCORE',
    def: 'A single number for how good a game is for a counter: the win per hour at a standard bankroll and risk, so different tables can be compared.',
  },
  push: {
    label: 'Push',
    def: 'A tie with the dealer. You keep your bet and win nothing.',
  },
  natural: {
    label: 'Blackjack (natural)',
    def: 'An ace and a 10-value card as your first two cards. It usually pays 3 for 2.',
  },
};

/** Every abbreviation the glossary owns, with the entry that owns it. */
export function ownedAbbreviations(): Map<string, TermId> {
  const out = new Map<string, TermId>();
  for (const [id, entry] of Object.entries(TERMS) as [TermId, TermEntry][]) {
    for (const a of entry.abbr ?? []) out.set(a, id);
  }
  return out;
}

/** The rules chip's labels (legalActions.ts rulesChipLabels) and their terms. */
const RULE_LABEL_TERMS: Record<string, TermId | null> = {
  'Surrender OK': 'surrender',
  'No surrender': 'surrender',
  'No double': 'double',
};

/** The term a rules-chip label opens, or null for a label without one. */
export function termForRuleLabel(label: string): TermId | null {
  return RULE_LABEL_TERMS[label] ?? null;
}
