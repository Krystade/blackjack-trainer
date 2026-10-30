import { test, expect, type Page } from '@playwright/test';
import { disagreementAt, gradedTable, presetData } from '../src/engine/variants/strategy';
import { drawVariantItem, gradeVariantItem, variantItemLegal } from '../src/drills/variantDrill';
import { narrateVariantPrompt } from '../src/audio/narrateVariant';
import { narrateActionNotAsked } from '../src/audio/narrate';
import { sayOnceListening, waitForMic } from './helpers';
import { evTable, switchChoice } from '../src/engine/variants/ev';
import { chartRules } from '../src/engine/variants/chartGen';
import { PRESETS, type PresetId } from '../src/engine/variants/rules';
import { houseEdgePct } from '../src/engine/variants/houseEdge';
import { variantSectionRows } from '../src/ui/screens/variantChartView';

/**
 * Wave L: Free Bet, Spanish 21 and Switch -- picked on Charts, drilled, and
 * logged as a casino game. Expected values are read from the same engine and
 * generated data the app uses, never typed here.
 */

test.use({ viewport: { width: 375, height: 812 } });

const tab = (page: Page, name: string) => page.locator('.tab-bar').getByRole('button', { name, exact: true }).click();
const picker = (page: Page) => page.getByTestId('variant-picker');

/** The cell the screen shows for a hand total against an up card, found through the same row folding. */
function cell(page: Page, preset: PresetId, table: string, section: 'HARD' | 'SOFT', total: number, up: string) {
  // The screen folds and shows the GRADED table (published plays where the review graded them so).
  const t = gradedTable(preset, presetData(preset).tables.find((x) => x.id === table)!);
  const row = variantSectionRows(t, section, 'descending').find((r) => r.keys.includes(total))!;
  return page.locator(`.variant-table[data-table="${table}"] [data-section="${section}"] tr[data-row="${row.id}"] td[data-up="${up}"]`);
}

test('pick a variant on Charts: its chart, its edge, its rule sets, and the choice is kept', async ({ page }) => {
  await page.goto('/?e2e=1');
  await tab(page, 'Charts');
  await expect(picker(page).getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('variant-charts')).toHaveCount(0);

  await picker(page).getByRole('button', { name: 'Spanish 21' }).click();
  const charts = page.getByTestId('variant-charts');
  await expect(charts).toHaveAttribute('data-preset', 's21-h17');
  await expect(page.getByTestId('variant-house-edge')).toContainText(`${presetData('s21-h17').houseEdge.toFixed(2)}%`);
  // Hard 16 v 2, as graded (a card-count step code), and its note: the
  // infinite-deck play it overrides, one tap away on the cell.
  const s21 = gradedTable('s21-h17', presetData('s21-h17').tables[0]!);
  const h16 = s21.sections.HARD.find((r) => r.key === 16)!.cells[0]!.code;
  const h16Cell = cell(page, 's21-h17', 'main', 'HARD', 16, '2');
  await expect(h16Cell).toHaveText(h16);
  const note = disagreementAt('s21-h17', 'main', 'HARD', 16, 0)!;
  expect(note.grade).toBe('published');
  await expect(h16Cell).toHaveAttribute('data-note', 'published');
  await h16Cell.getByRole('button').click();
  await expect(page.getByTestId('variant-cell-note')).toContainText(`the infinite-deck (computed) chart says ${note.computed}`);
  await expect(page.getByTestId('variant-after-double')).toBeVisible();

  await page.getByRole('group', { name: 'Rule set' }).getByRole('button', { name: 'S17' }).click();
  await expect(charts).toHaveAttribute('data-preset', 's21-s17');
  await expect(page.getByTestId('variant-house-edge')).toContainText(`${presetData('s21-s17').houseEdge.toFixed(2)}%`);

  // Kept across a reload.
  await page.reload();
  await tab(page, 'Charts');
  await expect(page.getByTestId('variant-charts')).toHaveAttribute('data-preset', 's21-s17');

  // Free Bet: two tables, the free hand's differing from the real one at 14 v 2.
  await picker(page).getByRole('button', { name: 'Free Bet' }).click();
  await expect(page.locator('.variant-table')).toHaveCount(2);
  const fb = presetData('freebet');
  const code = (t: string) => fb.tables.find((x) => x.id === t)!.sections.HARD.find((r) => r.key === 14)!.cells[0]!.code;
  expect(code('real')).not.toBe(code('free'));
  await expect(cell(page, 'freebet', 'free', 'HARD', 14, '2')).toHaveText(code('free'));
  await expect(cell(page, 'freebet', 'real', 'HARD', 14, '2')).toHaveText(code('real'));

  // Switch: the checker agrees with the engine for a deal set here.
  await picker(page).getByRole('button', { name: 'Switch' }).click();
  const checker = page.getByTestId('variant-switch-checker');
  await checker.getByLabel('Hand 1 first card').selectOption('10');
  await checker.getByLabel('Hand 1 second card').selectOption('6');
  await checker.getByLabel('Hand 2 first card').selectOption('10');
  await checker.getByLabel('Hand 2 second card').selectOption('5');
  await checker.getByLabel('Dealer up card').selectOption('10');
  const expected = switchChoice(10, 6, 10, 5, evTable(chartRules('switch'), 10)).switchIt;
  await expect(page.getByTestId('variant-switch-result')).toHaveAttribute('data-switch', String(expected));

  await picker(page).getByRole('button', { name: 'Standard' }).click();
  await expect(page.getByTestId('variant-charts')).toHaveCount(0);
  await expect(page.locator('.chart-legend')).toBeVisible();
});

test('the Variant hands drill deals the seeded hands and grades them on the variant chart', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bjtrainer.variant.v1', 'switch'));
  await page.goto('/?e2e=1&vseed=500');
  await tab(page, 'Drills');
  await page.getByRole('button', { name: 'Variant hands' }).click();
  const drill = page.getByTestId('variant-drill');
  await expect(drill).toHaveAttribute('data-preset', 'switch');

  // Item 0 is seed 500: answered right.
  const first = drawVariantItem('switch', 500);
  const item = page.getByTestId('variant-item');
  await expect(item).toHaveAttribute('data-item-id', first.id);
  const label = (a: string) => a[0]!.toUpperCase() + a.slice(1);
  await page.locator('.action-bar').getByRole('button', { name: label(first.advice.action), exact: true }).click();
  await expect(page.getByTestId('variant-result')).toHaveAttribute('data-correct', 'true');
  await expect(page.getByTestId('variant-drill-score')).toHaveText('1/1');

  // Item 1 is seed 501: answered wrong, and the correction names the right play.
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const second = drawVariantItem('switch', 501);
  await expect(item).toHaveAttribute('data-item-id', second.id);
  const wrong = second.advice.action === 'stand' ? 'hit' : 'stand';
  await page.locator('.action-bar').getByRole('button', { name: label(wrong), exact: true }).click();
  const result = page.getByTestId('variant-result');
  await expect(result).toHaveAttribute('data-correct', 'false');
  await expect(result).toContainText(`${label(second.advice.action)} is right.`);
  await expect(page.getByTestId('variant-drill-score')).toHaveText('1/2');

  // The chart opens over the hand, ringed on its cell, and closes back onto it.
  await result.getByRole('button', { name: 'Show me the chart' }).click();
  const ringed = page.locator('.variant-cell[data-highlight="true"]');
  await expect(ringed).toHaveCount(1);
  await expect(ringed).toHaveText(second.advice.code);
  await page.getByRole('button', { name: /Back to hand/ }).click();
  await expect(item).toHaveAttribute('data-item-id', second.id);
});

test('a casino game can be a variant: the card shows its house edge and says counting is not modelled', async ({ page }) => {
  const AT = '2026-10-01T00:00:00.000Z';
  const log = {
    version: 2,
    casinos: [
      {
        id: 'c1',
        name: 'Rio',
        notes: '',
        status: 'ok',
        createdAt: AT,
        updatedAt: AT,
        games: [{ id: 'g1', decks: 6, s17: false, payout: '3:2', minBet: 25, midShoeEntry: 'allowed', csm: false }],
      },
    ],
    sessions: [],
    settings: { startingBankroll: 10000, updatedAt: AT },
    lastExportAt: AT,
  };
  await page.addInitScript((l) => {
    // A round budget: were the variant ever run, it would land well inside the hold below.
    (window as unknown as { __bjCasinoSimBudget: number }).__bjCasinoSimBudget = 4000;
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('bjtrainer.casinoLog.v3', l);
      sessionStorage.setItem('seeded', '1');
    }
  }, JSON.stringify(log));
  // Review S5: hidden until the game is a variant, so the standard game it starts as is never run.
  const setHidden = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await page.goto('/?e2e=1');
  await setHidden(true);
  await tab(page, 'Casino');
  // Wave W: the directory row opens Rio's page; Edit opens the form; Save comes back to the page.
  await page.getByTestId('casino-row').filter({ hasText: 'Rio' }).click();
  await page.getByRole('button', { name: 'Edit casino', exact: true }).click();
  await page.getByTestId('game-variant').selectOption('freebet');
  await page.getByRole('button', { name: 'Save casino' }).click();
  await expect(page.getByTestId('detail-rules')).toContainText('Free Bet');
  await expect(page.getByTestId('detail-figures')).toHaveText('Not modelled: the simulator does not deal this game');
  await page.getByRole('button', { name: /Back$/ }).click();
  await page.getByTestId('casino-seg-ranked').click();

  const row = page.getByTestId('games-ranked').getByTestId('rank-row');
  await expect(row.getByTestId('rank-ev')).toHaveText('not modelled');
  await expect(row).toContainText('Free Bet');
  // A variant game is never simulated: shown, with nothing to do, it stays idle and nothing is stored.
  await page.evaluate(() => localStorage.removeItem('bjtrainer.casinoGameStats.v1'));
  await setHidden(false);
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('rank-auto')).toHaveAttribute('data-phase', 'idle');
  expect(await page.evaluate(() => localStorage.getItem('bjtrainer.casinoGameStats.v1'))).toBeNull();
  await row.click();
  const card = page.getByTestId('game-stats');
  await expect(card).toHaveAttribute('data-state', 'variant');
  await expect(card.getByTestId('gs-edge')).toHaveText(`${presetData('freebet').houseEdge.toFixed(2)}%`);
  await expect(card.getByTestId('gs-not-modelled')).toHaveText('Not modelled');
  // Stored on the game, additively.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.casinoLog.v3')!).casinos[0].games[0].variant);
  expect(stored).toBe('freebet');
});

/*
 * Merge with Wave M: a variant game at a card room pays the room's commission
 * on top of its chart's edge, and that is the only rule the card says it
 * assumed; the standard game's assumptions (split cap, double-on, ...) are the
 * preset's rules, and a logged one that differs is under "Rules differ".
 */
test('a variant game at a card room: commission added, assumed only for that; logged split rules that differ are named', async ({ page }) => {
  const AT = '2026-10-01T00:00:00.000Z';
  const g = { decks: 6, s17: false, das: null, surrender: null, payout: '3:2', cutDecksLeft: null, minBet: 25, maxBet: null, midShoeEntry: 'unknown', csm: false, variant: 'freebet' };
  const log = {
    version: 2,
    casinos: [
      { id: 'c1', name: 'Card Club', kind: 'cardroom', notes: '', status: 'ok', createdAt: AT, updatedAt: AT, games: [{ ...g, id: 'g1' }] },
      { id: 'c2', name: 'Rio', notes: '', status: 'ok', createdAt: AT, updatedAt: AT, games: [{ ...g, id: 'g2', maxSplitHands: 2, commissionPer100: 0 }] },
    ],
    sessions: [],
    settings: { startingBankroll: 10000, updatedAt: AT },
    lastExportAt: AT,
  };
  await page.addInitScript((l) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('bjtrainer.casinoLog.v3', l);
      sessionStorage.setItem('seeded', '1');
    }
  }, JSON.stringify(log));
  await page.goto('/?e2e=1');
  await tab(page, 'Casino');
  await page.getByTestId('casino-seg-ranked').click();
  const rows = page.getByTestId('games-ranked').getByTestId('rank-row');
  // Both rows drawn first, so "no badge" is about the rows and not an empty list.
  await expect(rows.getByTestId('rank-ev')).toHaveText(['not modelled', 'not modelled']);
  await expect(rows.getByTestId('assumed-badge')).toHaveCount(0);

  await rows.filter({ hasText: 'Card Club' }).click();
  const card = page.getByTestId('game-stats');
  await expect(card.getByTestId('kind-badge')).toHaveText('Card room');
  await expect(card.getByTestId('gs-edge')).toHaveText(`${(presetData('freebet').houseEdge + 1).toFixed(2)}%`);
  await expect(card.getByTestId('gs-assumed-rules')).toContainText('commission $1 per $100 (card room)');
  await expect(card.getByTestId('gs-assumed-rules')).not.toContainText('split');
  await expect(card.getByTestId('gs-commission')).toContainText('$1 per $100');
  await expect(card.getByTestId('gs-variant-mismatch')).toHaveCount(0);
  await page.getByRole('button', { name: /Back$/ }).click();

  await rows.filter({ hasText: 'Rio' }).click();
  // C22 follow-up: the edge is worked out (in a worker) for the logged split-to-2 rule, not the preset's.
  const loggedEdge = houseEdgePct({ ...PRESETS.freebet, maxHands: 2 });
  expect(loggedEdge.toFixed(2)).not.toBe(presetData('freebet').houseEdge.toFixed(2));
  await expect(card.getByTestId('gs-edge')).toHaveText(`${loggedEdge.toFixed(2)}%`);
  await expect(card.getByTestId('gs-edge')).toHaveAttribute('data-edge-state', 'done');
  await expect(card.getByTestId('gs-variant-rules')).toContainText('split to 2 hands');
  await expect(card.getByTestId('gs-variant-rules')).toContainText('The logged rules');
  await expect(card.getByTestId('gs-assumed-rules')).toHaveCount(0);
  await expect(card.getByTestId('gs-commission')).toHaveCount(0);
  await expect(card.getByTestId('gs-variant-mismatch-badge')).toHaveText('Rules differ');
  await expect(card.getByTestId('gs-variant-mismatch')).toContainText('Logged split to 2 hands; the Free Bet figures split to 4.');
});

/** A scriptable recogniser in place of the real one (as e2e/voice-answers.spec.ts). */
async function withFakeEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      lang = '';
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
  });
}

/** The first seed (bounded search over a pure function) whose Spanish 21 item fits. */
function seedWhere(pred: (seed: number) => boolean): number {
  for (let seed = 0; seed < 5000; seed++) if (pred(seed)) return seed;
  throw new Error('no seed in 0..4999 fits');
}

const speechLog = (page: Page) => page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);

async function openVariantVoice(page: Page, seed: number): Promise<void> {
  await withFakeEngine(page);
  await page.addInitScript(() => localStorage.setItem('bjtrainer.variant.v1', 's21-h17'));
  await page.goto(`/?e2e=1&vseed=${seed}`);
  await tab(page, 'Drills');
  await page.getByRole('button', { name: 'Variant hands' }).click();
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  await waitForMic(page);
}

test('Variant hands by voice: misheard words escalate, then "rescue this" surrenders a doubled hand', async ({ page }) => {
  // A doubled Spanish 21 hand whose right play is the rescue.
  const seed = seedWhere((s) => {
    const it = drawVariantItem('s21-h17', s);
    return it.kind === 'afterDouble' && gradeVariantItem(it, 'surrender').correct;
  });
  const item = drawVariantItem('s21-h17', seed);
  await openVariantVoice(page, seed);
  await expect(page.getByTestId('variant-item')).toHaveAttribute('data-item-id', item.id);
  const prompt = narrateVariantPrompt(item);
  await expect.poll(() => speechLog(page)).toContain(prompt);

  // The misheard ladder: the tone first, then the hand said again.
  let mark = (await speechLog(page)).length;
  await sayOnceListening(page, 'wombat');
  await expect.poll(async () => (await speechLog(page)).slice(mark)).toContain('chime:again');
  expect((await speechLog(page)).slice(mark)).not.toContain(prompt);
  mark = (await speechLog(page)).length;
  await sayOnceListening(page, 'wombat');
  await expect.poll(async () => (await speechLog(page)).slice(mark)).toContain(prompt);
  await expect(page.getByTestId('variant-result')).toHaveCount(0);

  // Spanish 21's word for surrendering a doubled hand.
  mark = (await speechLog(page)).length;
  await sayOnceListening(page, 'rescue this');
  const result = page.getByTestId('variant-result');
  await expect(result).toHaveAttribute('data-correct', 'true');
  await expect(result).toContainText('Correct: Surrender');
  // Echoed back, then the correction.
  await expect.poll(async () => (await speechLog(page)).slice(mark)).toEqual(expect.arrayContaining(['Surrender.', 'Correct.']));
  await expect(page.getByTestId('variant-drill-score')).toHaveText('1/1');
});

test('Variant hands by voice: a play the hand does not offer is refused out loud and not graded', async ({ page }) => {
  const seed = seedWhere((s) => !variantItemLegal(drawVariantItem('s21-h17', s)).includes('split'));
  await openVariantVoice(page, seed);
  const mark = (await speechLog(page)).length;
  const tally = () => page.evaluate(() => localStorage.getItem('bjtrainer.variantTally.v1'));
  const before = await tally();
  await sayOnceListening(page, 'split');
  await expect.poll(async () => (await speechLog(page)).slice(mark)).toContain(narrateActionNotAsked('split'));
  // One look, not a retry the result's own auto-advance could satisfy, and the tally a grade writes.
  expect(await page.getByTestId('variant-result').count()).toBe(0);
  expect(await tally(), 'the refused play reached the tally').toBe(before);
  // A word the hand does offer still grades it.
  const item = drawVariantItem('s21-h17', seed);
  await sayOnceListening(page, item.advice.action);
  await expect(page.getByTestId('variant-result')).toHaveAttribute('data-correct', 'true');
});
