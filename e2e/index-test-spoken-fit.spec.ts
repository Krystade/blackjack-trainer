import { test, expect, type Page } from '@playwright/test';
import { withProfile, withSettings } from './helpers';

/**
 * H4 (wave H, story 6): the Index test eyes-free with voice answers, on an
 * iPhone 13 mini (375x812, 47px status bar, 34px home indicator). The
 * listening line, an Options row holding only the inert "Dim screen" and the
 * rung line under a miss strip pushed OK to y 786..830 -- under the home
 * indicator -- and the page to 876px. OK must stay on screen after answers.
 */

test.use({ viewport: { width: 375, height: 812 } });

const H17: Record<string, number> = {
  ins: 3, '16v10': 0, '15v10': 4, TTv5: 5, TTv6: 4, '10v10': 4, '12v3': 2, '12v2': 3,
  '9v2': 1, '10vA': 3, '9v7': 3, '16v9': 4, '13v2': -1, '12v4': 0, '12v5': -2, '12v6': -3, '13v3': -2,
};

async function withFakeEngineAndInsets(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      lang = '';
      phrases: unknown[] = [];
      onstart: (() => void) | null = null;
      onaudiostart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error?: string }) => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      constructor() {
        (window as unknown as { __rec: FakeRecognition }).__rec = this;
      }
      start(): void {
        setTimeout(() => {
          this.onstart?.();
          this.onaudiostart?.();
        }, 0);
      }
      abort(): void {
        this.onend?.();
      }
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
    // A fixed draw, so the same items come up every run.
    let i = 0;
    Math.random = () => ((i++ * 0.37) % 1);
    // Headless has no env() insets: the app's --safe-top, and the keypad's
    // env(safe-area-inset-bottom) padding, as the 13 mini's 47/34px.
    const add = () => {
      const s = document.createElement('style');
      s.textContent = ':root{--safe-top:47px !important} .numpad{padding-bottom:calc(var(--space-3) + 34px) !important}';
      document.head.appendChild(s);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add);
  });
}

test('eyes-free + voice: OK stays above the home indicator after three misses', async ({ page }) => {
  await withFakeEngineAndInsets(page);
  await withProfile(page);
  await withSettings(page, { audio: { enabled: true, verbosity: 'full', answerPauseMs: 60_000 } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();
  await page.getByRole('button', { name: 'Index test', exact: true }).click();
  await expect(page.getByTestId('index-test-prompt')).toBeVisible();
  await page.getByLabel('Eyes-free audio').check();
  await page.locator('label', { hasText: 'Voice answers' }).locator('input').check();
  await expect(page.locator('.drill-voice-line')).toBeVisible();

  for (let i = 0; i < 3; i++) {
    const id = (await page.getByTestId('index-test-prompt').getAttribute('data-deviation-id'))!;
    expect(id in H17, `unexpected index ${id}`).toBe(true);
    const wrong = H17[id]! + 5;
    for (const d of String(wrong)) await page.locator('.numpad-btn', { hasText: new RegExp(`^${d}$`) }).click();
    await page.locator('.numpad-ok').click();
    await expect(page.getByTestId('result-strip')).toHaveAttribute('data-tone', 'miss');
    await page.locator('.drill-next-btn').click();

    // Back on the keypad, with the miss strip still up.
    const ok = page.locator('.numpad-ok');
    await expect(ok).toBeVisible();
    await expect(page.getByTestId('index-test-result')).toBeVisible();
    const box = (await ok.boundingBox())!;
    expect(box.y + box.height, `answer ${i + 1}: OK bottom`).toBeLessThanOrEqual(812 - 34);
    const [scrollHeight, innerHeight] = await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight]);
    expect(scrollHeight, `answer ${i + 1}: page height`).toBeLessThanOrEqual(innerHeight);
  }
});
