import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, playRoundByAdvice, statsTab, sayOnceListening, resolveInsurance } from './helpers';

/**
 * Wave J toggle rework: back-counting is the table's In/Out toggle. It sits
 * beside Deal on every table; Deal deals the next round with the player in or
 * out as it says, at the SAME table and shoe, and it stays where it is put
 * until flipped. Each round is graded from the last round's state, with
 * hysteresis: In, staying in is right unless TC <= the exit point; Out,
 * staying out is right unless TC >= the entry point -- between the two,
 * either is right. "Start each shoe out" (the old back-count mode, which old
 * data maps to) turns it Out as every fresh shoe starts.
 *
 * Fixed seeds throughout, and every graded decision is placed on a fresh
 * shoe, at a TC 0 the test KNOWS; the exit and entry points are moved around
 * it to make the same count a right or a wrong choice.
 */

test.use({ viewport: { width: 375, height: 812 } });

const SETTINGS = {
  feedbackMode: 'training',
  countCheckEvery: 0,
  dealSpeedMs: 0,
  audio: { enabled: true, verbosity: 'full' },
};
/** No bots configured: a player Out watches a table of three anyway. */
const TABLE = { betSpreadOn: true, countCheckEvery: 0, seats: { bots: 0 } };

const speech = (page: Page) => page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);
const toggle = (page: Page) => page.getByRole('group', { name: 'In or out' });
const inBtn = (page: Page) => toggle(page).getByRole('button', { name: 'In', exact: true });
const outBtn = (page: Page) => toggle(page).getByRole('button', { name: 'Out', exact: true });
const dealBtn = (page: Page) => page.getByRole('button', { name: 'Deal', exact: true });
const round = (page: Page) => page.locator('.topbar-stat', { hasText: 'Round' });

async function expectIn(page: Page, isIn: boolean): Promise<void> {
  await expect(inBtn(page)).toHaveAttribute('aria-pressed', String(isIn));
  await expect(outBtn(page)).toHaveAttribute('aria-pressed', String(!isIn));
}

async function openTable(page: Page, profile: Record<string, unknown>, seed = 7): Promise<void> {
  await withSettings(page, SETTINGS);
  await withProfile(page, { ...TABLE, ...profile });
  await page.goto(`/?seed=${seed}&e2e=1`);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
}

test('every table has the toggle, In; Out deals the rounds to three bots at the same table, and stays Out', async ({ page }) => {
  // Exit 0: getting out at the fresh shoe's TC 0 is right. Entry +5: staying out is.
  await openTable(page, { wongExitTc: 0, wongInTc: 5 });
  await expectIn(page, true);
  await expect(dealBtn(page)).toBeVisible();
  // The old buttons are gone.
  for (const gone of ['Sit out', 'Watch', 'Sit in', 'Leave']) {
    await expect(page.getByRole('button', { name: gone, exact: true })).toHaveCount(0);
  }

  await outBtn(page).click();
  await expectIn(page, false);
  // Flipping deals nothing; it says the new state.
  await expect(round(page)).toHaveText('Round 0');
  await expect.poll(async () => (await speech(page)).at(-1)).toBe('Out.');

  for (let r = 1; r <= 3; r++) {
    await dealBtn(page).click();
    await expect(round(page)).toHaveText(`Round ${r}`);
    await expect(page.locator('.message-sat-out')).toHaveText('Out — no bet.');
    await expect(page.getByTestId('player-watching')).toBeVisible();
    await expect(page.locator('.player-hand')).toHaveCount(0);
    // 0 bots configured, three dealt to.
    await expect(page.locator('.bot-seat')).toHaveCount(3);
    // The same table: no shuffle, no new shoe.
    await expect(page.locator('.message-shuffle')).toHaveCount(0);
    // Right every time: no strip.
    await expect(page.locator('.bet-miss')).toHaveCount(0);
    await expectIn(page, false);
  }
  // A round out reads its cards out, to be counted.
  const said = await speech(page);
  expect(said.filter((l) => l === 'Sitting out.')).toHaveLength(3);
  expect(said.filter((l) => l.startsWith('Dealer shows '))).toHaveLength(3);

  // Back in: the same shoe goes on.
  await inBtn(page).click();
  await expect.poll(async () => (await speech(page)).at(-1)).toBe('In.');
  await dealBtn(page).click();
  await expect(round(page)).toHaveText('Round 4');
  await expect(page.locator('.player-hand')).toHaveCount(1);
  await expect(page.locator('.message-shuffle')).toHaveCount(0);
});

/*
 * Hysteresis, at the fresh shoe's TC 0 with the exit at -2 and the entry at
 * +1: between the two points, staying where you are is right from either
 * state, and changing state is the miss either way.
 */
for (const [startOut, flip, miss] of [
  [false, false, null],
  [true, false, null],
  [false, true, 'TC +0 — stay in (you leave at −2)'],
  [true, true, 'TC +0 — stay out (you enter at +1)'],
] as const) {
  const from = startOut ? 'Out' : 'In';
  const to = flip ? (startOut ? 'In' : 'Out') : from;
  test(`hysteresis, TC 0 between exit -2 and entry +1: ${from} -> ${to} is ${miss ? 'the miss' : 'right'}`, async ({ page }) => {
    await openTable(page, { wongExitTc: -2, wongInTc: 1, startShoeOut: startOut });
    await expectIn(page, !startOut);
    if (flip) await (startOut ? inBtn(page) : outBtn(page)).click();
    await dealBtn(page).click();
    await expect(round(page)).toHaveText('Round 1');
    await resolveInsurance(page, false);
    if (miss) await expect(page.locator('.bet-miss')).toHaveText(miss);
    else await expect(page.locator('.bet-miss')).toHaveCount(0);
    await expect(page.locator('.player-hand')).toHaveCount(to === 'In' ? 1 : 0);
  });
}

test('getting in short of the entry point is early: the strip, the spoken line, the report and Stats', async ({ page }) => {
  await openTable(page, { startShoeOut: true, wongInTc: 1 });
  await expectIn(page, false);
  await inBtn(page).click();
  await dealBtn(page).click();
  await expect(page.locator('.bet-miss')).toHaveText('TC +0 — stay out (you enter at +1)');
  await expect.poll(async () => (await speech(page)).includes('Your ramp sits out. True count zero.')).toBe(true);
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  await expect(page.locator('.player-hand')).toHaveCount(1);
  await expect(page.getByTestId('player-watching')).toHaveCount(0);
  await playRoundByAdvice(page);
  // It stays In.
  await expectIn(page, true);

  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
  await expect(page.locator('.report-bets li')).toHaveText(['TC +0 · you got in · you enter at +1']);
  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();

  await page.getByRole('button', { name: 'Stats', exact: true }).click();
  await statsTab(page, 'Play');
  await expect(page.getByTestId('bsl-table-wong-in')).toContainText('At the table: stay out or get in');
  await expect(page.getByTestId('bsl-table-wong-in')).toContainText('0/1');
  await expect(page.getByTestId('bsl-table-wong-in-misses')).toHaveText(/Entries missed · early\s*0 · 1/);
});

test('staying out through the entry point is a missed entry', async ({ page }) => {
  await openTable(page, { startShoeOut: true, wongInTc: 0 });
  await dealBtn(page).click();
  await expect(page.locator('.bet-miss')).toHaveText('TC +0 — get in (you enter at +0)');
  await expect.poll(async () => (await speech(page)).includes('Your ramp plays. True count zero.')).toBe(true);
  await expect(page.locator('.player-hand')).toHaveCount(0);
});

test('staying in at the exit point is a missed exit, named against the exit point', async ({ page }) => {
  await openTable(page, { wongExitTc: 0, wongInTc: 1 });
  await dealBtn(page).click();
  await expect(page.locator('.bet-miss')).toHaveText('TC +0 — get out (you leave at +0)');
  await expect.poll(async () => (await speech(page)).includes('Your ramp sits out. True count zero.')).toBe(true);
  await resolveInsurance(page, false);
  if (await page.locator('.action-bar[data-advice]').isVisible().catch(() => false)) await playRoundByAdvice(page);
  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
  await expect(page.locator('.report-bets li')).toHaveText(['TC +0 · you stayed in · you leave at +0']);
});

test('"start each shoe out": the cut card turns the toggle Out for the next shoe, and says so', async ({ page }) => {
  await withSettings(page, SETTINGS);
  await withProfile(page, { ...TABLE, rules: { decks: 1 }, penetration: 0.1, startShoeOut: true, wongInTc: 1 });
  await page.goto('/?seed=3&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expectIn(page, false);
  // Get in for the round that reaches the cut card.
  await inBtn(page).click();
  await dealBtn(page).click();
  await resolveInsurance(page, false);
  if (await page.locator('.action-bar[data-advice]').isVisible().catch(() => false)) await playRoundByAdvice(page);
  await expect(page.getByTestId('cut-card-cue')).toHaveText('Cut card: the next shoe starts with you out, count 0.');
  await expectIn(page, false);
  await expect.poll(async () => {
    const said = await speech(page);
    return said[said.lastIndexOf('Shuffling.') + 1];
  }).toBe('Out.');
});

test('without "start each shoe out", the toggle stays where it was put across the shuffle', async ({ page }) => {
  await withSettings(page, SETTINGS);
  await withProfile(page, { ...TABLE, rules: { decks: 1 }, penetration: 0.1, wongInTc: 1 });
  await page.goto('/?seed=3&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await dealBtn(page).click();
  await resolveInsurance(page, false);
  if (await page.locator('.action-bar[data-advice]').isVisible().catch(() => false)) await playRoundByAdvice(page);
  await expect(page.getByTestId('cut-card-cue')).toHaveText(/count 0/);
  await expect(page.getByTestId('cut-card-cue')).not.toContainText('out');
  await expectIn(page, true);
});

test('old data: a stored backCount: true starts the table Out, and reads as "Start each shoe out"', async ({ page }) => {
  await openTable(page, { backCount: true, wongInTc: 5 });
  await expectIn(page, false);
  await dealBtn(page).click();
  await expect(page.locator('.message-sat-out')).toHaveText('Out — no bet.');
  await expect(page.locator('.bot-seat')).toHaveCount(3);

  await page.getByRole('button', { name: 'Play settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  await expect(sheet.getByRole('checkbox', { name: 'Start each shoe out' })).toBeChecked();
  await expect(sheet.getByRole('checkbox', { name: 'Back-count' })).toHaveCount(0);
});

test('the gear sheet: "Start each shoe out" and the entry point (review S3a)', async ({ page }) => {
  await withSettings(page, SETTINGS);
  await withProfile(page, { betSpreadOn: true, countCheckEvery: 0, backCount: true });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  await page.getByRole('button', { name: 'Play settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Play settings' });
  const box = sheet.getByRole('checkbox', { name: 'Start each shoe out' });
  await expect(box).toBeChecked();
  await box.uncheck();
  const row = sheet.locator('.settings-row', { hasText: 'Get in at TC' });
  // Toggle fix round (S3): the default entry is 0.
  await expect(row.locator('.stepper-value')).toHaveText('0');
  await row.getByRole('button', { name: '+' }).click();
  await row.getByRole('button', { name: '+' }).click();
  await expect(row.locator('.stepper-value')).toHaveText('+2');
  await expect(sheet.locator('.settings-row', { hasText: 'Get out at TC' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();

  // Off overrides the old field, which is cleared.
  let stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('bjtrainer.profiles.v1') ?? '[]')[0]);
  expect(stored).toMatchObject({ startShoeOut: false, wongInTc: 2 });
  expect('backCount' in stored).toBe(false);

  await page.getByRole('button', { name: 'Play settings' }).click();
  await sheet.getByRole('checkbox', { name: 'Start each shoe out' }).check();
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('bjtrainer.profiles.v1') ?? '[]')[0]);
  expect(stored).toMatchObject({ startShoeOut: true, wongInTc: 2 });
});

test('the wheel (answer mode): back repeats, between rounds and in play, and never flips; forward deals as the toggle says', async ({ page }) => {
  // Toggle fix round (review S2): back is repeat everywhere on the table, as on main.
  await withSettings(page, { ...SETTINGS, drill: { wheelMode: 'answer' } });
  await withProfile(page, { ...TABLE, wongInTc: 5, wongExitTc: 0 });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const press = (c: 'forward' | 'back') => page.evaluate((cmd) => window.__wheelPress?.(cmd) ?? false, c);

  // Between rounds, before any deal: back repeats, the toggle stays In.
  await expectIn(page, true);
  let n = (await speech(page)).length;
  expect(await press('back')).toBe(true);
  // The press arrives off the event loop, not as a click, so whatever it set
  // renders a moment later -- and before any deal there is nothing to repeat,
  // so there is no reaction to wait for. Two frames let any flip it caused
  // land, so "still In" is read after it, not before.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
  );
  await expectIn(page, true);
  await expect(round(page)).toHaveText('Round 0');
  expect((await speech(page)).slice(n)).not.toContain('Out.');

  // Forward deals In.
  expect(await press('forward')).toBe(true);
  await expect(round(page)).toHaveText('Round 1');
  await expect(page.locator('.player-hand')).toHaveCount(1);
  await resolveInsurance(page, false);
  // In play: back re-says the decision and plays nothing.
  if (await page.locator('.action-bar[data-advice]').isVisible().catch(() => false)) {
    await expect.poll(async () => (await speech(page)).length).toBeGreaterThan(0);
    const said = await speech(page);
    const lastLine = said.filter((l) => !l.startsWith('chime:')).at(-1)!;
    n = said.length;
    expect(await press('back')).toBe(true);
    await expect.poll(async () => (await speech(page)).slice(n)).toContain(lastLine);
    await expect(page.locator('.action-bar[data-advice]')).toBeVisible();
    await playRoundByAdvice(page);
  }

  // Settled: back re-says the result line, and the toggle does not move.
  await expect(dealBtn(page)).toBeVisible();
  await expect.poll(async () => (await speech(page)).filter((l) => !l.startsWith('chime:')).length).toBeGreaterThan(0);
  const settledSaid = await speech(page);
  const resultLine = settledSaid.filter((l) => !l.startsWith('chime:')).at(-1)!;
  n = settledSaid.length;
  expect(await press('back')).toBe(true);
  await expect.poll(async () => (await speech(page)).slice(n)).toContain(resultLine);
  await expectIn(page, true);
  await expect(round(page)).toHaveText('Round 1');

  // Tapped Out, forward deals the round out.
  await outBtn(page).click();
  expect(await press('forward')).toBe(true);
  await expect(round(page)).toHaveText('Round 2');
  await expect(page.locator('.message-sat-out')).toHaveText('Out — no bet.');
  await expect(page.locator('.player-hand')).toHaveCount(0);
  await expectIn(page, false);
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

test('out loud: "out" and "sit in" set the toggle, "yes" deals as it says, and a runner-up never flips it', async ({ page }) => {
  await withFakeEngine(page);
  await openTable(page, { wongInTc: 5, wongExitTc: 0 });
  await page.locator('.voice-btn').click();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
  await expect(page.locator('.voice-status')).toContainText('“In” or “sit in” and “out” or “sit out” set the toggle');

  // Voice on, a chime follows each line: the cue is read off what was said since.
  const saidSince = async (n: number) => (await speech(page)).slice(n);
  let n = (await speech(page)).length;
  await sayOnceListening(page, 'out');
  await expectIn(page, false);
  await expect.poll(() => saidSince(n)).toContain('Out.');
  await expect(round(page)).toHaveText('Round 0');

  // Review S1: "in" ranked under "yes" -- the runner-up never outranks the
  // command the engine heard first. "Yes" deals, Out.
  await sayOnceListening(page, 'yes', ['in']);
  await expect(round(page)).toHaveText('Round 1');
  await expect(page.locator('.message-sat-out')).toHaveText('Out — no bet.');
  await expectIn(page, false);

  n = (await speech(page)).length;
  await sayOnceListening(page, 'sit in');
  await expectIn(page, true);
  await expect.poll(() => saidSince(n)).toContain('In.');
  await sayOnceListening(page, 'yes');
  await expect(round(page)).toHaveText('Round 2');
  await expect(page.locator('.player-hand')).toHaveCount(1);
  await playRoundByAdvice(page);

  await sayOnceListening(page, 'sit out');
  await expectIn(page, false);
});

test('push to talk (the default wheel mode): forward opens the microphone, and "out" sets the toggle', async ({ page }) => {
  // Toggle fix round (S2): the wheel has no flip gesture; with the mic off,
  // the eyes-free way to the toggle is push-to-talk.
  await withFakeEngine(page);
  await withSettings(page, { ...SETTINGS, drill: { wheelMode: 'talk' } });
  await withProfile(page, { ...TABLE, wongInTc: 5, wongExitTc: 0 });
  await page.goto('/?seed=7&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expectIn(page, true);
  const n = (await speech(page)).length;
  expect(await page.evaluate(() => window.__wheelPress?.('forward') ?? false)).toBe(true);
  // The push-to-talk window shows no voice bar: wait for the engine it
  // started, then hand it the phrase as a real engine would.
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __rec?: unknown }).__rec))).toBe(true);
  await expect
    .poll(async () => {
      await page.evaluate(() => {
        const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
        rec?.onresult?.({ results: [[{ transcript: 'out' }]] });
      });
      return outBtn(page).getAttribute('aria-pressed');
    })
    .toBe('true');
  await expectIn(page, false);
  await expect.poll(async () => (await speech(page)).slice(n)).toContain('Out.');
  // Setting the toggle dealt nothing.
  await expect(round(page)).toHaveText('Round 0');
});
