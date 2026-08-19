import { describe, it, expect } from 'vitest';
import { isStale, parseVersion, versionUrl, reloadUrl } from './updateCheck';

describe('parseVersion', () => {
  it('reads a buildId out of the served version document', () => {
    expect(parseVersion({ buildId: 'abc123' })).toBe('abc123');
  });

  // GitHub Pages serves its own 404 page for a missing file, so a fetch can
  // succeed and still hand back something that is not our version document.
  // Treating that as "a different build" would reload forever.
  it('returns null for anything that is not a version document', () => {
    expect(parseVersion(null)).toBe(null);
    expect(parseVersion(undefined)).toBe(null);
    expect(parseVersion('<!doctype html>')).toBe(null);
    expect(parseVersion({})).toBe(null);
    expect(parseVersion({ buildId: 42 })).toBe(null);
    expect(parseVersion({ buildId: '' })).toBe(null);
  });
});

describe('isStale', () => {
  it('is stale only when both ids are known and they differ', () => {
    expect(isStale('a', 'b')).toBe(true);
    expect(isStale('a', 'a')).toBe(false);
  });

  // Every uncertain case must be false. A reload loop in an installed
  // home-screen app is far worse than briefly running a stale build: the app
  // would relaunch endlessly and never become usable.
  it('never reloads on incomplete information', () => {
    expect(isStale(null, 'b')).toBe(false);
    expect(isStale('a', null)).toBe(false);
    expect(isStale(null, null)).toBe(false);
    expect(isStale('', 'b')).toBe(false);
  });
});

describe('versionUrl', () => {
  // The app deploys to a project subpath, so an absolute '/version.json'
  // would look for it at the domain root and 404 forever.
  it('resolves against the document, not the domain root', () => {
    expect(versionUrl('https://krystade.github.io/blackjack-trainer/')).toContain(
      '/blackjack-trainer/version.json',
    );
    expect(versionUrl('https://krystade.github.io/blackjack-trainer/index.html')).toContain(
      '/blackjack-trainer/version.json',
    );
  });

  it('carries a cache-busting parameter', () => {
    expect(versionUrl('https://example.com/app/')).toMatch(/[?&]t=/);
  });
});

describe('reloadUrl', () => {
  // iOS can hand a standalone home-screen app its cached HTML on launch, so
  // a plain reload can land on the very build we are trying to leave. A
  // changed query string forces a real fetch of the document.
  it('stamps the new build id onto the url', () => {
    expect(reloadUrl('https://example.com/app/', 'newid')).toBe(
      'https://example.com/app/?v=newid',
    );
  });

  it('replaces a previous stamp rather than accumulating them', () => {
    expect(reloadUrl('https://example.com/app/?v=oldid', 'newid')).toBe(
      'https://example.com/app/?v=newid',
    );
  });

  it('preserves other query parameters and the hash', () => {
    const out = reloadUrl('https://example.com/app/?e2e=1#drills', 'newid');
    expect(out).toContain('e2e=1');
    expect(out).toContain('v=newid');
    expect(out).toContain('#drills');
  });
});
