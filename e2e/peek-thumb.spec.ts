import { test, expect, type Page } from '@playwright/test';
import { openSettingsScreen, resolveInsurance, withProfile, withSettings } from './helpers';

/**
 * Wave X (item 3): "Hold to peek needs to be fixed. A. If I'm holding it I'm
 * covering the info. B. I usually play right handed so I'd want it bottom
 * right."
 *
 * The button sits under the holding thumb -- bottom right, or bottom left with
 * Settings > Handedness: Left -- and the readout shows beside it on the far
 * side. The thumb is simulated as the region a thumb on the button covers: the
 * button itself and everything from it out to the screen's corner on the
 * thumb's side (the thumb comes in from below and from that edge). The readout
 * must lie wholly outside it, and wholly on screen.
 */

type Box = { x: number; y: number; width: number; height: number };

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** What a thumb holding `btn` covers, for a hand on `side`. */
function thumb(btn: Box, side: 'right' | 'left', vw: number, vh: number): Box {
  return side === 'right'
    ? { x: btn.x, y: btn.y, width: vw - btn.x, height: vh - btn.y }
    : { x: 0, y: btn.y, width: btn.x + btn.width, height: vh - btn.y };
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

for (const [w, h] of [[375, 812], [320, 568]] as const) {
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

      // The readout: not on the button, not under the thumb, all of it on screen.
      expect(overlaps(readout, btn), 'readout on the button').toBe(false);
      expect(overlaps(readout, thumb(btn, side, w, h)), 'readout under the thumb').toBe(false);
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
