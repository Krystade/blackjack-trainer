import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, shot } from './helpers';
import { worstContrast } from './contrast';
import { Game, DEFAULT_SPREAD } from '../src/engine/game';
import { handValue, isPair } from '../src/engine/hand';
import { dealerBustChance } from '../src/engine/dealerOdds';
import { regionRuleFor } from '../src/ui/screens/regionRule';
import type { RuleSet } from '../src/engine/ruleset';

/**
 * Wave E, E6 (W2-22): a basic error at the table reads the chart region the
 * hand sits in and the dealer's bust chance from that up card, instead of the
 * engine's "Basic hit vs dealer 7".
 */

test.use({ viewport: { width: 375, height: 812 } });

const SOLO = { playerHands: 1, bots: 0, botMistakePct: 0, playerPosition: 0 };
// Mirrors withProfile's default rules (H17, DAS, LS, 6D).
const RULES: RuleSet = { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false };
const INSET = ':root { --safe-top: 47px; --safe-bottom: 34px; }';
const THEMES = ['midnight-felt', 'bone-ink', 'amoled-night', 'slate-copper'] as const;

/** The first seed whose opening deal is a two-card hard 16 against a 7. */
function seedForHard16v7(): { seed: number; hand: string } {
  for (let seed = 1; seed < 50_000; seed++) {
    const g = new Game({
      penetration: 0.75,
      betSpreadOn: false,
      spread: DEFAULT_SPREAD,
      bankrollStart: 100,
      countCheckEvery: 0,
      rules: RULES,
      seats: SOLO,
      seed,
    });
    g.startRound();
    if (g.phase !== 'player' || g.dealerCards[0]!.rank !== '7') continue;
    const cards = g.hands[0]!.cards;
    if (cards.length !== 2 || isPair(cards)) continue;
    const v = handValue(cards);
    if (v.soft || v.total !== 16) continue;
    return { seed, hand: `${cards.map((c) => c.rank).join(',')} v 7` };
  }
  throw new Error('no seed deals hard 16 v 7');
}

const DEAL = seedForHard16v7();

async function standOn16v7(page: Page, theme?: string): Promise<void> {
  await withSettings(page, { feedbackMode: 'training', countCheckEvery: 0, dealSpeedMs: 0, ...(theme ? { theme } : {}) });
  await withProfile(page, { seats: SOLO });
  await page.goto(`/?seed=${DEAL.seed}&e2e=1`);
  await page.addStyleTag({ content: INSET });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  const bar = page.locator('.action-bar[data-advice]');
  await expect(bar).toHaveAttribute('data-advice', 'hit');
  await bar.getByRole('button', { name: 'Stand', exact: true }).click();
  await expect(page.locator('.wrong-play-sheet')).toBeVisible();
}

test('E6: standing on hard 16 v 7 shows the region rule and the dealer bust chance', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await standOn16v7(page);
  const sheet = page.locator('.wrong-play-sheet');

  // The dealt hand is the one the seed search found, so the cell is known.
  await expect(sheet.locator('.mistake-hand')).toHaveText(DEAL.hand);
  await expect(sheet.locator('.mistake-class')).toHaveText(/basic/i);

  const rule = regionRuleFor('hard-16-v-7', RULES);
  expect(rule, 'regionRuleFor has a rule for hard-16-v-7').not.toBeNull();
  const pct = Math.round(dealerBustChance('7', RULES, { excludeBlackjack: true }) * 100);
  const reason = sheet.locator('.mistake-reason');
  await expect(reason).toHaveText(`${rule!.text} Dealer busts ${pct}% with a\u00a07\u00a0up.`);
  await expect(reason).toContainText(rule!.text);
  await expect(reason).toContainText(`${pct}%`);

  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/Basic (hit|stand|double) vs dealer/);

  const cont = page.getByRole('button', { name: 'Continue', exact: true });
  const box = (await cont.boundingBox())!;
  expect(box.y).toBeGreaterThan(650);
  expect(box.y + box.height).toBeLessThanOrEqual(812);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await shot(page, 'e6-wrong-play-16v7');
});

for (const theme of THEMES) {
  test(`E6: ${theme}: the region-rule card at 375x812 with insets`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await standOn16v7(page, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const box = (await page.getByRole('button', { name: 'Continue', exact: true }).boundingBox())!;
    expect(box.y).toBeGreaterThan(650);
    // The reason line is the lesson now, so it reads at the note's size and passes AA.
    const reason = page.locator('.wrong-play-sheet .mistake-reason');
    expect(await reason.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13.5);
    const ratio = await worstContrast(page, '.wrong-play-sheet .mistake-reason');
    expect(ratio, `${theme} .mistake-reason ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    await shot(page, `e6-wrong-play-16v7-${theme}`);
  });
}
