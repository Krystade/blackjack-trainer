import { deckOf, handDeck } from '../../../drills/deckSource';
import type { HandDeck } from '../../../drills/deckSource';
import { strategyRulesFor } from '../../../store/profiles';
import { loadStats } from '../../../store/persist';
import type { Profile, Settings } from '../../../store/types';

/**
 * The hand drills' deck for these settings and profile. The index deck reads
 * the profile's own index set (Fab 4 only where it is on and the table has
 * late surrender); only the Custom deck needs per-cell stats, so only it
 * reads them.
 */
export function handDeckFor(drill: Settings['drill'], profile: Profile): HandDeck {
  const cellStats = deckOf(drill) === 'custom' ? loadStats().cellStats : undefined;
  return handDeck(drill, strategyRulesFor(profile), cellStats);
}
