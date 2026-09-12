/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * A stamp identifying this build, frozen once per `vite build`.
 *
 * It is baked into the bundle as `__BUILD_ID__` AND written to `version.json`
 * beside it, so a running tab can ask "is the deployed build still the one I
 * am running?" by fetching one small file. Prefer the commit SHA in CI so the
 * stamp is meaningful; fall back to a timestamp locally.
 */
const BUILD_ID =
  process.env.GITHUB_SHA?.slice(0, 12) ?? `dev-${Date.now().toString(36)}`;

/**
 * When this build was made, frozen at the same moment as the id above.
 *
 * The id alone answers "is this the same build as before?", which needs
 * something to compare against. A date answers "how old is what I am running?"
 * on its own, which is the question actually being asked after a deploy.
 */
const BUILT_AT = new Date().toISOString();

export default defineConfig({
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __BUILT_AT__: JSON.stringify(BUILT_AT),
  },
  plugins: [
    react(),
    {
      // Emitted as a real asset rather than a file in public/ so it can never
      // drift from the `__BUILD_ID__` compiled into the same bundle -- both
      // come from the constant above, in one build.
      name: 'emit-version-json',
      // Served in dev from the same constant, so the update check and the
      // build line on Home behave here exactly as they do deployed --
      // otherwise both are only ever exercised in production.
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url || !req.url.split('?')[0]?.endsWith('/version.json')) return next();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ buildId: BUILD_ID, builtAt: BUILT_AT }));
        });
      },
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ buildId: BUILD_ID, builtAt: BUILT_AT }),
        });
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // vitest's default is 5s per test, and this suite has property tests that
    // legitimately run 1-2s locally -- the clip-coverage walks and the
    // flashcard draw distributions, which rebuild all 330 cells per call. On
    // a CI runner roughly twice as slow that margin is gone: the V4-1 deploy
    // failed outright on two of them timing out, with nothing actually wrong.
    // A timeout is a safety net against a hang, not an assertion, so it is
    // set where it catches hangs rather than where it fails slow machines.
    testTimeout: 30_000,
  },
});
