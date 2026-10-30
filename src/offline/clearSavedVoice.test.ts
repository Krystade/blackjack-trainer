import { describe, it, expect } from 'vitest';
import { clearSavedVoice } from './warmForFlight';

/** B26: removing the saved voice keeps the app shell, so an offline cold launch still opens. */
describe('clearSavedVoice', () => {
  it('deletes the clips and nothing else', async () => {
    const base = 'https://example.github.io/blackjack-trainer/';
    const urls = [
      base,
      `${base}index.html`,
      `${base}assets/index-abc.js`,
      `${base}icons/icon-192.png`,
      `${base}manifest.webmanifest`,
      `${base}clips/af_bella/manifest.json`,
      `${base}clips/af_bella/hit.mp3`,
      `${base}clips/af_bella/stand.mp3`,
    ];
    const held = new Set(urls);
    const cache = {
      keys: async () => [...held].map((u) => new Request(u)),
      delete: async (r: Request) => held.delete(r.url),
    };
    expect(await clearSavedVoice(cache)).toBe(3);
    expect([...held]).toEqual(urls.slice(0, 5));
  });
});
