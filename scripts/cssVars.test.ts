import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * EVERY `var(--x)` IN THE CSS NAMES A PROPERTY SOMETHING DEFINES (F12).
 *
 * app.css used `--panel`, `--muted`, `--danger`, `--warn`, `--border` and
 * `--text`, which no theme defines, so each fell back to its literal and
 * ignored the theme everywhere -- the wheel self-check banner's answer was
 * 1.01:1 in Bone & Ink. A fallback hides the bug, so a fallback does not
 * count as a definition here.
 *
 * Defined means declared as `--x:` in any stylesheet, or set from code
 * (`style.setProperty('--x', ...)` or an inline style key `'--x'`).
 *
 * Here rather than under src/ because vitest hands a test an empty string
 * for a `.css?raw` import, which would make this pass on nothing.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

function scan() {
  const files = walk(SRC).filter((f) => /\.(css|tsx?)$/.test(f) && !/\.test\.tsx?$/.test(f));
  const defined = new Set<string>();
  const used = new Map<string, Set<string>>();
  let cssFiles = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) defined.add(m[1]!);
    for (const m of text.matchAll(/["'`](--[a-zA-Z0-9_-]+)["'`]/g)) defined.add(m[1]!);
    if (!file.endsWith('.css')) continue;
    cssFiles += 1;
    for (const m of text.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)) {
      const name = m[1]!;
      if (!used.has(name)) used.set(name, new Set());
      used.get(name)!.add(file.slice(SRC.length + 1).split('\\').join('/'));
    }
  }
  return { defined, used, cssFiles };
}

describe('CSS custom properties', () => {
  it('reads the real stylesheets (the scan is not silently empty)', () => {
    const { cssFiles, used, defined } = scan();
    expect(cssFiles).toBeGreaterThan(5);
    expect(used.size).toBeGreaterThan(20);
    expect(defined.has('--ink')).toBe(true);
  });

  it('every var(--x) used in a stylesheet is defined somewhere', () => {
    const { defined, used } = scan();
    const undefinedVars = [...used]
      .filter(([name]) => !defined.has(name))
      .map(([name, files]) => `${name} (${[...files].join(', ')})`);
    expect(undefinedVars, 'map these to theme tokens (themes.css)').toEqual([]);
  });
});

/**
 * SECONDARY TEXT IS NOT FADED TWICE.
 *
 * `--ink-dim` is already the dimmed ink, tuned to clear AA (4.5:1) in every
 * theme with little to spare: about 6.2:1 in Bone & Ink and AMOLED Night. A
 * rule that also sets `opacity: 0.8` on it lands at 3.96:1 and 4.22:1 -- the
 * Test Kit's why/note text did exactly that once --ink-muted was mapped to
 * --ink-dim, and the count drill's voice hint had done it all along.
 */
describe('dimmed text', () => {
  it('no rule colours text --ink-dim and then lowers its opacity', () => {
    const offenders: string[] = [];
    let rules = 0;
    for (const file of walk(SRC).filter((f) => f.endsWith('.css'))) {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const body = m[2]!;
        if (!/(?:^|[;\s])color\s*:\s*var\(--ink-dim\)/.test(body)) continue;
        rules += 1;
        const op = /(?:^|[;\s])opacity\s*:\s*([\d.]+)/.exec(body);
        if (op && Number(op[1]) < 1) {
          offenders.push(`${m[1]!.trim().replace(/\s+/g, ' ')} (opacity ${op[1]})`);
        }
      }
    }
    expect(rules, 'the scan found no --ink-dim text at all').toBeGreaterThan(5);
    expect(offenders, 'drop the opacity: --ink-dim is already dimmed').toEqual([]);
  });
});
