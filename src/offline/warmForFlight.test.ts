import { describe, it, expect } from 'vitest';
import { warmForFlight } from './warmForFlight';
import { VERSION_FILE } from './offlineAssets';
import type { CacheLike } from './warmCache';

function fakeCache(): CacheLike & { stored: string[] } {
  const stored: string[] = [];
  return {
    stored,
    match: async () => undefined,
    put: async (url) => void stored.push(String(url)),
  };
}

const ok = async (): Promise<Response> =>
  ({ ok: true, status: 200, headers: new Headers({ 'content-length': '10' }) }) as Response;

describe('warmForFlight', () => {
  it('saves the app and the chosen voice, because missing either one is a dead flight', async () => {
    const cache = fakeCache();

    await warmForFlight({
      documentUrl: 'https://x.test/app/',
      origin: 'https://x.test',
      resources: ['https://x.test/app/assets/index-abc.js'],
      clipsBase: './',
      voiceId: 'af_bella',
      loadManifest: async () => ({ ace: 'ace-item.mp3', two: 'two-item.mp3' }),
      cache,
      fetchFn: ok,
    });

    // The shell: without the document there is nothing to launch.
    expect(cache.stored).toContain('https://x.test/app/');
    expect(cache.stored).toContain('https://x.test/app/assets/index-abc.js');
    // The voice: without the clips it runs, and speaks in the wrong voice.
    expect(cache.stored).toContain('./clips/af_bella/ace-item.mp3');
    expect(cache.stored).toContain('./clips/af_bella/manifest.json');
  });

  it('saves the app even with no clip voice chosen', async () => {
    // "Automatic" is a real setting, and a download that did nothing at all
    // for it would leave the operator believing the app was saved.
    const cache = fakeCache();

    const result = await warmForFlight({
      documentUrl: 'https://x.test/app/',
      origin: 'https://x.test',
      resources: ['https://x.test/app/assets/index-abc.js'],
      clipsBase: './',
      voiceId: null,
      loadManifest: async () => {
        throw new Error('must not be asked');
      },
      cache,
      fetchFn: ok,
    });

    expect(result.cached).toBeGreaterThanOrEqual(2);
    expect(result.failed).toEqual([]);
    expect(cache.stored).toContain('https://x.test/app/');
    expect(cache.stored).toContain('https://x.test/app/assets/index-abc.js');
  });

  it('leaves the update file out of the saved set', async () => {
    // End to end, not just in `shellUrls`: a cached version.json is how an
    // installed phone stops being able to learn that a new build exists.
    const cache = fakeCache();

    await warmForFlight({
      documentUrl: 'https://x.test/app/',
      origin: 'https://x.test',
      resources: [`https://x.test/app/${VERSION_FILE}`, 'https://x.test/app/assets/a.js'],
      clipsBase: './',
      voiceId: null,
      loadManifest: async () => ({}),
      cache,
      fetchFn: ok,
    });

    expect(cache.stored.some((u) => u.endsWith(VERSION_FILE))).toBe(false);
  });
});
