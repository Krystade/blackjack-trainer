/**
 * Every `bjtrainer.*` key that appears anywhere in `src/`, read from the
 * source rather than restated.
 *
 * TWO tests need this and they ask different questions of it: `crossTab.test`
 * asks whether a key is synced between tabs, `persistHardening.test` whether
 * it is carried by a backup. A key can honestly be one and not the other. What
 * they must not disagree about is the SET of keys -- two scanners drifting by
 * one character in a regex would leave one test quietly covering less than it
 * claims, which is the failure both of them exist to prevent.
 *
 * Scanned, not listed. The first version of the cross-tab test restated its
 * key list as a literal and compared the two, which can only fail if someone
 * edits both halves inconsistently: it said "covers every key the app
 * persists" while having no way to learn of a new key, and passed green with
 * `bjtrainer.fieldTestRun.v1` unenrolled for as long as that key existed.
 *
 * Vite's glob rather than `node:fs`: `tsconfig.app.json` declares
 * `types: ["vite/client"]` and no node types, so `fs` does not typecheck under
 * `src/` -- and the glob is resolved at transform time, so a path that stops
 * matching fails loudly at build instead of silently returning nothing.
 *
 * This file is imported only by tests. It is under `src/` so that it is
 * typechecked by `tsc -b` along with everything it scans, and no application
 * module imports it, so none of it reaches the bundle.
 */
export function persistedStorageKeys(): string[] {
  const sources = import.meta.glob('../**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  const found = new Set<string>();
  for (const [file, src] of Object.entries(sources)) {
    if (/\.test\.tsx?$/.test(file)) continue;
    // Hyphens included: no key uses one today, and a scanner that is a
    // superset of the keys can only ever over-report, which fails loudly.
    for (const m of src.matchAll(/'(bjtrainer\.[A-Za-z0-9._-]+)'/g)) found.add(m[1]!);
  }
  return [...found].sort();
}
