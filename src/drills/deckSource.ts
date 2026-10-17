import type { Settings, Stats } from '../store/types';
import { indexSetFor } from '../engine/deviations';
import type { Deviation } from '../engine/deviations';
import { generateAllCells } from './flashcards';
import { customWeights } from './cellSelection';
import { ALL_SCOPES, filterCellsByScopes, scopesFrom, scopesLabel } from './handScope';
import { markerOf } from './markers';
import type { HandScope } from './handScope';

/**
 * B2 consumer: where the hand drills (Flashcards, Mastery, Mixed's
 * basic-strategy hands) draw their cells from.
 *
 * - 'chart': every cell of the chosen scopes (the drills as they always were)
 * - 'custom': the painted Custom selection, weighted by tier (#9)
 * - 'indexes': cells that carry a deviation index in the active rules (#23)
 * - 'marked': cells the learner has put a marker on (#31)
 *
 * Every deck is intersected with the Hard / Soft / Pairs scope (#13), so
 * "marked pairs" and "soft indexes" mean what they say.
 */
export type DeckSource = NonNullable<Settings['drill']['deck']>;

export const DECK_SOURCES: readonly DeckSource[] = ['chart', 'custom', 'indexes', 'marked'];

export function deckOf(drill: Pick<Settings['drill'], 'deck'>): DeckSource {
  return drill.deck && DECK_SOURCES.includes(drill.deck) ? drill.deck : 'chart';
}

/** The rule fields the index set depends on. */
export type IndexRules = { decks: number; s17: boolean; surrenderIndices?: boolean; bjaExtras?: boolean };

/** The chart cell a deviation is played on, or null (insurance has none). */
export function cellIdForDeviation(dev: Deviation): string | null {
  if (!dev.up) return null;
  if (dev.kind === 'pair10') return `pair-10-v-${dev.up}`;
  if (dev.kind === 'soft' && dev.total !== undefined) return `soft-${dev.total}-v-${dev.up}`;
  if ((dev.kind === 'hard' || dev.kind === 'surrender') && dev.total !== undefined) {
    return `hard-${dev.total}-v-${dev.up}`;
  }
  return null;
}

/**
 * The cells with an ACTIVE index under `rules`: the Illustrious 18 for the
 * dealer's soft-17 rule, plus the Fab 4 when the profile has surrender
 * indices on, plus the BJA H17 extras when it has those on (callers pass `strategyRulesFor(profile)`, which already drops
 * them at a table without late surrender). Read off the deviation data, so a
 * change there moves the deck with it.
 */
export function indexCellIds(rules: IndexRules): Set<string> {
  const ids = new Set<string>();
  for (const dev of indexSetFor(rules)) {
    if (!dev.active) continue;
    const id = cellIdForDeviation(dev);
    if (id) ids.add(id);
  }
  return ids;
}

export interface HandDeck {
  source: DeckSource;
  scopes: HandScope[];
  /** The cells to deal, in universe order. Empty means nothing to deal. */
  ids: string[];
  /**
   * A draw weight per cell, multiplied into the spaced-repetition weight;
   * null for the plain chart, which draws exactly as it always has.
   */
  weights: Map<string, number> | null;
}

const ALL_IDS = generateAllCells().map((c) => c.id);

/** The deck the drill settings describe. Pure: stats and rules are passed in. */
export function handDeck(
  drill: Settings['drill'],
  rules: IndexRules,
  cellStats?: Stats['cellStats'],
): HandDeck {
  const source = deckOf(drill);
  const scopes = scopesFrom(drill);
  const scoped = filterCellsByScopes(
    ALL_IDS.map((id) => ({ id })),
    scopes,
  ).map((c) => c.id);

  if (source === 'chart') return { source, scopes, ids: scoped, weights: null };

  let weights: Map<string, number>;
  if (source === 'custom') {
    const raw = customWeights(drill.custom, scoped, cellStats);
    weights = new Map(scoped.filter((id) => (raw.get(id) ?? 0) > 0).map((id) => [id, raw.get(id)!]));
  } else if (source === 'indexes') {
    const withIndex = indexCellIds(rules);
    weights = new Map(scoped.filter((id) => withIndex.has(id)).map((id) => [id, 1]));
  } else {
    weights = new Map(scoped.filter((id) => markerOf(drill, id) !== undefined).map((id) => [id, 1]));
  }
  return { source, scopes, ids: [...weights.keys()], weights };
}

const SOURCE_NAME: Record<DeckSource, string> = {
  chart: 'Chart',
  custom: 'Custom',
  indexes: 'Indexes',
  marked: 'Marked',
};

export function deckLabel(deck: Pick<HandDeck, 'source' | 'scopes'>): string {
  const scope = scopesLabel(deck.scopes);
  return deck.source === 'chart' ? scope : `${SOURCE_NAME[deck.source]} · ${scope}`;
}

/** Why an empty deck is empty, in words for the screen. */
export function emptyDeckMessage(deck: Pick<HandDeck, 'source' | 'scopes'>): string {
  const all = ALL_SCOPES.every((s) => deck.scopes.includes(s));
  const among = all ? '' : ` among ${scopesLabel(deck.scopes)} hands`;
  switch (deck.source) {
    case 'marked':
      return all
        ? 'No hands are marked yet. Long-press a hand in Flashcards or Mastery to mark it, or pick another deck.'
        : `No marked hands${among}. Choose more hands or another deck.`;
    case 'indexes':
      return `No index plays${among}. Choose more hands or another deck.`;
    case 'custom':
      return all
        ? 'Your Custom selection is empty. Paint some cells in Custom, or pick another deck.'
        : `Your Custom selection has no hands${among}. Choose more hands or another deck.`;
    default:
      return 'No hands to deal. Choose more hands.';
  }
}

/**
 * The settings a Custom-editor "Start" leaves behind: the Custom deck, over
 * every scope, so the painted cells are exactly what gets dealt (a scope
 * left at, say, Pairs would hide the rest of the painting).
 */
export function settingsForCustomStart(settings: Settings): Settings {
  return {
    ...settings,
    drill: { ...settings.drill, deck: 'custom', scopes: [...ALL_SCOPES], flashCategory: 'all' },
  };
}
