import { describe, expect, it } from 'vitest';

// The engine is the bottom layer: drills, store and UI build on it, never the
// other way round (review of C16, which had game.ts import from drills/).
const sources = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('engine layering', () => {
  it('reads the engine sources', () => {
    expect(Object.keys(sources)).toContain('./game.ts');
  });
  it('no engine source imports from drills/', () => {
    const bad = Object.entries(sources)
      .filter(([, text]) => /from '(\.\.\/)+drills\//.test(text))
      .map(([path]) => path);
    expect(bad).toEqual([]);
  });
});
