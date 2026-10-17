import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { THEMES, THEME_COLOR } from '../src/ui/theme';

/**
 * Three copies of each theme's background colour must agree: themes.css
 * (`--bg`, what the page paints), theme.ts (`THEME_COLOR`, what applyTheme
 * writes to `<meta name="theme-color">`), and index.html's pre-paint script,
 * which runs before any bundle has loaded and so cannot import either.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const themesCss = read('../src/ui/themes.css');
const indexHtml = read('../index.html');

function cssBg(id: string): string | null {
  const start = themesCss.indexOf(`:root[data-theme='${id}']`);
  if (start < 0) return null;
  const block = themesCss.slice(start, themesCss.indexOf('}', start));
  const m = /--bg:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(block);
  return m ? m[1]!.toLowerCase() : null;
}

describe('theme-color', () => {
  it('covers every theme', () => {
    expect(Object.keys(THEME_COLOR).sort()).toEqual(THEMES.map((t) => t.id).sort());
  });

  for (const t of THEMES) {
    it(`${t.id}: theme.ts matches themes.css --bg`, () => {
      expect(THEME_COLOR[t.id]).toBe(cssBg(t.id));
    });

    it(`${t.id}: index.html's pre-paint script knows the id and the colour`, () => {
      expect(indexHtml).toContain(`'${t.id}': '${THEME_COLOR[t.id]}'`);
    });
  }

  it('the pre-paint script reads the key the settings are stored under', () => {
    const persist = read('../src/store/persist.ts');
    const key = /SETTINGS_KEY\s*=\s*'([^']+)'/.exec(persist)?.[1];
    expect(key).toBeTruthy();
    expect(indexHtml).toContain(`localStorage.getItem('${key}')`);
  });
});
