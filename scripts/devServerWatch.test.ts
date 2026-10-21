import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import config from '../vite.config.ts';

/**
 * The dev server must not watch the lane worktrees under .claude/worktrees/.
 *
 * Measured on the main checkout on 2026-10-21: with them watched, a fresh
 * `vite` held the first page load for 48-50s (the readiness probe on `/`
 * answered in under a second, so Playwright started straight into the stall);
 * with them ignored, 2.4s. This builds a dev server from the project's real
 * `server.watch` over a scratch root holding both an app file and a nested
 * lane, and asks the watcher what it actually watches.
 */

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function put(rel: string, body: string): void {
  const file = join(root!, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
}

describe('dev server watcher', () => {
  it('watches the app source but not .claude/worktrees', async () => {
    root = mkdtempSync(join(tmpdir(), 'bj-watch-'));
    put('index.html', '<script type="module" src="/src/a.ts"></script>');
    put('src/a.ts', 'export const a = 1;');
    put('.claude/worktrees/lane/index.html', '<script type="module" src="/src/b.ts"></script>');
    put('.claude/worktrees/lane/src/b.ts', 'export const b = 1;');
    put('other/worktrees/lane/src/c.ts', 'export const c = 1;');

    const server = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      server: { ...config.server, hmr: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      // `ready` is no signal here: Vite's watcher emits it before the crawl.
      // So wait for a lane-shaped directory OUTSIDE .claude, at the same depth,
      // and then for the watched set to stop growing -- by then the crawl has
      // reached whatever it was going to reach.
      const watched = () =>
        Object.keys(server.watcher.getWatched()).map((d) => d.replace(/\\/g, '/'));
      await vi.waitFor(() => expect(watched().some((d) => d.endsWith('/other/worktrees/lane/src'))).toBe(true), {
        timeout: 10_000,
      });
      let size = -1;
      await vi.waitFor(
        () => {
          const now = watched().length;
          const settled = now === size;
          size = now;
          expect(settled).toBe(true);
        },
        { timeout: 10_000, interval: 200 },
      );
      const dirs = watched();
      expect(dirs.some((d) => d.endsWith('/src'))).toBe(true);
      expect(dirs.filter((d) => d.includes('/.claude'))).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
