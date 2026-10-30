import { test, expect, type Locator, type Page } from '@playwright/test';
import { openSettingsScreen, resolveInsurance, withProfile } from './helpers';

/**
 * Wave X (item 4): "Tapping and holding is highlighting random text."
 *
 * The shell selects nothing and raises no iOS callout; form fields, editable
 * text and the read-back views (the diagnostic log, the build id) opt back in.
 * Checked two ways: the computed style on one element of each kind, and a real
 * drag across the text -- which is what a long press does -- that must leave
 * no selection over the game and must leave one over the log. The iOS
 * callout is computed only by iOS WebKit, so scripts/selectGuard.test.ts reads it
 * from the stylesheet itself.
 */

test.use({ viewport: { width: 375, height: 812 } });

type Sel = { user: string; webkit: string; callout: string };

async function sel(loc: Locator): Promise<Sel> {
  return loc.evaluate((el) => {
    const cs = getComputedStyle(el) as CSSStyleDeclaration & Record<string, string>;
    return {
      user: cs.userSelect,
      webkit: cs.webkitUserSelect ?? cs.getPropertyValue('-webkit-user-select'),
      callout: cs.getPropertyValue('-webkit-touch-callout'),
    };
  });
}

const NONE = { user: 'none', webkit: 'none' };
const TEXT = { user: 'text', webkit: 'text' };

/** Drag across an element's text, as a long press and slide does, and read what got selected. */
async function dragSelect(page: Page, loc: Locator): Promise<string> {
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const box = (await loc.boundingBox())!;
  const y = box.y + Math.min(box.height / 2, 8);
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, y, { steps: 8 });
  await page.mouse.up();
  return page.evaluate(() => window.getSelection()?.toString() ?? '');
}

test('game text cannot be selected by a press and drag; fields, editable text and logs can', async ({ page }) => {
  await withProfile(page, { name: 'Select Guard' });
  await page.goto('/?seed=1&e2e=1');

  // Home: the title is game chrome, the build id is there to be copied.
  const title = page.locator('.home-title');
  await expect(title).toBeVisible();
  expect(await sel(title)).toMatchObject(NONE);
  expect(await dragSelect(page, title)).toBe('');
  expect(await sel(page.locator('.home-build'))).toMatchObject(TEXT);

  // The Play table: cards, the message strip and a button.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);
  const card = page.locator('.player-hand .hand-cards .card').first();
  await expect(card).toBeVisible();
  expect(await sel(card)).toMatchObject(NONE);
  const strip = page.locator('.message-strip');
  expect(await sel(strip)).toMatchObject(NONE);
  const btn = page.locator('.action-bar button').first();
  expect(await sel(btn)).toMatchObject(NONE);
  expect(await dragSelect(page, page.locator('.hands-row'))).toBe('');

  // Fields and editable text opt back in (a textarea and a contenteditable
  // planted in the shell inherit nothing that stops them).
  await page.evaluate(() => {
    const root = document.getElementById('root')!;
    const ta = document.createElement('textarea');
    ta.id = 'probe-ta';
    ta.value = 'typed notes';
    const ce = document.createElement('div');
    ce.id = 'probe-ce';
    ce.contentEditable = 'true';
    ce.textContent = 'editable text';
    const off = document.createElement('div');
    off.id = 'probe-ce-off';
    off.contentEditable = 'false';
    off.textContent = 'not editable';
    root.append(ta, ce, off);
  });
  expect(await sel(page.locator('#probe-ta'))).toMatchObject(TEXT);
  expect(await sel(page.locator('#probe-ce'))).toMatchObject(TEXT);
  expect(await sel(page.locator('#probe-ce-off'))).toMatchObject(NONE);
  await page.evaluate(() => ['probe-ta', 'probe-ce', 'probe-ce-off'].forEach((id) => document.getElementById(id)?.remove()));

  // Settings: a real input, and the diagnostic log, which is read back and copied by hand.
  await page.goto('/?e2e=1');
  await openSettingsScreen(page);
  const input = page.locator('input[type="text"], input[type="number"], input:not([type])').first();
  expect(await sel(input)).toMatchObject(TEXT);
  const panel = page
    .locator('details.settings-section')
    .filter({ has: page.locator('summary', { hasText: 'Diagnostic log' }) });
  await panel.getByRole('button', { name: 'Show', exact: true }).click();
  const log = panel.locator('pre.car-log');
  await expect(log).toBeVisible();
  expect(await sel(log)).toMatchObject(TEXT);
  expect((await dragSelect(page, log)).length).toBeGreaterThan(0);
});

