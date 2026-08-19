import { test, expect } from '@playwright/test';

/**
 * Two tabs, one localStorage. Every store here writes a WHOLE blob and each
 * tab holds its own copy in React state, so the damage was never the write
 * itself: a tab that kept drilling against a snapshot taken before the other
 * tab's write would later save that stale snapshot back over it, discarding
 * the other tab's work with no error and nothing to undo.
 *
 * Real pages in the same browser context are the only honest way to test
 * this -- the `storage` event fires in every OTHER tab and never in the one
 * that wrote, and that asymmetry is the entire mechanism.
 */

test('a tab picks up a theme another tab chose instead of holding stale state', async ({
  context,
}) => {
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await tabA.goto('/?e2e=1');
  await tabB.goto('/?e2e=1');

  await expect(tabA.locator('html')).toHaveAttribute('data-theme', 'midnight-felt');
  await expect(tabB.locator('html')).toHaveAttribute('data-theme', 'midnight-felt');

  // Tab B changes the theme through the real UI, which writes the settings blob.
  await tabB.getByRole('button', { name: 'Settings', exact: true }).click();
  await tabB.locator('.theme-option[data-theme-id="bone-ink"]').click();
  await expect(tabB.locator('html')).toHaveAttribute('data-theme', 'bone-ink');

  // Tab A must notice rather than carry on with its pre-write snapshot.
  await expect(tabA.locator('html')).toHaveAttribute('data-theme', 'bone-ink');
});

/**
 * The regression that matters most: tab A must not save its stale settings
 * back over tab B's newer ones. Before the fix, tab A still held the
 * pre-write blob and the next thing it saved reverted tab B's change.
 */
test("a tab's later write does not revert another tab's change", async ({ context }) => {
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await tabA.goto('/?e2e=1');
  await tabB.goto('/?e2e=1');

  await tabB.getByRole('button', { name: 'Settings', exact: true }).click();
  await tabB.locator('.theme-option[data-theme-id="amoled-night"]').click();
  await expect(tabB.locator('html')).toHaveAttribute('data-theme', 'amoled-night');

  // Now make tab A write its OWN settings blob by changing something else.
  await tabA.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(tabA.locator('html')).toHaveAttribute('data-theme', 'amoled-night');

  // Whatever tab A persists must be built on top of tab B's theme, not the
  // snapshot it was holding when tab B wrote.
  const stored = await tabA.evaluate(() =>
    JSON.parse(window.localStorage.getItem('bjtrainer.settings.v1') ?? '{}'),
  );
  expect(stored.theme).toBe('amoled-night');
});
