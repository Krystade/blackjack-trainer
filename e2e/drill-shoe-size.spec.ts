import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile } from './helpers';

/**
 * V4-3 (docs/BACKLOG.md): the count-conversion drills take their shoe from the
 * ACTIVE PROFILE, not from a hardcoded 6.
 *
 * The engine half of this is unit-tested (produceTcDrill.test.ts,
 * betSitLeave.test.ts). What only a browser can check is the WIRING: those
 * modules default to 6, so a view that forgets to pass `activeProfile.rules
 * .decks` still compiles, still passes every unit test, and silently drills a
 * double-deck player on 6-deck conversions -- which is the exact bug V4-3 was
 * opened for. Every assertion below therefore uses a NON-default shoe.
 */

async function openDrill(page: Page, name: string): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

test('true count drill: the deck range opens on the profile shoe, not on six', async ({ page }) => {
  await withProfile(page, { rules: { decks: 2 } });
  await openDrill(page, 'True Count Drill');
  await expect(page.locator('.count-setup')).toBeVisible();
  await expect(page.locator('.count-setup .stepper-value').first()).toHaveText('2 decks');
});

test('true count drill: an eight-deck profile opens on eight, so it tracks the profile both ways', async ({
  page,
}) => {
  // Guards against a view that hardcoded 2 to pass the test above, and against
  // one that merely clamps rather than reads.
  await withProfile(page, { rules: { decks: 8 } });
  await openDrill(page, 'True Count Drill');
  await expect(page.locator('.count-setup .stepper-value').first()).toHaveText('8 decks');
});

test('deck estimation: shoe size opens on the profile, and the tray says so', async ({ page }) => {
  await withProfile(page, { rules: { decks: 2 } });
  await openDrill(page, 'Deck Estimation');
  await expect(page.locator('.count-setup .stepper-value').first()).toHaveText('2 decks');

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.deck-tray-context')).toHaveText('2-deck shoe');
});

test('produce the true count: a one-deck profile never divides by more than one deck', async ({ page }) => {
  // The strongest available signal: the result screen prints the divisor it
  // graded against. On the old hardcoded 6 this ran up to "6 decks" for
  // everyone; a 1-deck profile can only ever legitimately print 0.5 or 1.
  await withProfile(page, { rules: { decks: 1 } });
  await withSettings(page, { drill: { countLengthCards: 4, countIntervalMs: 10, countGroup: 1 } });
  await openDrill(page, 'Produce the True Count');

  // This drill has no setup screen -- it starts flashing on entry.
  const seen: number[] = [];
  for (let round = 0; round < 6; round++) {
    await expect(page.locator('.numpad')).toBeVisible();
    await expect(page.locator('.deck-tray-context')).toHaveText('1-deck shoe');
    await page.getByRole('button', { name: 'OK', exact: true }).click();

    const detail = await page.locator('.result-detail').innerText();
    const m = /÷ ([\d.]+) decks/.exec(detail);
    expect(m, `no divisor printed in: ${detail}`).not.toBeNull();
    const decks = Number(m![1]);
    expect(decks, `round ${round} divided by ${decks} decks in a 1-deck shoe`).toBeLessThanOrEqual(1);
    expect(decks).toBeGreaterThanOrEqual(0.5);
    seen.push(decks);

    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }

  // Vacuity guard: the drill must actually be varying the depth, or the bound
  // above would hold for a drill that emitted one constant forever.
  expect(new Set(seen).size).toBeGreaterThan(1);
});

test('bet / sit / leave: the tray is labelled with the profile shoe', async ({ page }) => {
  // This drill prints no divisor, so the tray label is the only observable --
  // and it is also the reason the label had to exist: once the shoe varies, a
  // half-full tray means 1 deck left in a 2-deck shoe and 3 in a 6-deck one.
  await withProfile(page, { rules: { decks: 2 } });
  await openDrill(page, 'Bet / Sit / Leave');
  await expect(page.locator('.deck-tray-context')).toHaveText('2-deck shoe');
});
