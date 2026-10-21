import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, playRoundByAdvice, shot } from './helpers';
import { makeSideCountRun } from '../src/drills/sideCountDrill';
import { sidePlan } from '../src/engine/sideBets/plan';
import { triggerText } from '../src/ui/sideBetFeedback';

/**
 * Wave L: side bets -- the side count drill, the side-bet chip at the Play
 * table (graded against the bet's trigger, missed calls said in the bet-miss
 * style, the result settled and shown), the voice words, and the casino
 * stats card's row per side bet.
 *
 * Nothing here depends on luck: the drill is seeded (`?seed=`) and its
 * answers are computed from the same seeded run; Play's calls are made at a
 * fresh shoe's count, where a bet with a high trigger is "no bet" and a bet
 * positive off the top is "bet" whatever the cards.
 */

test.use({ viewport: { width: 375, height: 812 } });

const speech = (page: Page) => page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);
const chip = (page: Page) => page.getByTestId('side-chip');
const deal = (page: Page) => page.getByRole('button', { name: 'Deal', exact: true });

async function openTable(page: Page, sideBet: Record<string, unknown>, decks = 6): Promise<void> {
  await withSettings(page, { feedbackMode: 'training', countCheckEvery: 0, dealSpeedMs: 0, audio: { enabled: true } });
  await withProfile(page, { countCheckEvery: 0, rules: { decks, s17: true }, sideBet: { enabled: true, stake: 25, ...sideBet } });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
}

test.describe('Play: the side-bet chip', () => {
  test('a bet worth making every hand: skipping it is the miss, said and shown; making it settles and shows', async ({ page }) => {
    const plan = sidePlan('royalMatch', 'rm-v2', 6, true)!;
    expect(plan.always).toBe(true);
    await openTable(page, { bet: 'royalMatch', payTable: 'rm-v2' });
    await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(chip(page)).toContainText('Royal');
    await expect(chip(page)).toContainText('$25');
    await shot(page, 'side-bet-chip-off');
    await deal(page).click();
    const miss = page.getByTestId('side-miss');
    await expect(miss).toHaveText('Royal Match count +0 — bet it (every hand)');
    await expect.poll(async () => (await speech(page)).includes('Side count says bet.')).toBe(true);
    // Not a modal: the hand plays on.
    await expect(page.locator('.modal-backdrop')).toHaveCount(0);
    await playRoundByAdvice(page);
    await expect(page.getByTestId('side-result')).toHaveCount(0);

    await chip(page).click();
    await expect(chip(page)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await speech(page)).includes('Side bet on.')).toBe(true);
    await deal(page).click();
    await expect(page.getByTestId('side-miss')).toHaveCount(0);
    await playRoundByAdvice(page);
    // Settled and shown: what the two cards made, and the money.
    await expect(page.getByTestId('side-result')).toHaveText(/^Royal Match: (royal match|suited blackjack|suited|lost) — [+−]\$\d+(\.\d\d)?$/);
    // Sticky, like the In/Out toggle.
    await expect(chip(page)).toHaveAttribute('aria-pressed', 'true');
    // Stats: the two calls, by bet, beside (not inside) the table's accuracy.
    await expect
      .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.stats.v1') ?? '{}').sideBets?.play?.royalMatch ?? null))
      .toMatchObject({ right: 1, wrong: 1, placed: 1 });
  });

  test('a bet with a high trigger: making it at a fresh shoe is the miss; skipping it is right', async ({ page }) => {
    const plan = sidePlan('luckyLadies', 'll-a', 6, true)!;
    expect(plan.trigger).toBeGreaterThan(1);
    await openTable(page, { bet: 'luckyLadies', payTable: 'll-a' });
    await deal(page).click();
    await expect(page.getByTestId('side-miss')).toHaveCount(0);
    await playRoundByAdvice(page);
    await chip(page).click();
    await deal(page).click();
    // The count after one round is small beside the trigger: still "no bet".
    await expect(page.getByTestId('side-miss')).toHaveText(new RegExp(`^Lucky Ladies count [+−]\\d+ — no side bet \\(${triggerText(plan).replace(/[+()]/g, '\\$&')}\\)$`));
    await expect.poll(async () => (await speech(page)).includes('Side count says no bet.')).toBe(true);
    await shot(page, 'side-bet-miss');
    await playRoundByAdvice(page);
    await expect(page.getByTestId('side-result')).toBeVisible();
  });

  test('the chip is off the table when the player is Out', async ({ page }) => {
    await openTable(page, { bet: 'over13', payTable: 'ou-even' });
    await page.getByRole('group', { name: 'In or out' }).getByRole('button', { name: 'Out', exact: true }).click();
    await expect(chip(page)).toBeDisabled();
  });

  test('a profile without a side bet has no chip', async ({ page }) => {
    await withSettings(page, { feedbackMode: 'training', countCheckEvery: 0, dealSpeedMs: 0 });
    await withProfile(page, { countCheckEvery: 0 });
    await page.goto('/?seed=7&e2e=1');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(deal(page)).toBeVisible();
    await expect(chip(page)).toHaveCount(0);
  });
});

test.describe('Play: the voice words', () => {
  test('"side on" and "skip side" set the chip; "yes" still deals', async ({ page }) => {
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
    await openTable(page, { bet: 'over13', payTable: 'ou-even' });
    await page.locator('.voice-btn').click();
    const { sayOnceListening } = await import('./helpers');
    await sayOnceListening(page, 'side on');
    await expect(chip(page)).toHaveAttribute('aria-pressed', 'true');
    await sayOnceListening(page, 'skip side');
    await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
    // A runner-up reading never flips it.
    await sayOnceListening(page, 'sit in', ['side on']);
    await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
    await sayOnceListening(page, 'yes');
    await expect(page.locator('.action-bar[data-advice]').or(page.getByRole('button', { name: 'Continue', exact: true }))).toBeVisible();
  });
});

test.describe('the side count drill', () => {
  test('a seeded run: the checkpoint and the end ask the side count, then whether to bet', async ({ page }) => {
    await withSettings(page, { countCheckEvery: 0 });
    await withProfile(page, { rules: { decks: 6, s17: true }, sideBet: { enabled: true, bet: 'over13', payTable: 'ou-even', stake: 25 } });
    await page.goto('/?seed=5&e2e=1');
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: 'Side count', exact: true }).click();
    await expect(page.getByTestId('side-drill-count')).toContainText('Crush count (Jacobson)');
    // Eight cards, one checkpoint, the fastest pace.
    const cards = page.locator('.settings-row', { hasText: 'Cards' });
    for (let i = 0; i < 9; i++) await cards.locator('.stepper-btn').first().click();
    await expect(cards.locator('.stepper-value')).toHaveText('8');
    await page.getByRole('button', { name: '0.6s', exact: true }).click();
    await shot(page, 'side-drill-setup');

    const plan = sidePlan('over13', 'ou-even', 6, true)!;
    const run = makeSideCountRun({
      count: plan.count!,
      plan: { always: plan.always, count: plan.count, trigger: plan.trigger, betBelow: plan.betBelow },
      decks: 6,
      cards: 8,
      groupSize: 1,
      checkpoints: 'one',
      withHiLo: false,
      seed: 5,
    });
    expect(run.stops).toHaveLength(2);
    await page.getByTestId('side-drill-start').click();

    const ask = page.getByTestId('side-drill-ask');
    const enter = async (n: number) => {
      for (const d of String(Math.abs(n))) await ask.getByRole('button', { name: d, exact: true }).click();
      if (n < 0) await ask.getByRole('button', { name: 'Plus or minus', exact: true }).click();
      await ask.getByRole('button', { name: 'OK', exact: true }).click();
    };
    // Checkpoint: the right count.
    await expect(ask).toHaveAttribute('data-kind', 'count');
    await expect(page.getByTestId('side-drill-question')).toHaveText(`After ${run.stops[0]!.cardsShown} cards`);
    await expect(ask.locator('.numpad-label')).toHaveText('Side running count?');
    await shot(page, 'side-drill-checkpoint');
    const first = run.stops[0]!.questions[0]!;
    if (first.kind !== 'count') throw new Error('expected a count question');
    await enter(first.actual);
    // The end: a wrong count, then the bet call.
    const end = run.stops[1]!;
    const last = end.questions[0]!;
    const bet = end.questions[1]!;
    if (last.kind !== 'count' || bet.kind !== 'bet') throw new Error('expected count then bet');
    await expect(ask).toHaveAttribute('data-kind', 'count', { timeout: 15_000 });
    await expect.poll(async () => page.getByTestId('side-drill-ask').getAttribute('data-kind')).toBe('count');
    await enter(last.actual + 1);
    await expect(ask).toHaveAttribute('data-kind', 'bet');
    await page.getByTestId(bet.actual ? 'side-drill-yes' : 'side-drill-no').click();
    const result = page.getByTestId('side-drill-result');
    await expect(result).toContainText('2 of 3 right');
    const rows = page.getByTestId('side-drill-answer');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveClass(/result-correct/);
    await expect(rows.nth(1)).toHaveClass(/result-wrong/);
    await expect(rows.nth(2)).toHaveClass(/result-correct/);
    await shot(page, 'side-drill-result');
    // Recorded in Stats.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.stats.v1') ?? '{}'));
    expect(stored.sideBets.drill.at(-1)).toMatchObject({ bet: 'over13', checkpoints: 3, correct: 2, withHiLo: false });
  });
});

test.describe('the casino stats card', () => {
  const AT = '2026-10-01T00:00:00.000Z';
  const game = {
    id: 'g-side',
    decks: 6,
    s17: true,
    das: true,
    surrender: true,
    payout: '3:2',
    cutDecksLeft: 1,
    minBet: 25,
    maxBet: 1000,
    midShoeEntry: 'allowed',
    csm: false,
    sideBets: [
      { bet: 'buster', payTable: 'bu-evo', minBet: 25, maxBet: 100 },
      { bet: 'perfectPairs', payTable: 'pp-a', minBet: 5, maxBet: 100 },
    ],
  };
  const LOG = {
    version: 2,
    casinos: [{ id: 'c1', name: 'Side Street', notes: '', createdAt: AT, updatedAt: AT, status: 'ok', games: [game] }],
    sessions: [],
    settings: { startingBankroll: 10000, updatedAt: AT },
    lastExportAt: AT,
  };

  test('a row per side bet: the exact edge, the count and trigger, the counted EV per hour', async ({ page }) => {
    await page.addInitScript((log) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('bjtrainer.casinoLog.v2', log);
        sessionStorage.setItem('seeded', '1');
      }
    }, JSON.stringify(LOG));
    await page.goto('/?e2e=1');
    await page.locator('.tab-bar').getByRole('button', { name: 'Casino', exact: true }).click();
    await page.getByTestId('games-ranked').getByTestId('rank-row').first().click();
    const card = page.getByTestId('gs-side-bets');
    await expect(card).toBeVisible();
    const rows = card.getByTestId('gs-side-row');
    await expect(rows).toHaveCount(2);
    const buster = sidePlan('buster', 'bu-evo', 6, true)!;
    const bRow = rows.nth(0);
    await expect(rows.nth(0)).toHaveAttribute('data-bet', 'buster');
    await expect(rows.nth(0).getByTestId('gs-side-edge')).toHaveText(`${(buster.row.edge * 100).toFixed(2)}%`);
    await expect(bRow).toContainText(buster.candidate!.name);
    await expect(rows.nth(0)).toHaveAttribute('data-best', 'true');
    const per100 = buster.candidate!.per100;
    const evHour = Math.round((per100 / 100) * 25 * 80);
    await expect(rows.nth(0).getByTestId('gs-side-ev')).toContainText(`+$${evHour}`);
    // Perfect Pairs: not countable, worth nothing counted.
    await expect(rows.nth(1)).toContainText('never');
    await card.scrollIntoViewIfNeeded();
    await shot(page, 'side-casino-card');
  });
});
