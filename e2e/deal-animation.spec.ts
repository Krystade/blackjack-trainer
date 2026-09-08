import { test, expect } from '@playwright/test';
import { withSettings, withProfile, resolveInsurance, shot } from './helpers';

/**
 * Table Realism, Request B: "a card coming from a deck and landing on the
 * table" instead of just appearing. The animation itself (CSS
 * opacity/transform keyframe) has no unit-test surface -- vitest runs under
 * `environment: 'node'` with no DOM -- so this spec covers exactly what a
 * browser CAN prove: that the opening deal's cards carry the right
 * `--deal-i` stagger index (Design Decision 2.1/2.3), that the skip control
 * appears/disappears correctly on its own (a solo table with no bots at
 * all -- Design Decision 2.4), and that prefers-reduced-motion suppresses
 * the whole mechanism rather than merely speeding it up (Design Decision
 * 2.5). It deliberately does NOT re-prove that card DOM presence is
 * immediate under the default deal speed -- e2e/profiles.spec.ts's S17 seed
 * hunt and e2e/table-seats.spec.ts's fast-forward-adjacent specs already
 * pin that invariant, and this plan's whole design exists to not disturb it.
 */

test('opening deal stamps --deal-i on each card in true casino deal order (solo, no bots)', async ({ page }) => {
  // Slow enough that the stagger/skip-control window is comfortably wide
  // for the assertions below to land well inside it -- this is a timing
  // margin choice, not a claim about how the feature should feel in
  // practice (that's a real-browser, by-eye check, per Design Decision 2.4).
  await withSettings(page, { dealSpeedMs: 5000 });
  await withProfile(page, { name: 'Deal Animation Profile' });

  await page.goto('/?seed=1&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);

  // Solo, no bots: game.dealOrder is exactly
  // [player c0, dealer up, player c1, dealer hole] -- see game.test.ts's
  // "dealOrder" describe block, which pins this same order at the engine
  // level. `.dealer-area .card` matches the face-down hole card too:
  // PlayingCard's face-down branch renders class="card card-back".
  const playerCards = page.locator('.player-hand .hand-cards .card');
  const dealerCards = page.locator('.dealer-area .card');
  await expect(playerCards).toHaveCount(2);
  await expect(dealerCards).toHaveCount(2);

  const dealI = (locator: ReturnType<typeof page.locator>, i: number) =>
    locator.nth(i).evaluate((el) => (el as HTMLElement).style.getPropertyValue('--deal-i'));

  expect(await dealI(playerCards, 0)).toBe('0'); // player card 0 -> slot 0
  expect(await dealI(dealerCards, 0)).toBe('1'); // dealer up -> slot 1
  expect(await dealI(playerCards, 1)).toBe('2'); // player card 1 -> slot 2
  expect(await dealI(dealerCards, 1)).toBe('3'); // dealer hole -> slot 3

  await shot(page, '55-deal-animation-deal-i-stamped');
});

test('a solo table with no bots still offers a skip control for the opening deal, which clears --deal-i on click', async ({
  page,
}) => {
  // hasBots is false here on purpose: the fast-forward button/message-strip
  // tap must appear from `dealAnimating` ALONE (Design Decision 2.4/Task 6),
  // not only when bot narration is pending -- a regression that scoped the
  // button's visibility to `hasBots && pacingPending` only would hide it
  // for exactly this table shape.
  await withSettings(page, { dealSpeedMs: 5000 });
  await withProfile(page, { name: 'Deal Animation Skip Profile' });

  await page.goto('/?seed=1&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);

  const ffBtn = page.locator('.fast-forward-btn');
  await expect(ffBtn).toBeVisible();

  const playerCard0 = page.locator('.player-hand .hand-cards .card').first();
  expect(await playerCard0.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--deal-i'))).toBe('0');

  await ffBtn.click();

  // Skip collapses the remaining stagger to zero by dropping `dealIndex`
  // entirely (undefined), NOT a container-level `animation: none` -- so the
  // custom property simply stops being set (Design Decision 2.4). The
  // button itself must also be gone immediately, matching
  // e2e/table-seats.spec.ts's fast-forward spec's same assertion for the
  // bot-narration half of this same click handler.
  await expect(ffBtn).toHaveCount(0);
  expect(await playerCard0.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--deal-i'))).toBe('');
});

test('prefers-reduced-motion: reduce suppresses the skip control entirely (nothing is playing to skip)', async ({
  page,
}) => {
  // A slow deal speed that would otherwise keep the skip control up for a
  // long time -- if reduced-motion accidentally only shortened the delay
  // instead of removing it (the rejected design in 2.5), this would still
  // catch a button that flickered on before disappearing, since the
  // assertion below never waits for it at all.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await withSettings(page, { dealSpeedMs: 5000 });
  await withProfile(page, { name: 'Deal Animation Reduced Motion Profile' });

  await page.goto('/?seed=1&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);

  await expect(page.locator('.player-hand .hand-cards .card')).toHaveCount(2);
  await expect(page.locator('.fast-forward-btn')).toHaveCount(0);
});
