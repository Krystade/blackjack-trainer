import { describe, it, expect } from 'vitest';
import { ALLOWED, FALLBACK_REQUIRED, TOKEN, fontSizeDecls, isAllowed, offenders, scale } from './typeScale';

/**
 * G3: every font size is a step of the type scale in primitives.css, or is
 * listed in typeScale.ts's ALLOWED with the reason it is not.
 */
describe('type scale', () => {
  it('reads the real stylesheets (the scan is not silently empty)', () => {
    const decls = fontSizeDecls();
    expect(decls.length).toBeGreaterThan(250);
    expect(decls.some((d) => d.file === 'ui/app.css')).toBe(true);
    expect(decls.some((d) => d.file.endsWith('.tsx'))).toBe(true);
  });

  it('defines a small ascending scale, 2xs..2xl plus display steps', () => {
    const s = scale();
    expect(s.map((t) => t.name)).toEqual([
      '--fs-2xs', '--fs-xs', '--fs-sm', '--fs-md', '--fs-lg', '--fs-xl', '--fs-2xl',
      '--fs-3xl', '--fs-4xl', '--fs-5xl',
    ]);
    for (let i = 1; i < s.length; i++) expect(s[i]!.rem, s[i]!.name).toBeGreaterThan(s[i - 1]!.rem);
  });

  it('no font-size is a literal off the scale, and no token is undefined', () => {
    const bad = offenders().map((d) => `${d.file}:${d.line} ${d.selector} { font-size: ${d.value} } -- ${d.problem}`);
    expect(bad, 'use the nearest --fs-* step (primitives.css), or list it in scripts/typeScale.ts ALLOWED with a reason').toEqual([]);
  });

  it('every step of the scale is used', () => {
    const used = new Set(fontSizeDecls().map((d) => TOKEN.exec(d.value)?.[1]));
    expect(scale().map((t) => t.name).filter((n) => !used.has(n))).toEqual([]);
  });

  it('every ALLOWED entry still matches a declaration (no stale exceptions)', () => {
    const decls = fontSizeDecls();
    const stale = ALLOWED.filter((a) => !decls.some((d) => isAllowed(d) === a));
    expect(stale.map((a) => `${a.file} ${a.selector} ${a.value}`)).toEqual([]);
    for (const a of ALLOWED) expect(a.reason.length, `${a.selector} needs a reason`).toBeGreaterThan(10);
  });

  it('the stylesheet-free files carry a fallback on every size, equal to the step', () => {
    const steps = new Map(scale().map((t) => [t.name, t.rem]));
    for (const file of FALLBACK_REQUIRED) {
      const sizes = fontSizeDecls().filter((d) => d.file === file);
      expect(sizes.length, `${file} has inline sizes`).toBeGreaterThan(0);
      for (const d of sizes) {
        const t = TOKEN.exec(d.value);
        if (!t) continue; // a literal: renders without the stylesheet anyway
        expect(t[2], `${file}:${d.line} ${d.value}`).toBe(`${steps.get(t[1]!)}rem`);
      }
    }
  });

  it('the token pattern takes a fallback and checks it', () => {
    const at = (value: string, file = 'ui/components/ErrorBoundary.tsx') =>
      offenders([{ file, selector: '(inline)', value, line: 1 }]).map((d) => d.problem);
    expect(at('var(--fs-2xl, 1.4375rem)')).toEqual([]);
    expect(at('var(--fs-2xl)')[0]).toMatch(/needs a fallback/);
    expect(at('var(--fs-2xl, 1.4rem)')[0]).toMatch(/is not --fs-2xl/);
    expect(at('var(--fs-huge, 1rem)')[0]).toMatch(/not a step/);
    expect(at('var(--fs-2xl)', 'ui/app.css')).toEqual([]);
  });
});
