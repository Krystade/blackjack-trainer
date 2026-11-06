import { describe, expect, it } from 'vitest';
import { NOT_SETTINGS, SETTINGS_REGISTRY } from './settingsRegistry';
import types from '../store/types.ts?raw';
import settingsScreen from './screens/Settings.tsx?raw';
import profileEditor from './screens/ProfileEditor.tsx?raw';
import playControls from './components/ProfilePlayControls.tsx?raw';
import tabSheets from './components/TabSettingsButton.tsx?raw';
import tableControls from './components/TableControls.tsx?raw';

const FILES: Record<string, string> = {
  '../store/types.ts': types,
  './screens/Settings.tsx': settingsScreen,
  './screens/ProfileEditor.tsx': profileEditor,
  './components/ProfilePlayControls.tsx': playControls,
  './components/TabSettingsButton.tsx': tabSheets,
  './components/TableControls.tsx': tableControls,
};
const src = (f: string) => FILES[f]!;

/** Field names declared in an interface (or a nested `drill: {` block) of types.ts. */
function fields(block: RegExp): string[] {
  const t = src('../store/types.ts');
  const start = t.search(block);
  expect(start, `${block} found in types.ts`).toBeGreaterThanOrEqual(0);
  const out: string[] = [];
  let depth = 0;
  for (const line of t.slice(start).split('\n').slice(1)) {
    if (depth === 0) {
      const m = /^\s+([a-zA-Z0-9]+)\??:/.exec(line);
      if (m) out.push(m[1]!);
      if (/^\}/.test(line) || /^  \};/.test(line)) break;
    }
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (depth < 0) break;
  }
  return out;
}

const HOME_FILES: Record<string, string[]> = {
  app: ['./screens/Settings.tsx'],
  system: ['./screens/ProfileEditor.tsx', './components/ProfilePlayControls.tsx', './components/TableControls.tsx'],
  table: ['./screens/ProfileEditor.tsx', './components/ProfilePlayControls.tsx', './components/TableControls.tsx'],
};
const SHORTCUT_FILES = ['./components/TabSettingsButton.tsx', './components/ProfilePlayControls.tsx', './components/TableControls.tsx'];

/**
 * Today's drift, to be emptied by step 2 (the Settings/profile split): these
 * settings are drawn ONLY in a gear sheet, with no control at their home yet.
 */
const NOT_YET_AT_HOME = new Set<string>([]);

describe('settings registry (owner 2026-11-06)', () => {
  const paths = SETTINGS_REGISTRY.map((e) => e.path);

  it('lists each setting once', () => {
    expect(paths.length).toBe(new Set(paths).size);
    expect(paths.filter((x) => NOT_SETTINGS.includes(x))).toEqual([]);
  });

  it.each([
    ['profile', /^export interface Profile \{/m],
    ['settings', /^export interface Settings \{/m],
    ['settings.audio', /^export interface AudioSettings \{/m],
  ])('covers every field of %s', (prefix, re) => {
    const known = new Set([...paths, ...NOT_SETTINGS]);
    const missing = fields(re)
      .map((f) => `${prefix}.${f}`)
      .filter((k) => !known.has(k) && ![...known].some((x) => x.startsWith(`${k}.`)));
    expect(missing).toEqual([]);
  });

  it('covers every drill option', () => {
    const t = src('../store/types.ts');
    const body = t.slice(t.indexOf('  drill: {', t.indexOf('export interface Settings')));
    const drill = [...body.slice(0, body.indexOf('\n  };')).matchAll(/^    ([a-zA-Z0-9]+)\??:/gm)].map((m) => `settings.drill.${m[1]}`);
    expect(drill.length).toBeGreaterThan(10);
    expect(drill.filter((k) => !paths.includes(k))).toEqual([]);
  });

  it('draws each labelled setting at its home, and its shortcuts with the same label', () => {
    const problems: string[] = [];
    for (const e of SETTINGS_REGISTRY) {
      if (e.label === null || e.home === 'drill') continue;
      const has = (files: string[]) => files.some((f) => src(f).includes(`"${e.label}"`) || src(f).includes(`'${e.label}'`));
      if (!has(HOME_FILES[e.home]!) && !NOT_YET_AT_HOME.has(e.path) && !NOT_YET_AT_HOME.has(`${e.path}:${e.label}`))
        problems.push(`${e.path}: "${e.label}" not at its home (${e.home})`);
      if (e.shortcuts?.some((s) => s !== 'drills') && !has(SHORTCUT_FILES)) problems.push(`${e.path}: "${e.label}" not in its shortcut sheet`);
    }
    expect(problems).toEqual([]);
  });
});
