/**
 * THE TYPE SCALE AND WHAT IS STILL OFF IT (G3).
 *
 * src/ui/primitives.css defines `--fs-2xs` .. `--fs-5xl`. Every `font-size`
 * in the app's stylesheets (and every inline `fontSize` in a component) names
 * one of them, except the declarations listed in ALLOWED below, each with the
 * reason it is not a step of the scale.
 *
 * Run it to see the census:  node scripts/typeScale.ts
 * typeScale.test.ts fails on a new literal, on a token the scale does not
 * define, and on an ALLOWED entry that no longer matches anything.
 *
 * Here rather than under src/ because vitest hands a test an empty string for
 * a `.css?raw` import (see cssVars.test.ts).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SRC = fileURLToPath(new URL('../src', import.meta.url));

export interface Allowed {
  /** Path under src/, forward slashes. */
  file: string;
  /** The rule's selector, whitespace collapsed (or the component, for inline styles). */
  selector: string;
  value: string;
  reason: string;
}

export const ALLOWED: readonly Allowed[] = [
  // F9 (W2-20) sized the chart text by measurement against fixed tracks; the
  // fit is asserted in e2e/charts-text.spec.ts. Not moved onto the scale.
  { file: 'ui/screens/chartsText.css', selector: '.chart-cell, .chart-code', value: '0.8125rem', reason: 'F9 chart cell: two mono letters in the 28px dealer track' },
  { file: 'ui/screens/chartsText.css', selector: '.chart-up', value: '0.8125rem', reason: 'F9 dealer head, the size of the cells it heads' },
  { file: 'ui/screens/chartsText.css', selector: '.chart-corner', value: '0.6875rem', reason: 'F9 corner: six capitals in a 45px box' },
  { file: 'ui/screens/charts.css', selector: '.chart-rowlabel', value: '0.7rem', reason: "F9 keeps row labels at 0.7rem: 'A,9-10' fits its ~43px box only at this size" },
  { file: 'ui/screens/chartTest.css', selector: '.ct-corner', value: '0.6875rem', reason: "Chart test grid mirrors the F9 chart corner" },
  { file: 'ui/screens/chartTest.css', selector: '.ct-up', value: '0.8125rem', reason: 'Chart test grid mirrors the F9 dealer head' },
  { file: 'ui/screens/chartTest.css', selector: '.ct-cell', value: '0.8125rem', reason: 'Chart test grid mirrors the F9 cell' },

  // Fluid sizes: they track the viewport or container, so no single step fits.
  { file: 'ui/app.css', selector: '.action-btn', value: 'clamp(0.65rem, 2.9vw, 0.85rem)', reason: 'Fluid: five action buttons on one row at any width' },
  { file: 'ui/screens/tableGlance.css', selector: '.table-screen .action-btn', value: 'clamp(0.8125rem, 3.6vw, 1rem)', reason: "Fluid: Play's action row" },
  { file: 'ui/app.css', selector: '.zone-pad-quad', value: 'clamp(1.6rem, 8vmin, 2.4rem)', reason: 'Fluid: eyes-free pad labels scale with the pad' },
  { file: 'ui/app.css', selector: '.zone-pad-circle', value: 'clamp(0.85rem, 4.5cqmin, 1.4rem)', reason: 'Fluid: scales with its container' },
  { file: 'ui/app.css', selector: '.zone-pad-half', value: 'clamp(1.8rem, 9vmin, 2.6rem)', reason: 'Fluid: eyes-free pad labels scale with the pad' },
  { file: 'ui/components/cardSize.css', selector: ':is(.table-screen .dealer-area, .table-screen .hands-row, .count-flash-cards, .pair-cancel-cards) .card:not(.card-compact) .card-rank', value: 'calc(var(--card-w) * 0.34)', reason: "A card's rank scales with the card" },
  { file: 'ui/components/cardSize.css', selector: ':is(.table-screen .dealer-area, .table-screen .hands-row, .count-flash-cards, .pair-cancel-cards) .card:not(.card-compact) .card-suit', value: 'calc(var(--card-w) * 0.38)', reason: "A card's suit scales with the card" },
  { file: 'ui/screens/tableRewind.css', selector: '.rewind-replay .rewind-card .card-rank', value: 'calc(var(--card-w) * 0.34)', reason: "Wave X Rewind: the replayed card's rank scales with the card, as cardSize.css's do" },
  { file: 'ui/screens/tableRewind.css', selector: '.rewind-replay .rewind-card .card-suit', value: 'calc(var(--card-w) * 0.38)', reason: "Wave X Rewind: the replayed card's suit scales with the card, as cardSize.css's do" },

  // A floor a spec asserts: the nearest step (--fs-xs, 11.8px) is under it.
  { file: 'ui/screens/tableTopbar.css', selector: '.table-screen > .topbar .topbar-profile-name', value: '0.75rem', reason: 'F28: at least 12px to read in sunlight (e2e/topbar-profile-name.spec.ts)' },

  // Relative or not text at all.
  { file: 'ui/app.css', selector: '.session-assisted', value: '0.75em', reason: 'Relative to the line it annotates' },
  { file: 'ui/screens/Table.tsx', selector: 'topbar-profile-name', value: '0.7em', reason: 'Relative to the topbar line it sits in' },
  { file: 'ui/formControls.css', selector: '.settings-toggle', value: '30px', reason: 'Not text: the em basis that sizes the 44px toggle and its tick' },

  // One-off display numerals above the scale, each sized to its own box.
  { file: 'ui/app.css', selector: '.bsl-tc', value: '2.4rem', reason: 'Display numeral (bet-sizing true count)' },
  { file: 'ui/app.css', selector: '.mistake-eyes-free-answer', value: '2.1rem', reason: 'Display answer on the eyes-free mistake card' },
  { file: 'ui/app.css', selector: '.count-voice-value', value: '2.2rem', reason: 'Display numeral (spoken count)' },
  { file: 'ui/app.css', selector: '.testkit-word', value: '3rem', reason: 'Display word (Test kit target)' },
  { file: 'ui/screens/drills/betSizing.css', selector: '.bet-rc', value: '40px', reason: 'Display numeral (bet sizing running count)' },
  { file: 'ui/screens/drills/countLeadIn.css', selector: '.count-leadin-num', value: '5.5rem', reason: "Display numeral (the count drill's 3-2-1 lead-in, read at arm's length)" },
];

export interface Decl {
  file: string;
  selector: string;
  value: string;
  line: number;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const rel = (f: string) => relative(SRC, f).split(sep).join('/');

/** Every font-size declaration in every stylesheet, and every inline fontSize in a component. */
export function fontSizeDecls(): Decl[] {
  const out: Decl[] = [];
  for (const file of walk(SRC)) {
    if (file.endsWith('.css')) {
      const raw = readFileSync(file, 'utf8');
      // Comments blanked to the same length, so offsets still give line numbers.
      const css = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
      for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = rule[1]!.trim().replace(/\s+/g, ' ');
        const bodyAt = rule.index! + rule[1]!.length + 1;
        for (const d of rule[2]!.matchAll(/(?:^|[;\s])font-size\s*:\s*([^;]+?)\s*(?:!important)?\s*(?=;|$)/g)) {
          const line = css.slice(0, bodyAt + d.index!).split('\n').length;
          out.push({ file: rel(file), selector, value: d[1]!.trim(), line });
        }
      }
    } else if (/\.tsx$/.test(file) && !/\.test\.tsx$/.test(file)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/fontSize:\s*(['"`])([^'"`]*)\1/g)) {
        const before = src.slice(0, m.index!);
        const cls = /className="([^"]+)"[^\n]*$/.exec(before.slice(before.lastIndexOf('\n') + 1));
        out.push({ file: rel(file), selector: cls?.[1] ?? '(inline)', value: m[2]!, line: before.split('\n').length });
      }
      for (const m of src.matchAll(/fontSize:\s*(\d[\d.]*)/g)) {
        out.push({ file: rel(file), selector: '(inline number)', value: m[1]!, line: src.slice(0, m.index!).split('\n').length });
      }
    }
  }
  return out;
}

/** The scale as primitives.css defines it, in rem, smallest first. */
export function scale(): { name: string; rem: number }[] {
  const css = readFileSync(join(SRC, 'ui', 'primitives.css'), 'utf8');
  return [...css.matchAll(/(--fs-[a-z0-9]+)\s*:\s*([\d.]+)rem\s*;/g)].map((m) => ({ name: m[1]!, rem: Number(m[2]) }));
}

/** `var(--fs-x)`, or `var(--fs-x, <fallback>)` where a stylesheet may be missing. */
export const TOKEN = /^var\((--fs-[a-z0-9]+)\s*(?:,\s*([^()]+?)\s*)?\)$/;

/**
 * Files whose inline sizes must still render with no stylesheet at all, so a
 * token there has to carry a literal fallback equal to the step's value.
 * ErrorBoundary: "app.css may itself be implicated, and this screen has to
 * render no matter what".
 */
export const FALLBACK_REQUIRED: readonly string[] = ['ui/components/ErrorBoundary.tsx'];

export function isAllowed(d: Decl): Allowed | undefined {
  return ALLOWED.find((a) => a.file === d.file && a.selector === d.selector && a.value === d.value);
}

/** Why a token declaration is wrong, or undefined if it is fine. */
function tokenProblem(d: Decl, t: RegExpExecArray, steps: Map<string, number>): string | undefined {
  const name = t[1]!;
  const fallback = t[2];
  const rem = steps.get(name);
  if (rem === undefined) return `${name} is not a step of the scale`;
  if (fallback === undefined) {
    return FALLBACK_REQUIRED.includes(d.file) ? `${name} needs a fallback (${rem}rem): this file renders without the stylesheet` : undefined;
  }
  const f = /^([\d.]+)rem$/.exec(fallback);
  if (!f || Number(f[1]) !== rem) return `fallback ${fallback} is not ${name}'s value, ${rem}rem`;
  return undefined;
}

/** Literal sizes not on the scale and not listed in ALLOWED, and tokens that are undefined or carry a wrong (or missing, where required) fallback. */
export function offenders(decls = fontSizeDecls()): (Decl & { problem: string })[] {
  const steps = new Map(scale().map((s) => [s.name, s.rem]));
  const out: (Decl & { problem: string })[] = [];
  for (const d of decls) {
    const t = TOKEN.exec(d.value);
    const problem = t ? tokenProblem(d, t, steps) : isAllowed(d) ? undefined : 'literal off the scale';
    if (problem) out.push({ ...d, problem });
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const decls = fontSizeDecls();
  const literal = decls.filter((d) => !TOKEN.test(d.value));
  console.log(`${decls.length} font-size declarations, ${decls.length - literal.length} on the scale, ${literal.length} literal:`);
  for (const d of literal) {
    const a = isAllowed(d);
    console.log(`  ${a ? 'allowed' : 'OFF-SCALE'}  ${d.file}:${d.line}  ${d.selector}  ${d.value}${a ? `  -- ${a.reason}` : ''}`);
  }
  const bad = offenders(decls);
  for (const d of bad) console.log(`  BAD  ${d.file}:${d.line}  ${d.selector}  ${d.value}  -- ${d.problem}`);
  if (bad.length) process.exitCode = 1;
}
