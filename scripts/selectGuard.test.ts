import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Wave X (item 4): `-webkit-touch-callout` is computed only by iOS WebKit, so
 * no headless browser here can observe it; the rule is read from the sheet.
 * The selection half is proven in a real browser (e2e/select-guard.spec.ts).
 */
const css = readFileSync(new URL('../src/ui/selectGuard.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function rules(): { selectors: string[]; body: Record<string, string> }[] {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
    selectors: m[1]!.split(',').map((s) => s.trim()),
    body: Object.fromEntries(
      m[2]!
        .split(';')
        .map((d) => d.split(':').map((x) => x.trim()))
        .filter((d) => d.length === 2 && d[0])
        .map(([k, v]) => [k!, v!]),
    ),
  }));
}

function ruleFor(selector: string) {
  return rules().find((r) => r.selectors.includes(selector))?.body;
}

describe('selectGuard.css', () => {
  it('turns selection and the iOS callout off for the whole shell', () => {
    for (const s of ['html', 'body']) {
      expect(ruleFor(s)).toMatchObject({
        'user-select': 'none',
        '-webkit-user-select': 'none',
        '-webkit-touch-callout': 'none',
      });
    }
  });

  it('gives fields, editable text and the read-back views both back', () => {
    for (const s of ['input', 'textarea', "[contenteditable]:not([contenteditable='false'])", 'pre', '.home-build']) {
      expect(ruleFor(s), s).toMatchObject({
        'user-select': 'text',
        '-webkit-user-select': 'text',
        '-webkit-touch-callout': 'default',
      });
    }
  });
});
