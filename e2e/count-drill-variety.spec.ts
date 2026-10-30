import { test, expect, type Page } from '@playwright/test';
import { withSettings, submitZero, pastCountLeadIn } from './helpers';

/**
 * Wave A (s04 medium): two things a regular would learn to game.
 *
 * - Every flashed card must visibly arrive. The card element was reused from
 *   card to card (keyed by its slot), so card-deal-in played only once and an
 *   identical card dealt next to itself changed nothing on screen.
 * - Distractions must stop on different cards from run to run. They were
 *   seeded by the card index alone: every run stopped on the same cards.
 */

/** A deterministic Math.random that still moves, so two runs get two seeds. */
async function steppedRandom(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let s = 12345;
    Math.random = () => {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      return s / 4294967296;
    };
  });
}

async function openCountDrill(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
}

test('auto mode: every card is a freshly dealt element, so a repeated card still visibly arrives', async ({ page }) => {
  await withSettings(page, {
    audio: { enabled: false },
    drill: { countManual: false, countLengthCards: 8, countGroup: 1, countIntervalMs: 400 },
  });
  await openCountDrill(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await pastCountLeadIn(page);

  // Wave X: any card of the run (the first one's 400ms can pass while the lead-in's end is seen).
  await expect(page.locator('.count-flash-progress')).toContainText('/ 8');
  // In the page, frame by frame: remember the card element on screen, wait for
  // the progress to move on, and compare the element now on screen.
  const reused = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const first = document.querySelector('.count-flash-cards .card');
        const label = () => document.querySelector('.count-flash-progress')?.textContent ?? '';
        const was = label();
        const tick = () => {
          if (label() === was) return void requestAnimationFrame(tick);
          resolve(document.querySelector('.count-flash-cards .card') === first);
        };
        requestAnimationFrame(tick);
      }),
  );
  expect(reused, "card 2 reused card 1's element: a repeated card would not visibly change").toBe(false);
});

/** In the page: wait for the next card, and read its style on its first frame. */
async function nextCardFirstFrame(page: Page): Promise<{ name: string; duration: string; opacity: string }> {
  return page.evaluate(
    () =>
      new Promise<{ name: string; duration: string; opacity: string }>((resolve) => {
        const label = () => document.querySelector('.count-flash-progress')?.textContent ?? '';
        const was = label();
        const tick = () => {
          const card = document.querySelector('.count-flash-cards .card');
          if (label() === was || !card) return void requestAnimationFrame(tick);
          const cs = getComputedStyle(card);
          resolve({ name: cs.animationName, duration: cs.animationDuration, opacity: cs.opacity });
        };
        requestAnimationFrame(tick);
      }),
  );
}

test('Wave A review: a card arrives in a quarter of its time on screen, not a fixed 220ms', async ({ page }) => {
  await withSettings(page, {
    audio: { enabled: false },
    drill: { countManual: false, countLengthCards: 8, countGroup: 1, countIntervalMs: 400 },
  });
  await openCountDrill(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await pastCountLeadIn(page);
  // Wave X: the first card's 400ms window can be gone by the time the lead-in
  // is seen to end; any card on screen is a stable label to watch change.
  await expect(page.locator('.count-flash-progress')).toContainText('/ 8');
  const frame = await nextCardFirstFrame(page);
  expect(frame.name).toBe('card-deal-in');
  expect(frame.duration).toBe('0.1s');
});

test('Wave A review: under reduced motion a new card still visibly arrives (a blank, no movement)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await withSettings(page, {
    audio: { enabled: false },
    drill: { countManual: false, countLengthCards: 8, countGroup: 1, countIntervalMs: 400 },
  });
  await openCountDrill(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await pastCountLeadIn(page);
  // Wave X: the first card's 400ms window can be gone by the time the lead-in
  // is seen to end; any card on screen is a stable label to watch change.
  await expect(page.locator('.count-flash-progress')).toContainText('/ 8');
  const frame = await nextCardFirstFrame(page);
  expect(frame.name).toBe('count-card-blank');
  // Blank on its first frame, so the same card twice still flickers.
  expect(frame.opacity).toBe('0');
});

/** One manual run with Occasional distractions: the cards it stopped after. */
async function distractionStops(page: Page, cards: number): Promise<number[]> {
  const stops: number[] = [];
  for (let i = 0; i < cards * 2; i++) {
    if (await page.locator('.distraction-area').isVisible()) {
      await page.locator('.distraction-area .numpad-btn', { hasText: /^1$/ }).click();
      await page.getByRole('button', { name: 'OK', exact: true }).click();
      continue;
    }
    const tap = page.locator('.manual-tap-zone');
    if (!(await tap.isVisible())) break; // the final answer
    const hint = await page.locator('.manual-tap-hint').innerText();
    const at = Number(/(\d+)\/\d+/.exec(hint)?.[1]);
    await tap.click();
    if (await page.locator('.distraction-area').isVisible()) stops.push(at);
  }
  return stops;
}

test('distractions stop on different cards in a second run', async ({ page }) => {
  test.setTimeout(60_000);
  await steppedRandom(page);
  await withSettings(page, {
    audio: { enabled: false },
    drill: { countManual: true, countLengthCards: 28, countGroup: 1, distractionFreq: 'occasional' },
  });
  await openCountDrill(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await pastCountLeadIn(page);
  const first = await distractionStops(page, 28);
  await submitZero(page);
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  await pastCountLeadIn(page);
  const second = await distractionStops(page, 28);

  // One stop per 7-card window: 4 windows in 28 cards.
  expect(first, 'the first run must have stopped to compare').toHaveLength(4);
  expect(second).toHaveLength(4);
  expect(second, 'both runs stopped on the same cards').not.toEqual(first);
});
