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

export default defineConfig({
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    {
      // Emitted as a real asset rather than a file in public/ so it can never
      // drift from the `__BUILD_ID__` compiled into the same bundle -- both
      // come from the constant above, in one build.
      name: 'emit-version-json',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ buildId: BUILD_ID }),
        });
      },
    },
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
