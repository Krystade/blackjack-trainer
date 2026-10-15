import type { Settings } from '../../store/types';

/**
 * B2 (#9): the Custom drill editor (paint tiers on the chart grid, mix
 * sliders, Auto). STUB placed by the orchestrator; the custom lane builds it.
 * `onStart` launches a hand drill with `settings.drill.deck = 'custom'`.
 */
export function CustomDrillEditor(_props: {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
  onStart: (mode: 'flashcards' | 'mastery' | 'mixed') => void;
  onBack: () => void;
}) {
  return null;
}
