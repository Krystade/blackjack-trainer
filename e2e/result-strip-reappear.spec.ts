import { test, expect } from '@playwright/test';
import { withProfile } from './helpers';

/**
 * #27: after a correct strip has faded, the next miss strip must be visible on
 * its first frame. The shared transition delayed `visibility` by 300ms in both
 * directions, so the miss sat hidden for ~300ms and then popped in -- a glance
 * in the car right after OK saw nothing.
 */
const H17: Record<string, number> = {
  ins: 3, '16v10': 0, '15v10': 4, TTv5: 5, TTv6: 4, '10v10': 4, '12v3': 2, '12v2': 3,
  '9v2': 1, '10vA': 3, '9v7': 3, '16v9': 4, '13v2': -1, '12v4': 0, '12v5': -2, '12v6': -3, '13v3': -2,
};

test('a miss strip after a faded correct one is visible on its first frame', async ({ page }) => {
  await withProfile(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills' }).first().click();
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();
  await page.getByRole('button', { name: 'Index test', exact: true }).click();
  const prompt = page.getByTestId('index-test-prompt');
  const type = async (n: number) => {
    for (const d of String(Math.abs(n))) await page.locator('.numpad-btn', { hasText: new RegExp(`^${d}$`) }).click();
    if (n < 0) await page.getByRole('button', { name: 'Plus or minus' }).click();
  };
  const index = async () => H17[(await prompt.getAttribute('data-deviation-id'))!]!;

  await type(await index());
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  const strip = page.getByTestId('result-strip');
  await expect(strip).toHaveAttribute('data-tone', 'ok');
  await expect(strip).toHaveClass(/result-strip--faded/);
  await expect.poll(() => strip.evaluate((el) => getComputedStyle(el).visibility)).toBe('hidden');

  await type((await index()) + 5);
  // Sample the strip on the first frames after it turns into a miss.
  const samples = await page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const el = document.querySelector('[data-testid="result-strip"]')!;
        const out: string[] = [];
        const obs = new MutationObserver(() => {
          if (el.getAttribute('data-tone') !== 'miss') return;
          obs.disconnect();
          let frames = 0;
          const tick = () => {
            const cs = getComputedStyle(el);
            out.push(`${cs.visibility}/${Number(cs.opacity).toFixed(2)}`);
            if (++frames < 3) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        });
        obs.observe(el, { attributes: true });
        [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'OK')!.click();
      }),
  );
  expect(samples).toEqual(['visible/1.00', 'visible/1.00', 'visible/1.00']);
});
