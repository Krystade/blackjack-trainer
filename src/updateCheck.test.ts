import { describe, it, expect, afterEach } from 'vitest';
import {
  buildLabel,
  formatBuiltAt,
  isStale,
  parseVersion,
  versionUrl,
  reloadUrl,
  startUpdateWatch,
} from './updateCheck';

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

/**
 * The build line on Home.
 *
 * It exists because an installed home-screen app can sit on a cached bundle
 * without saying so, and the reload that is supposed to prevent that is not
 * something the operator can verify from the driveway.
 */
describe('buildLabel', () => {
  it('shows a CI build as the bare id, so it compares to version.json', () => {
    expect(buildLabel('2d6a5b851925')).toBe('2d6a5b851925');
  });

  // A local build must not be mistakable for something that was deployed.
  it('marks a local build as local', () => {
    expect(buildLabel('dev-m8x2k1')).toContain('local');
  });

  it('says so rather than rendering nothing when there is no stamp', () => {
    expect(buildLabel(null)).toBe('unknown build');
  });
});

/**
 * The build date.
 *
 * The id answers "is this the same build as before?", which needs something
 * to compare against. The date answers "how old is what I am running?" with
 * nothing to hand, which is the question actually asked after a deploy.
 */
describe('formatBuiltAt', () => {
  it('renders a real stamp as a readable date', () => {
    const out = formatBuiltAt('2026-09-10T08:05:00.000Z');
    expect(out).toBeTruthy();
    // Locale-dependent, so assert the facts every locale must carry.
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/\d/);
  });

  /**
   * A bad stamp must drop the date, not print "Invalid Date" on the home
   * screen -- the line exists to be trusted at a glance.
   */
  it('drops an unparseable stamp rather than showing garbage', () => {
    expect(formatBuiltAt('not a date')).toBe(null);
    expect(formatBuiltAt('')).toBe(null);
    expect(formatBuiltAt(null)).toBe(null);
  });

  it('never returns the string Invalid Date', () => {
    for (const bad of ['x', '2026-13-45T99:99:99Z', 'undefined']) {
      // Dropping it entirely (null) is the correct outcome; what must never
      // happen is the browser's failure string reaching the screen.
      expect(formatBuiltAt(bad) ?? '').not.toContain('Invalid');
    }
  });
});

/**
 * The reload is the point of this module, and it is also a hazard.
 *
 * It fires from `visibilitychange`, `pageshow` and `focus`, so answering a
 * phone call mid-drive was enough to restart the app in the middle of a
 * measured protocol — and what the operator met afterwards was the Home
 * screen, moving, with no line playing. The new build is not abandoned: it is
 * taken on the next foreground event after the run goes quiet.
 */
describe('a reload while somebody is in the middle of something', () => {
  /** A window, a document and a network: enough for the watch to run in node. */
  function installBrowser(deployedId: string) {
    const session = new Map<string, string>();
    const listeners: Record<string, (() => void)[]> = {};
    const on = (type: string, fn: () => void) => {
      (listeners[type] ??= []).push(fn);
    };
    const env = {
      replaced: null as string | null,
      fire(type: string) {
        for (const fn of listeners[type] ?? []) fn();
      },
      settle: () => new Promise((r) => setTimeout(r, 0)),
    };
    const g = globalThis as unknown as Record<string, unknown>;
    g.window = {
      location: {
        href: 'https://example.test/app/',
        replace: (url: string) => {
          env.replaced = url;
        },
      },
      addEventListener: on,
      removeEventListener: () => {},
      // A REAL MAP, not a pair of stubs. `markTried` writes the attempted
      // build id here and `alreadyTried` reads it back, so a harness that
      // forgets everything cannot tell a deferral from an attempt -- which is
      // precisely the distinction the deferral depends on.
      sessionStorage: {
        getItem: (k: string) => session.get(k) ?? null,
        setItem: (k: string, v: string) => void session.set(k, v),
      },
    };
    g.document = { visibilityState: 'visible', addEventListener: on, removeEventListener: () => {} };
    g.fetch = () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ buildId: deployedId }) });
    return env;
  }

  afterEach(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    delete g.window;
    delete g.document;
    delete g.fetch;
  });

  /** An id the running build cannot have; `isStale` needs both known and different. */
  const OTHER = 'a-build-this-is-not';

  it('still reloads when nothing is in the way, which is the whole point', async () => {
    const env = installBrowser(OTHER);
    const stop = startUpdateWatch({ minIntervalMs: 0 });
    await env.settle();
    expect(env.replaced, 'the update was never taken at all').toContain(OTHER);
    stop();
  });

  it('waits, rather than restarting the app under them', async () => {
    const env = installBrowser(OTHER);
    const stop = startUpdateWatch({ minIntervalMs: 0, deferWhile: () => true });
    await env.settle();
    expect(env.replaced, 'the app reloaded in the middle of a run').toBeNull();
    stop();
  });

  it('takes the update once nobody is in it', async () => {
    const env = installBrowser(OTHER);
    let busy = true;
    const stop = startUpdateWatch({ minIntervalMs: 0, deferWhile: () => busy });
    await env.settle();
    expect(env.replaced).toBeNull();

    // A DEFERRAL IS NOT AN ATTEMPT. The once-per-build mark is written when
    // the reload is actually made, so deferring ahead of it is what leaves the
    // next foreground event free to try again.
    busy = false;
    env.fire('focus');
    await env.settle();
    expect(env.replaced, 'the deferred update was never taken').toContain(OTHER);
    stop();
  });
});
