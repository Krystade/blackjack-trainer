import { test, expect, type Page } from '@playwright/test';
import { openSettingsScreen, resolveInsurance, withProfile, withSettings } from './helpers';

/**
 * Wave X (item 3): "Hold to peek needs to be fixed. A. If I'm holding it I'm
 * covering the info. B. I usually play right handed so I'd want it bottom
 * right."
 *
 * The button sits under the holding thumb -- bottom right, or bottom left with
 * Settings > Handedness: Left -- and the readout shows on the far side, well
 * clear of it. Fix round 1: a thumb pad is 100-130 css px across on a 13 mini
 * and its tip reaches past the point it presses, so "not overlapping the
 * button" was 10 px of clearance and passed a readout the tip covered. Clear
 * now means 120 px of the row between the readout and the button, or the
 * readout's bottom 60 px above the button's top.
 */

type Box = { x: number; y: number; width: number; height: number };

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** How far the readout is from a thumb on `btn`: across the row, and above it. */
function clearance(btn: Box, readout: Box, side: 'right' | 'left'): { across: number; above: number } {
  return {
    across: side === 'right' ? btn.x - (readout.x + readout.width) : readout.x - (btn.x + btn.width),
    above: btn.y - (readout.y + readout.height),
  };
}

async function dealt(page: Page, w: number, h: number): Promise<void> {
  await page.setViewportSize({ width: w, height: h });
  await withProfile(page);
  await page.goto('/?seed=102&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);
}

async function hold(page: Page): Promise<{ btn: Box; readout: Box }> {
  const btn = (await page.locator('.peek-hold-btn').boundingBox())!;
  await page.mouse.move(btn.x + btn.width / 2, btn.y + btn.height / 2);
  await page.mouse.down();
  const readout = page.getByTestId('peek-readout');
  await expect(readout).toContainText('RC');
  return { btn, readout: (await readout.boundingBox())! };
}

for (const [w, h] of [[375, 812], [320, 568], [480, 900]] as const) {
  for (const side of ['right', 'left'] as const) {
    test(`${side} hand at ${w}x${h}: the peek is under the thumb and its readout is clear of it`, async ({ page }) => {
      await withSettings(page, { countCheckEvery: 0, ...(side === 'left' ? { handedness: 'left' } : {}) });
      await dealt(page, w, h);
      const { btn, readout } = await hold(page);

      // Under the thumb: in the bottom corner on the holding side.
      if (side === 'right') expect(btn.x + btn.width).toBeGreaterThan(w - 24);
      else expect(btn.x).toBeLessThan(24);
      const bar = (await page.locator('.action-bar').boundingBox())!;
      expect(btn.y + btn.height).toBeLessThanOrEqual(bar.y + 1);

      // The readout: not on the button, on the far side, clear of the thumb,
      // all of it on screen.
      expect(overlaps(readout, btn), 'readout on the button').toBe(false);
      const centre = readout.x + readout.width / 2;
      expect(side === 'right' ? centre < btn.x : centre > btn.x + btn.width, 'readout on the far side').toBe(true);
      const { across, above } = clearance(btn, readout, side);
      expect(across >= 120 || above >= 60, `clear of the thumb: ${across}px across, ${above}px above`).toBe(true);
      expect(readout.x).toBeGreaterThanOrEqual(0);
      expect(readout.x + readout.width).toBeLessThanOrEqual(w);
      expect(readout.y).toBeGreaterThanOrEqual(0);
      // Its text is not clipped by its own box.
      const clipped = await page
        .getByTestId('peek-readout')
        .evaluate((el) => [...el.querySelectorAll('span')].some((s) => s.scrollWidth > el.clientWidth + 1));
      expect(clipped, 'readout text clipped').toBe(false);
      await page.mouse.up();
      await expect(page.getByTestId('peek-readout')).toHaveCount(0);
    });
  }
}

test('Handedness is a setting, Right by default, and Left moves the peek to the left thumb', async ({ page }) => {
  await withProfile(page);
  await withSettings(page, { countCheckEvery: 0 });
  await page.goto('/?e2e=1');
  await openSettingsScreen(page);
  const right = page.getByRole('button', { name: 'Right', exact: true });
  const left = page.getByRole('button', { name: 'Left', exact: true });
  await expect(right).toHaveAttribute('aria-pressed', 'true');
  await left.click();
  await expect(left).toHaveAttribute('aria-pressed', 'true');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}'));
  expect(stored.handedness).toBe('left');

  // The saved setting, not the harness's seed, from here on.
  await page.evaluate(() => localStorage.setItem('e2e.noReseed', '1'));
  await page.goto('/?seed=102&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);
  await expect(page.locator('.peek-dock')).toHaveAttribute('data-hand', 'left');
  expect((await page.locator('.peek-hold-btn').boundingBox())!.x).toBeLessThan(24);
});
