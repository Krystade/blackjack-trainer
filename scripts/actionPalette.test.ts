import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * F8 (W2-19, D4): ONE ACTION PALETTE, DEFINED ONCE.
 *
 * Charts restated `--act-*` on `.charts-screen` (slate surrender) while
 * themes.css gave the painter its own set (brown surrender), so the same
 * decision was two colours depending on the screen. The tokens now live in
 * themes.css only; this keeps it that way, and checks each family's ink
 * against its own fill in every theme from the values themselves.
 *
 * Here rather than under src/ for the reason cssVars.test.ts gives: vitest
 * hands a `.css?raw` import an empty string.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const THEMES_CSS = join(SRC, 'ui', 'themes.css');
const FAMILIES = ['hit', 'stand', 'double', 'split', 'surrender'] as const;
const THEME_IDS = ['midnight-felt', 'bone-ink', 'amoled-night', 'slate-copper'] as const;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The `--act-*` declarations of each theme block in themes.css. */
function themeTokens(): Map<string, Map<string, string>> {
  const css = stripComments(readFileSync(THEMES_CSS, 'utf8'));
  const out = new Map<string, Map<string, string>>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1]!.trim();
    const ids = THEME_IDS.filter((id) => selector.includes(`'${id}'`));
    if (ids.length === 0) continue;
    const tokens = new Map<string, string>();
    for (const d of m[2]!.matchAll(/(--act-[a-z-]+)\s*:\s*([^;]+);/g)) tokens.set(d[1]!, d[2]!.trim());
    for (const id of ids) out.set(id, tokens);
  }
  return out;
}

function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('F8: the action palette', () => {
  it('declares --act-* in themes.css and nowhere else', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const file of walk(SRC).filter((f) => /\.(css|tsx?)$/.test(f) && !/\.test\.tsx?$/.test(f))) {
      scanned += 1;
      if (file === THEMES_CSS) continue;
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/(--act-[a-z-]+)\s*:/g)) offenders.push(`${file.slice(SRC.length + 1)}: ${m[1]}`);
      for (const m of text.matchAll(/setProperty\(\s*['"`](--act-[a-z-]+)/g)) offenders.push(`${file.slice(SRC.length + 1)}: ${m[1]}`);
    }
    expect(scanned, 'the scan found no source files').toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });

  it('every theme defines a fill and its own ink for all five families, and nothing else', () => {
    const tokens = themeTokens();
    expect([...tokens.keys()].sort()).toEqual([...THEME_IDS].sort());
    const want = FAMILIES.flatMap((f) => [`--act-${f}`, `--act-${f}-ink`]).sort();
    for (const id of THEME_IDS) {
      expect([...tokens.get(id)!.keys()].sort(), id).toEqual(want);
      for (const v of tokens.get(id)!.values()) expect(v, id).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("each family's ink is at least 4.5:1 on its own fill in every theme", () => {
    const tokens = themeTokens();
    const fails: string[] = [];
    for (const id of THEME_IDS) {
      const t = tokens.get(id)!;
      for (const f of FAMILIES) {
        const r = contrast(t.get(`--act-${f}`)!, t.get(`--act-${f}-ink`)!);
        if (!(r >= 4.5)) fails.push(`${id} ${f} ${r.toFixed(2)}`);
      }
    }
    expect(fails).toEqual([]);
  });

  it('the families stay separable: no two fills in a theme are the same colour', () => {
    const tokens = themeTokens();
    for (const id of THEME_IDS) {
      const fills = FAMILIES.map((f) => tokens.get(id)!.get(`--act-${f}`)!.toLowerCase());
      expect(new Set(fills).size, id).toBe(FAMILIES.length);
    }
  });
});
