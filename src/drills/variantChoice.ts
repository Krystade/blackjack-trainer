import { isPresetId } from '../engine/variants/rules';
import type { PresetId } from '../engine/variants/rules';

/**
 * The variant being studied: shared by the Charts picker and the Variant
 * drill, so picking Spanish 21 on Charts opens the drill on Spanish 21. Its
 * own key, like the chart row order -- a study preference, not part of a
 * profile.
 */
export const VARIANT_CHOICE_KEY = 'bjtrainer.variant.v1';

export type VariantChoice = 'standard' | PresetId;

export function loadVariantChoice(): VariantChoice {
  try {
    const raw = window.localStorage.getItem(VARIANT_CHOICE_KEY);
    return raw === 'standard' || isPresetId(raw) ? raw : 'standard';
  } catch {
    return 'standard';
  }
}

export function saveVariantChoice(choice: VariantChoice): void {
  try {
    window.localStorage.setItem(VARIANT_CHOICE_KEY, choice);
  } catch {
    // A preference that cannot be saved is still applied for this visit.
  }
}
