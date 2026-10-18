import { expect, type Page } from '@playwright/test';

// Copied verbatim from play-glance.spec.ts (B2 #32 compositing contrast) so a
// new spec can use it without importing a spec file. Keep the two in step.

function lum([r, g, b]: number[]): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
}
/**
 * Worst-case contrast of an element's text against every background it can
 * sit on, for EVERY element the selector matches.
 *
 * B2 #32: translucent layers are COMPOSITED down to the first opaque ground
 * (a colour, or a gradient whose stops are all opaque -- each stop is a
 * candidate ground). It used to skip any background with alpha <= 0.9 and
 * measure against the opaque card underneath, so a grey rgb(0 0 0 / 22%) box
 * on Bone-ink's cream, and a gold tint under gold text, passed while failing.
 */
export async function worstContrast(page: Page, sel: string): Promise<number> {
  const got = await page.locator(sel).evaluateAll((els) => {
    // Any computed colour as sRGB 0-255 plus alpha. Chrome serialises
    // color-mix() results as color(srgb ...) or oklab(...), not rgb().
    const rgba = (v: string): number[] => {
      const n = (v.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
      const a = n.length > 3 ? n[3]! : 1;
      if (v.startsWith('color(srgb')) return [n[0]! * 255, n[1]! * 255, n[2]! * 255, a];
      if (v.startsWith('oklab(')) {
        const [L, A, B] = [n[0]!, n[1]!, n[2]!];
        const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
        const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
        const s2 = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
        const lin = [
          4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s2,
          -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s2,
          -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s2,
        ];
        const enc = (x: number) => 255 * Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
        return [...lin.map(enc), a];
      }
      return [n[0]!, n[1]!, n[2]!, a];
    };
    const over = (top: number[], under: number[]) => { const a = top[3]!; return [0, 1, 2].map((i) => top[i]! * a + under[i]! * (1 - a)).concat(1); };
    return els.map((el) => {
      // Layers from the element outwards; each is a list of alternative colours.
      const layers: number[][][] = [];
      let base: number[][] | null = null;
      for (let e: Element | null = el; e && !base; e = e.parentElement) {
        const cs = getComputedStyle(e);
        const bg = rgba(cs.backgroundColor);
        const stops = (cs.backgroundImage.match(/(?:rgba?|color|oklab|oklch|lab|lch)\([^)]*\)/g) ?? []).map(rgba);
        // backgroundImage paints over backgroundColor on the same element.
        const own: number[][][] = [];
        if (stops.length > 0) own.push(stops);
        if (bg[3]! > 0) own.push([bg]);
        for (const layer of own) {
          if (layer.every((c) => c[3]! >= 0.999)) { base = layer; break; }
          layers.push(layer);
        }
      }
      let grounds = base ?? [[255, 255, 255, 1]];
      for (const layer of layers.reverse()) grounds = grounds.flatMap((g) => layer.map((c) => over(c, g)));
      const fg = rgba(getComputedStyle(el).color);
      return { text: (el as HTMLElement).innerText.trim(), fgs: grounds.map((g) => over(fg, g)), grounds };
    });
  });
  expect(got.length, `vacuity guard: ${sel} matched nothing`).toBeGreaterThan(0);
  let worst = Infinity;
  for (const g of got) {
    g.grounds.forEach((ground, i) => {
      const [a, b] = [lum(g.fgs[i]!), lum(ground)].sort((x, y) => y - x);
      worst = Math.min(worst, (a! + 0.05) / (b! + 0.05));
    });
  }
  return worst;
}

