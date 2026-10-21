import { lazyScreen } from '../lazyScreen';

/**
 * Wave O: the variant charts (and their EV tables) load when first shown.
 * One wrapper for both places that show them (Charts, the Variant drill), so
 * they share one lazy component.
 */
export const VariantCharts = lazyScreen('variantcharts', () => import('./VariantCharts').then((m) => m.VariantCharts));
