import { test, expect, type Page } from '@playwright/test';
import { withSettings, openCountOptions } from './helpers';

/**
 * D21: a visual count run at Full verbosity names each card by CUTTING OFF
 * the previous one, not by queueing behind it.
 *
 * Off eyes-free, every flip went through `sayFull`, which never interrupted,
 * and speak() queues a non-interrupting line behind the one in flight. A rank
 * clip is about 0.7s, so at a 300ms pace the voice fell a card further behind
 * every two flips, and was still naming cards over the keypad -- with "What's
 * the running count?" queued behind all of them. Eyes-free already spoke the
 * cards with interrupt; the visual run now does the same, and so does its
 * answer prompt.
 *
 * The e2e harness swallows speech instantly, so the queue itself cannot build
 * up here; what this checks is how each line was asked to be said
 * (`__speechOptsLog`), which is the whole of the change.
 */

const PROMPT = "What's the running count?";

type Spoken = { text: string; interrupt?: boolean };

async function spoken(page: Page): Promise<Spoken[]> {
  return page.evaluate(() => (window.__speechOptsLog ?? []).map(({ text, interrupt }) => ({ text, interrupt })));
}

async function openCountDrill(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await openCountOptions(page);
}

test('a visual run at Full verbosity interrupts with each card and with the prompt', async ({ page }) => {
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full' },
    drill: { countLengthCards: 6, countIntervalMs: 300, countGroup: 1, countManual: false },
  });
  await openCountDrill(page);
  await page.evaluate(() => {
    window.__speechOptsLog = [];
    window.__speechLog = [];
  });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await spoken(page)).map((s) => s.text)).toContain(PROMPT);

  const lines = await spoken(page);
  const promptAt = lines.findIndex((s) => s.text === PROMPT);
  const cards = lines.slice(0, promptAt);
  // Precondition: the cards were narrated at all (verbosity Full), one per flip.
  expect(cards.length, JSON.stringify(lines)).toBeGreaterThanOrEqual(6);
  for (const c of cards) expect(c.interrupt, `card line "${c.text}" queued`).toBe(true);
  expect(lines[promptAt].interrupt, 'the prompt queued behind the cards').toBe(true);
});

test('at the default verbosity the visual run still says nothing per card', async ({ page }) => {
  // The fix must not start narrating cards for a user on 'results'.
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'results' },
    drill: { countLengthCards: 6, countIntervalMs: 300, countGroup: 1, countManual: false },
  });
  await openCountDrill(page);
  await page.evaluate(() => {
    window.__speechOptsLog = [];
    window.__speechLog = [];
  });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(300);
  expect((await spoken(page)).map((s) => s.text)).toEqual([]);
});
