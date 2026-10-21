import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Wave O: what the first paint loads. The entry chunk had grown to 845KB
 * (1.09MB with its preloads) because Play, two drills and Stats pulled the
 * generated side-bet tables and the variant strategy charts in statically.
 * This walks the STATIC import graph from src/main.tsx -- `import type` and
 * `import()` excluded, which is exactly what the bundler keeps out of the
 * first load -- and pins that the heavy modules are not in it.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null; // a package
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.(ts|tsx|json)$/.test(c) && existsSync(c)) return c;
  }
  return null;
}

function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith('.json')) continue;
    const src = readFileSync(file, 'utf8');
    // `import x from '...'`, `import '...'`, `export ... from '...'`; never `import type` / `export type`.
    const re = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
    for (const m of src.matchAll(re)) {
      const to = resolveImport(file, m[1]!);
      if (to) stack.push(to);
    }
  }
  return seen;
}

describe('Wave O: the first-paint import graph', () => {
  const graph = [...staticGraph(resolve(SRC, 'main.tsx'))].map((f) => f.slice(SRC.length + 1).split(sep).join('/'));

  it('reaches the app shell (the walk works)', () => {
    expect(graph).toContain('ui/App.tsx');
    expect(graph).toContain('ui/screens/Home.tsx');
    expect(graph.length).toBeGreaterThan(100);
  });

  it.each([
    'engine/sideBets/generated.ts',
    'engine/variants/strategy.ts',
    'ui/screens/VariantCharts.tsx',
    'ui/screens/Stats.tsx',
    'ui/screens/Progress.tsx',
    'ui/screens/Table.tsx',
    'ui/screens/SideBets.tsx',
    'ui/screens/casino/Casino.tsx',
    'ui/screens/drills/SideCountDrillView.tsx',
    'ui/screens/drills/VariantDrillView.tsx',
  ])('%s is not loaded at first paint', (mod) => {
    expect(graph).not.toContain(mod);
  });
});
