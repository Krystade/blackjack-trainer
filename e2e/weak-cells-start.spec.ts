import { test, expect } from '@playwright/test';
import { withSettings, withStats } from './helpers';

/**
 * Wave B2 #43: "Fix weak cells" Start starts drilling, as Start does on every
 * other rung. It used to land on the Custom editor (Auto applied), leaving a
 * choice of three gold buttons before a card appeared -- an extra decision
 * and an extra tap, eyes-free.
 */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

// The nextStep s07 case: soft at 81%, nearly every miss on two soft cells.
const WEAK = ['soft-17-v-3', 'soft-15-v-4'];
const STATS = {
  cellStats: {
    'hard-16-v-10': { right: 30, wrong: 0, lastAt: '' },
    'soft-18-v-9': { right: 30, wrong: 0, lastAt: '', recent: '1'.repeat(10) },
    'pair-8-v-A': { right: 30, wrong: 0, lastAt: '' },
    'soft-17-v-3': { right: 0, wrong: 4, lastAt: '', recent: '0000' },
    'soft-15-v-4': { right: 1, wrong: 3, lastAt: '', recent: '0100' },
  },
};

test('B2 #43: Fix weak cells Start deals a card from the Auto deck, no editor in between', async ({ page }) => {
  await withStats(page, STATS);
  // A leftover hand type and deck that must not decide what is dealt.
  await withSettings(page, { drill: { deck: 'chart', scopes: ['pairs'], flashCategory: 'pairs' } });
  await page.goto('/?e2e=1');
  const card = page.getByRole('region', { name: 'Next step' });
  await expect(card).toContainText('Fix weak cells');
  await card.getByRole('button', { name: 'Start', exact: true }).click();

  // Straight into Flashcards with an answer bar: no Custom editor, no picker.
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');
  await expect(page.locator('.cde')).toHaveCount(0);
  await expect(page.locator('.action-bar[data-advice]')).toBeVisible();

  // The deck is Custom with Auto: the weak cells Focus, across every hand type.
  const drill = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1')!).drill);
  expect(drill.deck).toBe('custom');
  expect(drill.scopes).toEqual(['hard', 'soft', 'pairs']);
  const focus = Object.entries(drill.custom.tiers as Record<string, string>).filter(([, t]) => t === 'focus').map(([id]) => id).sort();
  expect(focus).toEqual([...WEAK].sort());
});
