import { test, expect, type Page } from '@playwright/test';
import { answerAndReadStrip } from './helpers';

async function readSettings(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const json = window.localStorage.getItem('bjtrainer.settings.v1');
    return json ? (JSON.parse(json) as Record<string, unknown>) : null;
  });
}

/**
 * #13: Hard / Soft / Pairs is a multi-select in Flashcards, Mastery and
 * Mixed, shared through settings.drill.scopes.
 */

async function openDrill(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

const scopeRow = (page: Page) => page.locator('.settings-row', { hasText: 'Hands' });
const chip = (page: Page, name: string) => scopeRow(page).getByRole('button', { name, exact: true });

test('mastery: Soft + Pairs is one sweep of both, and the last chip stays on', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openDrill(page, 'Mastery challenge');
  await expect(page.getByTestId('mastery-progress')).toContainText('0 / 330 cleared');

  await chip(page, 'Soft').click(); // from All: narrows to Soft
  await expect(page.getByTestId('mastery-progress')).toContainText('0 / 80 cleared');
  await chip(page, 'Pairs').click(); // adds Pairs
  await expect(page.getByTestId('mastery-progress')).toContainText('0 / 180 cleared · Soft + Pairs');
  await expect(chip(page, 'Soft')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, 'Pairs')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, 'Hard')).toHaveAttribute('aria-pressed', 'false');

  await chip(page, 'Soft').click();
  await chip(page, 'Pairs').click(); // the last one: refused
  await expect(chip(page, 'Pairs')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('mastery-progress')).toContainText('0 / 100 cleared');

  await chip(page, 'All').click();
  await expect(page.getByTestId('mastery-progress')).toContainText('0 / 330 cleared · All');
  const settings = await readSettings(page);
  expect((settings?.drill as { scopes?: string[] } | undefined)?.scopes).toEqual(['hard', 'soft', 'pairs']);
});

test('flashcards: Hard + Soft never deals a pair, and Mastery opens on the same scope', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openDrill(page, 'Flashcards');
  await chip(page, 'Hard').click();
  await chip(page, 'Soft').click();

  for (let i = 0; i < 12; i++) {
    const body = await page.locator('.player-hand .u-sr-only').innerText();
    expect(body, `dealt "${body}" with Hard + Soft chosen`).not.toMatch(/pair of/i);
    // B1: answering deals the next hand at once.
    await answerAndReadStrip(page, page.getByRole('button', { name: 'Stand', exact: true }));
  }

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Mastery challenge', exact: true }).click();
  await expect(page.getByTestId('mastery-progress')).toContainText('0 / 230 cleared · Hard + Soft');
});

test('mixed: the scope chips are there and save to the shared setting', async ({ page }) => {
  await page.goto('/?e2e=1');
  await openDrill(page, 'Mixed');
  await chip(page, 'Pairs').click();
  await expect(chip(page, 'Pairs')).toHaveAttribute('aria-pressed', 'true');
  const settings = await readSettings(page);
  expect((settings?.drill as { scopes?: string[] } | undefined)?.scopes).toEqual(['pairs']);
});
