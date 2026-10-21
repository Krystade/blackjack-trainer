import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { segmentForClips } from '../src/audio/clips';
import type { ClipManifest } from '../src/audio/clips';
import { PRESET_IDS } from '../src/engine/variants/rules';
import { drawVariantItem, variantItemLegal } from '../src/drills/variantDrill';
import { narrateVariantCorrection, narrateVariantPrompt } from '../src/audio/narrateVariant';

/**
 * Wave L: everything the Variant hands drill says resolves to a recorded clip
 * in every shipped voice -- prompts for every item kind, and the correction
 * for every wrong answer the drill can grade.
 */
const CLIPS = fileURLToPath(new URL('../public/clips', import.meta.url));
const voices = (JSON.parse(readFileSync(`${CLIPS}/index.json`, 'utf8')) as { voices: { id: string }[] }).voices.map((v) => v.id);

function lines(): string[] {
  const out = new Set<string>();
  for (const preset of PRESET_IDS) {
    for (let seed = 1; seed <= 600; seed++) {
      const item = drawVariantItem(preset, seed);
      out.add(narrateVariantPrompt(item));
      for (const a of variantItemLegal(item)) {
        if (a !== item.advice.action) out.add(narrateVariantCorrection(false, item.advice.action, item.advice.reason));
      }
    }
  }
  out.add(narrateVariantCorrection(true, 'hit', ''));
  return [...out];
}

describe('variant drill clip coverage', () => {
  const all = lines();
  it('covers a real spread of lines', () => {
    expect(all.length).toBeGreaterThan(500);
    expect(all.some((l) => l.startsWith('Free hand.'))).toBe(true);
    expect(all.some((l) => l.startsWith('Doubled.'))).toBe(true);
    expect(all.some((l) => l.startsWith('Five cards.'))).toBe(true);
  });
  for (const voice of ['af_bella', 'bf_emma', 'bm_george']) {
    it(`every line resolves in ${voice}`, () => {
      expect(voices).toContain(voice);
      const manifest = (JSON.parse(readFileSync(`${CLIPS}/${voice}/manifest.json`, 'utf8')) as { clips: ClipManifest }).clips;
      expect(all.filter((t) => segmentForClips(t, manifest) === null)).toEqual([]);
    });
  }
});
