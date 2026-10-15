import type { MarkerColour, Settings } from '../store/types';

/**
 * #31: a coloured dot per chart cell, set by long-pressing a hand in
 * Flashcards or Mastery, kept in `settings.drill.markers`, and usable as the
 * 'marked' deck.
 */
export const MARKER_COLOURS: readonly MarkerColour[] = ['red', 'amber', 'green', 'blue'];

export const MARKER_NAME: Record<MarkerColour, string> = {
  red: 'Red',
  amber: 'Amber',
  green: 'Green',
  blue: 'Blue',
};

export function markerOf(drill: Pick<Settings['drill'], 'markers'>, cellId: string): MarkerColour | undefined {
  const colour = drill.markers?.[cellId];
  return colour && MARKER_COLOURS.includes(colour) ? colour : undefined;
}

/** Settings with `cellId` marked `colour`, or unmarked for null. Pure. */
export function withMarker(settings: Settings, cellId: string, colour: MarkerColour | null): Settings {
  const markers = { ...(settings.drill.markers ?? {}) };
  if (colour === null) delete markers[cellId];
  else markers[cellId] = colour;
  return { ...settings, drill: { ...settings.drill, markers } };
}
