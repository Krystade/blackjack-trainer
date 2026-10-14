/**
 * #33: the gear in the topbar of Play, Drills and Charts that opens that
 * tab's settings sheet. Placeholder until wave 3's nav lane implements it;
 * the call sites are placed now so no other lane has to touch them.
 */
export type SettingsTab = 'play' | 'drills' | 'charts';

export function TabSettingsButton(_props: { tab: SettingsTab }) {
  return null;
}
