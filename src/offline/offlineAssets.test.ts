import { describe, it, expect } from 'vitest';
import { shellUrls, clipUrlsFor, VERSION_FILE } from './offlineAssets';

describe('shellUrls', () => {
  const origin = 'https://krystade.github.io';

  it('includes the document itself, without which nothing launches offline', () => {
    // The one entry that cannot be recovered later: with no cached document the
    // installed app opens to Safari's "no internet" page and there is nothing
    // to run.
    const urls = shellUrls({
      documentUrl: `${origin}/blackjack-trainer/index.html`,
      resources: [`${origin}/blackjack-trainer/assets/index-abc.js`],
      origin,
    });
    expect(urls).toContain(`${origin}/blackjack-trainer/index.html`);
  });

  it('drops the query string off the document', () => {
    // A document cached as `index.html?e2e=1` is not what a plain launch asks
    // for, so the cache would miss and the app would still be dead offline.
    const urls = shellUrls({
      documentUrl: `${origin}/blackjack-trainer/?e2e=1`,
      resources: [],
      origin,
    });
    expect(urls).toEqual([`${origin}/blackjack-trainer/`]);
  });

  it('leaves other origins alone', () => {
    // Storing someone else's asset is both useless (opaque responses cannot be
    // read back) and not ours to hold.
    const urls = shellUrls({
      documentUrl: `${origin}/app/`,
      resources: ['https://fonts.gstatic.com/s/x.woff2', `${origin}/app/assets/a.css`],
      origin,
    });
    expect(urls).not.toContain('https://fonts.gstatic.com/s/x.woff2');
    expect(urls).toContain(`${origin}/app/assets/a.css`);
  });

  it('never caches the file the update check reads', () => {
    /*
     * THE TRAP IN EVERY OFFLINE APP. `updateCheck` polls version.json to find
     * out whether a newer build has shipped. Cache that and the answer is
     * frozen at whatever shipped the day the cache was warmed, so an installed
     * phone can never be told to update again.
     */
    const urls = shellUrls({
      documentUrl: `${origin}/app/`,
      resources: [`${origin}/app/${VERSION_FILE}`, `${origin}/app/assets/a.js`],
      origin,
    });
    expect(urls.some((u) => u.endsWith(VERSION_FILE))).toBe(false);
  });

  it('lists each url once', () => {
    const urls = shellUrls({
      documentUrl: `${origin}/app/`,
      resources: [`${origin}/app/a.js`, `${origin}/app/a.js`, `${origin}/app/`],
      origin,
    });
    expect(urls).toEqual([`${origin}/app/`, `${origin}/app/a.js`]);
  });
});

describe('clipUrlsFor', () => {
  it('lists the index, the manifest and every clip of the chosen voice', () => {
    const urls = clipUrlsFor('af_bella', { ace: 'ace-item.mp3', two: 'two-item.mp3' }, './');
    expect(urls).toEqual([
      './clips/index.json',
      './clips/af_bella/manifest.json',
      './clips/af_bella/ace-item.mp3',
      './clips/af_bella/two-item.mp3',
    ]);
  });

  it('lists a file shared by two phrases once', () => {
    // The manifest is keyed by phrase, and several phrases map to the same
    // recording. Counting it twice makes the progress total a lie.
    const urls = clipUrlsFor('v', { a: 'same.mp3', b: 'same.mp3' }, './');
    expect(urls.filter((u) => u.endsWith('same.mp3'))).toHaveLength(1);
  });

  it('asks for nothing but the index when the manifest is empty', () => {
    // `loadVoiceManifest` resolves to `{}` on any failure, and a download that
    // reported "2 files, done" on that would send Jack onto a plane with
    // nothing but live speech.
    expect(clipUrlsFor('v', {}, './')).toEqual(['./clips/index.json', './clips/v/manifest.json']);
  });
});
