import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, playRoundByAdvice, statsTab, sayOnceListening } from './helpers';

/**
 * Wave J: back-counting. Every shoe starts with the player watching -- dealt
 * nothing, the round going to the bots and the dealer -- and each round asks
 * Watch or Sit in, graded at the entry point. Seated, Sit out is Leave: the
 * exit is graded, and the next round is a new table, a fresh shoe, watched.
 *
 * Fixed seeds throughout, and every decision is placed at a count the test
 * KNOWS: a fresh shoe is TC 0, which is why the entry point is moved (0 or
 * +1) to make the same count a right or a wrong entry. The one count read
 * mid-shoe (before a leave) is read off the peek and pinned, so a change in
 * the dealt path fails here by name instead of grading the other branch.
 */

test.use({ viewport: { width: 375, height: 812 } });

/** Seed 7, entry 0, sat in at the fresh shoe and played by the advice: the count then. */
const LEAVE_TC = 0;
/** ...above the default exit point (-2), so leaving is the miss. */
const LEAVE_MISS = 'Play at TC +0 — you left';

const SETTINGS = {
  feedbackMode: 'training',
  countCheckEvery: 0,
  dealSpeedMs: 0,
  audio: { enabled: true, verbosity: 'full' },
};
/** No bots configured: a back-counter watches a table of three anyway. */
const BACK_COUNT = { betSpreadOn: true, backCount: true, countCheckEvery: 0, seats: { bots: 0 } };

const speech = (page: Page) => page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);
const watchBtn = (page: Page) => page.getByRole('button', { name: 'Watch', exact: true });
const sitInBtn = (page: Page) => page.getByRole('button', { name: 'Sit in', exact: true });
const roundNo = async (page: Page) => Number((await page.locator('.topbar-stat', { hasText: 'Round' }).innerText()).replace(/\D/g, ''));

async function openTable(page: Page, profile: Record<string, unknown>, seed = 7): Promise<void> {
  await withSettings(page, SETTINGS);
  await withProfile(page, { ...BACK_COUNT, ...profile });
  await page.goto(`/?seed=${seed}&e2e=1`);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
}

/** The graded TC, read off the held peek (#40/#41). */
async function peekTc(page: Page): Promise<number> {
  const peek = page.locator('.tc-peek-btn');
  await peek.focus();
  await page.keyboard.down('Enter');
  const tc = Number(await peek.getAttribute('data-tc'));
  await page.keyboard.up('Enter');
  return tc;
}

test('every shoe starts watching: three bots, no player hand, Watch and Sit in in place of Deal', async ({ page }) => {
  // Entry +5: three rounds off a fresh shoe are all watches.
  await openTable(page, { wongInTc: 5 });
  await expect(page.getByTestId('player-watching')).toHaveText('Watching');
  await expect(watchBtn(page)).toBeVisible();
  await expect(sitInBtn(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sit out', exact: true })).toHaveCount(0);

  for (let round = 1; round <= 3; round++) {
    await watchBtn(page).click();
    await expect(page.locator('.topbar-stat', { hasText: 'Round' })).toHaveText(`Round ${round}`);
    await expect(page.locator('.message-sat-out')).toHaveText('Watching — no bet.');
    await expect(page.getByTestId('player-watching')).toBeVisible();
    await expect(page.locator('.player-hand')).toHaveCount(0);
    // 0 bots configured, three dealt to.
    await expect(page.locator('.bot-seat')).toHaveCount(3);
    await expect(page.locator('.bot-seat').first().locator('.card').first()).toBeVisible();
    // A right watch: no strip.
    await expect(page.locator('.bet-miss')).toHaveCount(0);
  }
  // A watched round says so, and reads out its cards to be counted -- a
  // plain sit-out reads none of them.
  const said = await speech(page);
  expect(said.filter((l) => l === 'Sitting out.')).toHaveLength(3);
  expect(said.filter((l) => l.startsWith('Dealer shows '))).toHaveLength(3);
});

test('sitting in short of the entry point is an early entry: the strip, the spoken line, the report and Stats', async ({ page }) => {
  await openTable(page, { wongInTc: 1 });
  // Fresh shoe, TC 0, entry +1: the count says keep watching.
  await sitInBtn(page).click();
  await expect(page.locator('.bet-miss')).toHaveText('TC +0 — keep watching (you enter at +1)');
  await expect.poll(async () => (await speech(page)).includes('Your ramp sits out. True count zero.')).toBe(true);
  // Not a modal, and the hand is dealt: the player sat in.
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  await expect(page.locator('.player-hand')).toHaveCount(1);
  await expect(page.getByTestId('player-watching')).toHaveCount(0);
  await playRoundByAdvice(page);
  // Seated: Deal, and Sit out is Leave.
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Leave', exact: true })).toBeVisible();
  await expect(watchBtn(page)).toHaveCount(0);

  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
  await expect(page.locator('.report-bets li')).toHaveText(['TC +0 · you sat in · you enter at +1']);
  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();

  await page.getByRole('button', { name: 'Stats', exact: true }).click();
  await statsTab(page, 'Play');
  await expect(page.getByTestId('bsl-table-wong-in')).toContainText('0/1');
  await expect(page.getByTestId('bsl-table-wong-in-misses')).toHaveText(/Entries missed · early\s*0 · 1/);
});

test('watching through the entry point is a missed entry', async ({ page }) => {
  await openTable(page, { wongInTc: 0 });
  // Entry 0: the fresh shoe's TC 0 calls for a seat.
  await watchBtn(page).click();
  await expect(page.locator('.bet-miss')).toHaveText('TC +0 — sit in (you enter at +0)');
  await expect.poll(async () => (await speech(page)).includes('Your ramp plays. True count zero.')).toBe(true);
  await expect(page.locator('.player-hand')).toHaveCount(0);
});

test('a right entry, then leaving: nothing is dealt, and the next round is a new table, a fresh shoe, watched', async ({ page }) => {
  await openTable(page, { wongInTc: 0 });
  await sitInBtn(page).click();
  // TC 0 at entry 0, a 1-unit chip at the ramp's 1 unit: nothing wrong.
  await expect(page.locator('.player-hand')).toHaveCount(1);
  await expect(page.locator('.bet-miss')).toHaveCount(0);
  await playRoundByAdvice(page);
  const leaveBtn = page.getByRole('button', { name: 'Leave', exact: true });
  await expect(leaveBtn).toBeVisible();

  // Pinned: this seed's count after its first round (see the header).
  const tc = await peekTc(page);
  expect(tc, 'seed 7 changed its first round').toBe(LEAVE_TC);
  const before = await roundNo(page);
  const saidBefore = (await speech(page)).length;
  await leaveBtn.click();
  // The exit is graded at the default exit point, -2: above it, leaving is the miss.
  await expect(page.locator('.bet-miss')).toHaveText(LEAVE_MISS);
  // Nothing was dealt: same round, the settled hand still on the felt.
  expect(await roundNo(page)).toBe(before);
  await expect(page.locator('.player-hand')).toHaveCount(1);
  await expect(page.getByTestId('new-table-cue')).toHaveText('New table: the next hand is off a fresh shoe, count 0.');
  await expect(page.getByTestId('cut-card-cue')).toHaveCount(0);
  await expect.poll(async () => (await speech(page)).slice(saidBefore)).toContain('Shuffling.');
  // Review S4: then a recorded "Watching.", so eyes-free the next forward
  // press is known to watch rather than deal.
  await expect.poll(async () => {
    const said = (await speech(page)).slice(saidBefore);
    return said[said.indexOf('Shuffling.') + 1];
  }).toBe('Watching.');
  await expect(watchBtn(page)).toBeVisible();
  await expect(sitInBtn(page)).toBeVisible();

  // The new table: a fresh shoe at TC 0 -- which, at entry 0, a watch misses.
  await watchBtn(page).click();
  await expect(page.locator('.message-shuffle')).toHaveText('New table…');
  await expect(page.locator('.bet-miss')).toHaveText('TC +0 — sit in (you enter at +0)');
  await expect(page.getByTestId('player-watching')).toBeVisible();
  await expect(page.getByTestId('new-table-cue')).toHaveCount(0);
  // "Shuffling." was said once, for the walk -- not again as the shoe is dealt.
  expect((await speech(page)).slice(saidBefore).filter((l) => l === 'Shuffling.')).toHaveLength(1);
});

test('the wheel between rounds: forward carries on (watch, deal), back changes seat (sit in, leave)', async ({ page }) => {
  await withSettings(page, { ...SETTINGS, drill: { wheelMode: 'answer' } });
  await withProfile(page, { ...BACK_COUNT, wongInTc: 1 });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const press = (c: 'forward' | 'back') => page.evaluate((cmd) => window.__wheelPress?.(cmd) ?? false, c);

  expect(await press('forward')).toBe(true);
  await expect(page.locator('.message-sat-out')).toHaveText('Watching — no bet.');
  await expect(page.locator('.player-hand')).toHaveCount(0);

  expect(await press('back')).toBe(true);
  await expect(page.locator('.player-hand')).toHaveCount(1);
  await expect(page.getByTestId('player-watching')).toHaveCount(0);
  await playRoundByAdvice(page);

  // Seated (review S2): forward deals the next round, seated...
  const before = await roundNo(page);
  expect(await press('forward')).toBe(true);
  await expect.poll(() => roundNo(page)).toBe(before + 1);
  await expect(page.locator('.player-hand')).toHaveCount(1);
  await playRoundByAdvice(page);
  // ...and back leaves: graded, a new table, watched.
  await expect(page.getByTestId('new-table-cue')).toHaveCount(0);
  expect(await press('back')).toBe(true);
  await expect(page.getByTestId('new-table-cue')).toBeVisible();
  await expect(watchBtn(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Leave', exact: true })).toHaveCount(0);
});

test('the gear sheet turns back-counting on and sets the entry point (review S3a)', async ({ page }) => {
  await withSettings(page, SETTINGS);
  await withProfile(page, { betSpreadOn: true, countCheckEvery: 0 });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Deal', exact: true })).toBeVisible();
  await expect(watchBtn(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Play settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  await sheet.getByRole('checkbox', { name: 'Back-count' }).check();
  const row = sheet.locator('.settings-row', { hasText: 'Enter at TC' });
  await expect(row.locator('.stepper-value')).toHaveText('+1');
  await row.getByRole('button', { name: '+' }).click();
  await expect(row.locator('.stepper-value')).toHaveText('+2');
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('bjtrainer.profiles.v1') ?? '[]')[0]);
  expect(stored).toMatchObject({ backCount: true, wongInTc: 2 });
  await expect(watchBtn(page)).toBeVisible();
  await expect(sitInBtn(page)).toBeVisible();
  // Entry +2 at the fresh shoe's TC 0: sitting in is early.
  await sitInBtn(page).click();
  await expect(page.locator('.bet-miss')).toHaveText('TC +0 — keep watching (you enter at +2)');
});

/** The recogniser, faked as voice-table.spec.ts fakes it; `sayOnceListening` delivers a transcript. */
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

test('out loud: "yes" and "watch" watch, "sit in" sits down, "leave" leaves', async ({ page }) => {
  await withFakeEngine(page);
  await openTable(page, { wongInTc: 5 });
  await page.locator('.voice-btn').click();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
  await expect(page.locator('.voice-status')).toContainText('“sit in” sits you down');

  // "Yes" deals a seated round; a watcher's next round is dealt without them.
  // Review S1: with "in" ranked under it -- a runner-up never outranks the
  // command the engine heard first.
  await sayOnceListening(page, 'yes', ['in']);
  await expect(page.locator('.topbar-stat', { hasText: 'Round' })).toHaveText('Round 1');
  await expect(page.locator('.message-sat-out')).toHaveText('Watching — no bet.');
  await sayOnceListening(page, 'watch');
  await expect(page.locator('.topbar-stat', { hasText: 'Round' })).toHaveText('Round 2');
  await expect(page.locator('.player-hand')).toHaveCount(0);

  await sayOnceListening(page, 'sit in');
  await expect(page.locator('.player-hand')).toHaveCount(1);
  await playRoundByAdvice(page);
  // Seated, "sit in" is nothing, and "leave" walks.
  await sayOnceListening(page, 'sit in');
  await expect(page.getByTestId('new-table-cue')).toHaveCount(0);
  await sayOnceListening(page, 'leave');
  await expect(page.getByTestId('new-table-cue')).toBeVisible();
  await expect(watchBtn(page)).toBeVisible();
});
