import { test, expect, type Locator, type Page } from '@playwright/test';
import { withSettings } from './helpers';
import { worstContrast } from './contrast';

/**
 * Wave K: several games per casino, each worked out by the in-app simulator,
 * and the "Games ranked" list built from them. Wave Q: worked out on their
 * own -- there is no Compute button -- whenever a game's inputs change.
 *
 * The simulator runs in a Web Worker; `window.__bjCasinoSimBudget` caps each
 * game at a few thousand rounds so it finishes in about a second, the same
 * every time. The figures at that budget are noisy, so nothing here pins a
 * dollar amount: the spec checks the ORDER against the figures shown, the
 * states a result moves through (none -> current -> stale -> current), and
 * what each card says.
 */

test.use({ viewport: { width: 375, height: 812 } });

const KEY = 'bjtrainer.casinoLog.v3';
const STATS_KEY = 'bjtrainer.casinoGameStats.v1';
const AT = '2026-10-01T00:00:00.000Z';

// Wave M: every rule logged, including the split / double rules added then, so nothing is "Assumed".
const good = {
  id: 'g-good', decks: 6, s17: false, das: true, surrender: true, payout: '3:2', cutDecksLeft: 1, minBet: 25, maxBet: 1000, midShoeEntry: 'allowed', csm: false,
  rsa: false, doubleSplitAces: false, maxSplitHands: 4, doubleOn: 'any2',
};
const csm = { id: 'g-csm', label: 'CSM pit', decks: 6, s17: false, das: true, surrender: false, payout: '6:5', cutDecksLeft: null, minBet: 15, maxBet: null, midShoeEntry: 'unknown', csm: true };
const deep = { id: 'g-deep', decks: 2, s17: true, das: true, surrender: false, payout: '3:2', cutDecksLeft: 0.75, minBet: 25, maxBet: 500, midShoeEntry: 'no', csm: false };
const base = { notes: '', createdAt: AT, updatedAt: AT, status: 'ok' };

const LOG = {
  version: 2,
  casinos: [
    { ...base, id: 'c1', name: 'Golden Nugget', notes: 'Ray on swing shift watches the spread\nComps at the cage', games: [good, csm], driveMinutes: 20, location: { lat: 36.11, lon: -115.17 } },
    { ...base, id: 'c2', name: 'El Cortez', games: [deep], driveMinutes: 90 },
    { ...base, id: 'c3', name: 'Burned Palace', status: 'burned', burnedUntil: '2099-01-01', games: [{ ...good, id: 'g-burned' }] },
  ],
  sessions: [],
  settings: { startingBankroll: 10000, updatedAt: AT },
  lastExportAt: AT,
};

/** Seed the log once per test (a reload keeps what the page wrote), and set the tiny budget on every load. */
async function seed(page: Page, budget = 4000, log: unknown = LOG): Promise<void> {
  await page.addInitScript(
    ([k, log, b]) => {
      (window as unknown as { __bjCasinoSimBudget: number }).__bjCasinoSimBudget = b as number;
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(k as string, log as string);
        sessionStorage.setItem('seeded', '1');
      }
    },
    [KEY, JSON.stringify(log), budget],
  );
}

type Part = 'casinos' | 'ranked' | 'sessions';
/** Wave W: Casino's home is in three parts; most of this file reads the ranking, so that is the default. */
const seg = (page: Page, part: Part) => page.getByTestId(`casino-seg-${part}`).click();
async function openCasino(page: Page, part: Part = 'ranked'): Promise<void> {
  await page.locator('.tab-bar').getByRole('button', { name: 'Casino', exact: true }).click();
  await seg(page, part);
}
/** From home: the casino's page (the directory row), then its form. */
async function editCasino(page: Page, name: string): Promise<void> {
  await seg(page, 'casinos');
  await page.getByTestId('casino-row').filter({ hasText: name }).click();
  await page.getByRole('button', { name: 'Edit casino', exact: true }).click();
}
/**
 * Save the form (back on the casino's page), then home to the ranking. Wave
 * W (review S2): a rule change on a version holding sessions or figures
 * asks whether the casino changed it; these tests correct the rules in
 * place ("Fix this version"), answered only when asked (whether figures
 * have landed by then depends on the simulator's pace).
 */
async function saveToRanked(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save casino' }).click();
  const prompt = page.getByTestId('version-prompt');
  await expect(prompt.or(page.getByTestId('casino-detail'))).toBeVisible();
  if (await prompt.isVisible()) {
    await prompt.getByTestId('version-fix').click();
    await prompt.getByRole('button', { name: 'Save casino' }).click();
  }
  await expect(page.getByTestId('casino-detail')).toBeVisible();
  await back(page);
  await seg(page, 'ranked');
}
const back = (page: Page) => page.getByRole('button', { name: /Back$/ }).click();
const ranked = (page: Page) => page.getByTestId('games-ranked');

/**
 * Wave T: screenshots for the owner's read of the wording, only with
 * CAS_SHOTS set: 375 x 812 with the notch insets and 320 x 568, dark
 * (midnight-felt) and light (bone-ink), at each element in `at`.
 */
const SHOTS = process.env.CAS_SHOTS;
type At = [string, (page: Page) => Locator];
const CARD_SPOTS: At[] = [
  ['header', (p) => p.getByTestId('gs-assumed-rules')],
  ['bottom', (p) => p.getByTestId('gs-assumed')],
];
async function shotCard(page: Page, name: string, at: At[] = CARD_SPOTS): Promise<void> {
  if (!SHOTS) return;
  for (const [w, h] of [[375, 812], [320, 568]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate((inset) => {
      let el = document.getElementById('shot-inset');
      if (!el) {
        el = document.createElement('style');
        el.id = 'shot-inset';
        document.head.appendChild(el);
      }
      el.textContent = inset ? ':root { --safe-top: 47px; --safe-bottom: 34px; }' : '';
    }, w === 375);
    for (const theme of ['midnight-felt', 'bone-ink']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      for (const [spot, find] of at) {
        await find(page).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: `${SHOTS}/${w}-${theme}-${name}-${spot}.png` });
      }
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
}
const rows = (page: Page) => ranked(page).getByTestId('rank-row');

/** Wave Q: no button anywhere asks for a run. */
async function noComputeButtons(page: Page): Promise<void> {
  for (const id of ['compute-all', 'compute-game', 'rerun-game']) await expect(page.getByTestId(id)).toHaveCount(0);
}

/** Wave Q: the page as the phone hides it (locked, another app): the runner stops. */
const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

/** The stored result for a game, read from the page. */
const stored = (page: Page, id: string) =>
  page.evaluate(([k, g]) => (JSON.parse(localStorage.getItem(k!) ?? '{"results":{}}').results[g!] ?? null) as { key: string; status: string; basicRounds: number; countRounds: number } | null, [STATS_KEY, id]);

/** "+$123/h" / "−$45/h" -> number. */
function money(text: string): number {
  const m = /([+−-])?\$([\d,.]+)/.exec(text);
  if (!m) throw new Error(`no dollar figure in "${text}"`);
  const v = Number(m[2]!.replace(/,/g, ''));
  return m[1] === '−' || m[1] === '-' ? -v : v;
}

test('figures appear on their own, the ranking follows them, and the cards say what they are', async ({ page }) => {
  await seed(page);
  await page.goto('/?e2e=1');
  await openCasino(page);

  // Three games listed (the burned casino's is left out); nothing to press.
  await expect(rows(page)).toHaveCount(3);
  await expect(ranked(page)).not.toContainText('Burned Palace');
  await noComputeButtons(page);

  // Worked out one at a time, on their own, then the line goes quiet.
  await expect(rows(page).and(page.locator('[data-state="current"]'))).toHaveCount(3, { timeout: 30_000 });
  await expect(ranked(page).getByTestId('rank-auto')).toHaveAttribute('data-phase', 'idle');
  await expect(ranked(page).getByTestId('rank-auto')).toContainText('on their own, while Casino is open');
  await expect(rows(page).getByTestId('rank-ev')).not.toContainText(['estimating…']);
  // Review S3: a run stopped by the round budget is partial -- marked with its interval in every row.
  await expect(rows(page).getByTestId('partial-badge')).toHaveCount(3);
  // Review N6: a finished run's edge is shown bare (its interval is on the card).
  for (const meta of await rows(page).locator('.cas-rank-meta').allTextContents()) expect(meta).not.toContain('±');
  // Review N7: a touch holds the order still for a moment, then lets it go.
  const list = ranked(page).locator('.cas-rank-list');
  await expect(list).not.toHaveAttribute('data-held', 'true');
  await list.dispatchEvent('pointerdown');
  await expect(list).toHaveAttribute('data-held', 'true');
  await expect(list).not.toHaveAttribute('data-held', 'true', { timeout: 3000 });
  for (const t of await rows(page).getByTestId('partial-badge').allTextContents()) expect(t).toMatch(/^Partial ±\$\d[\d,]*\/h$/);
  await noComputeButtons(page);

  // Sorted by EV per hour, highest first.
  const evs = (await rows(page).getByTestId('rank-ev').allTextContents()).map(money);
  expect(evs).toEqual([...evs].sort((a, b) => b - a));
  // The shuffler machine is a flat bet into the house edge: negative, and no style badge.
  const csmRow = rows(page).and(page.locator('[data-game="g-csm"]'));
  expect(money((await csmRow.getByTestId('rank-ev').textContent())!)).toBeLessThan(0);
  // A countable game names its best style (first: the badges are drawn, so the shuffler's missing one is missing).
  await expect(rows(page).and(page.locator('[data-game="g-good"]')).getByTestId('best-style')).toHaveText(/^(Back-count|Wong out|Play all|Flat)$/);
  await expect(csmRow.getByTestId('warn-badge')).toContainText(['6:5', 'CSM']);
  await expect(csmRow.getByTestId('best-style')).toHaveCount(0);

  // The countable card: every method side by side, the profile named, the best one marked.
  await rows(page).and(page.locator('[data-game="g-good"]')).click();
  const card = page.getByTestId('game-stats');
  await expect(card).toHaveAttribute('data-state', 'current');
  await expect(card).toContainText('Stopped at the test round budget.');
  await expect(card.getByTestId('partial-badge')).toHaveText('Partial');
  // Review B1: a wong-out shows what leaving costs; a method that never leaves shows none.
  const wong = card.getByTestId('gs-method').filter({ hasText: 'wong out at −1' });
  await expect(wong.getByTestId('gs-exits')).toContainText('5 min each');
  await expect(card.getByTestId('gs-method').filter({ hasText: 'Profile ramp, play all' }).getByTestId('gs-exits')).toContainText('—');
  await expect(card.getByTestId('gs-exit-cost')).toContainText('5 min');
  await expect(card).not.toContainText('no cost in time');
  expect(await card.getByTestId('gs-method').count()).toBeGreaterThanOrEqual(6);
  await expect(card.locator('[data-testid="gs-method"][data-best="true"]')).toHaveCount(1);
  await expect(card.getByTestId('gs-profile')).toContainText('Default (6D H17)');
  await expect(card.getByTestId('gs-assumed')).toHaveCount(0);
  // The card's best EV is the ranking's figure for the game.
  const bestEv = money((await card.getByTestId('gs-best-ev').textContent())!);
  await back(page);
  expect(money((await rows(page).and(page.locator('[data-game="g-good"]')).getByTestId('rank-ev').textContent())!)).toBe(bestEv);

  // The shuffler's card: the flat house edge only, its unknown cut marked as assumed.
  await csmRow.click();
  await expect(card).toContainText('Continuous shuffler: not countable');
  await expect(card.getByTestId('gs-method')).toHaveCount(0);
  await expect(card.getByTestId('gs-assumed')).toContainText('cut');
  await back(page);

  // No mid-shoe entry at El Cortez: no back-count method was even worked out.
  await rows(page).and(page.locator('[data-game="g-deep"]')).click();
  // Its methods are drawn first, so the missing one is missing from a list.
  await expect(card.getByTestId('gs-method').first()).toBeVisible();
  await expect(card.getByTestId('gs-method').filter({ hasText: /back-count/i })).toHaveCount(0);

  // The results survive a reload.
  await page.reload();
  await openCasino(page);
  await expect(rows(page).and(page.locator('[data-state="current"]'))).toHaveCount(3);
});

test('Wave T: the editor says which way an unlogged split cap or double-on leans', async ({ page }) => {
  await seed(page);
  await page.goto('/?e2e=1');
  await openCasino(page, 'casinos');
  await editCasino(page, 'El Cortez');
  const editor = page.getByTestId('game-editor').first();
  await expect(editor).toContainText('? = 4, the best case: the figures may be too high.');
  await expect(editor).toContainText('? = any two, the best case: the figures may be too high.');
  await editor.getByRole('group', { name: 'Split to, hands' }).waitFor();
  await shotCard(page, 'editor', [['split-cap', (p) => p.getByTestId('game-editor').first().getByRole('group', { name: 'Split to, hands' })]]);
});

/*
 * Wave M review S4: games logged before the split / double rules existed are
 * simulated at assumed rules, which can decide their place in the ranking, so
 * the row and the card say a rule was assumed, and which. Wave P: the split
 * cap and double-on are assumed at the best case (split to 4, double any two),
 * and the card says that can make the figures too high (Wave T: said plainly).
 */
test('rows and stats cards mark the rules their figures assumed', async ({ page }) => {
  await seed(page);
  await page.goto('/?e2e=1');
  await openCasino(page);
  const goodRow = rows(page).and(page.locator('[data-game="g-good"]'));
  const deepRow = rows(page).and(page.locator('[data-game="g-deep"]'));
  await expect(deepRow.getByTestId('assumed-badge')).toHaveText('4 rules assumed');
  // The badge's tooltip names them, the best-case ones marked.
  await expect(deepRow.getByTestId('assumed-badge')).toHaveAttribute(
    'title',
    'no resplitting aces; no doubling split aces; split to 4 hands (best case); double on any two cards (best case)',
  );
  await expect(goodRow.getByTestId('assumed-badge')).toHaveCount(0);
  // The shuffler's unknown cut is assumed too, but it is not a rule: still 4.
  await expect(rows(page).and(page.locator('[data-game="g-csm"]')).getByTestId('assumed-badge')).toHaveText('4 rules assumed');

  await deepRow.click();
  const head = page.getByTestId('gs-assumed-rules');
  await expect(head).toBeVisible();
  for (const t of ['no resplitting aces', 'no doubling split aces', 'split to 4 hands (best case)', 'double on any two cards (best case)']) await expect(head).toContainText(t);
  await expect(head).toContainText('Not logged, so guessed at the worse choice except where marked best case: a wrong best-case guess makes every figure here too high.');
  await expect(page.getByTestId('gs-assumed')).toContainText('(not logged, so guessed at the worse choice except where marked best case): no resplitting aces; no doubling split aces; split to 4 hands (best case)');
  await shotCard(page, 'stats-card-assumed');
  // The cut is logged here and the min bet is never a rule: neither is in the marker.
  await expect(head).not.toContainText('cut');
  await expect(head).not.toContainText('min bet');
  await back(page);
  await goodRow.click();
  await expect(page.getByTestId('game-stats')).toBeVisible();
  await expect(page.getByTestId('gs-assumed-rules')).toHaveCount(0);
});

/*
 * Merge of Wave L and Wave M: a row flags only the assumptions that can move
 * the edge by 0.05% of action or more; the card still lists every one. A
 * variant game is never simulated, so its row flags none.
 */
test('rows flag only material assumptions; the card lists all; a variant row flags none', async ({ page }) => {
  // Every rule logged except doubling split aces (0.08%, material where it can happen).
  const dsaOnly = { ...good, id: 'g-dsa', doubleSplitAces: undefined };
  // The same with no double after a split logged: split aces can never double, so it is moot.
  const moot = { ...dsaOnly, id: 'g-moot', das: false };
  const variant = { id: 'g-var', decks: null, s17: null, das: null, surrender: null, payout: null, cutDecksLeft: null, minBet: 25, maxBet: null, midShoeEntry: 'unknown', csm: false, variant: 'freebet' };
  const log = { ...LOG, casinos: [{ ...base, id: 'c1', name: 'Pala', games: [dsaOnly, moot, variant] }] };
  await page.addInitScript(
    ([k, l]) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(k as string, l as string);
        sessionStorage.setItem('seeded', '1');
      }
    },
    [KEY, JSON.stringify(log)],
  );
  await page.goto('/?e2e=1');
  await openCasino(page);
  const row = (id: string) => rows(page).and(page.locator(`[data-game="${id}"]`));
  await expect(row('g-dsa').getByTestId('assumed-badge')).toHaveText('1 rule assumed');
  await expect(row('g-dsa').getByTestId('assumed-badge')).toHaveAttribute('title', 'no doubling split aces');
  await expect(row('g-moot').getByTestId('assumed-badge')).toHaveCount(0);
  await expect(row('g-var').getByTestId('rank-ev')).toHaveText('not modelled');
  await expect(row('g-var').getByTestId('assumed-badge')).toHaveCount(0);

  await row('g-moot').click();
  await expect(page.getByTestId('gs-assumed-rules')).toContainText('no doubling split aces');
  await back(page);
  await row('g-var').click();
  await expect(page.getByTestId('game-stats')).toHaveAttribute('data-state', 'variant');
  await expect(page.getByTestId('gs-assumed-rules')).toHaveCount(0);
});

/*
 * Merge of Wave L side bets and Wave M: a game with nothing logged reads
 * "Game not logged" -- every rule is a guess, so its row does not single out
 * "N rules assumed" as if the rest were known.
 */
test('a game with nothing logged reads "Game not logged" and flags no assumed rules', async ({ page }) => {
  const blank = { id: 'g-blank', decks: null, s17: null, das: null, surrender: null, payout: null, cutDecksLeft: null, minBet: null, maxBet: null, midShoeEntry: 'unknown', csm: false };
  const dsaOnly = { ...good, id: 'g-dsa', doubleSplitAces: undefined };
  const log = { ...LOG, casinos: [{ ...base, id: 'c1', name: 'Pala', games: [blank, dsaOnly] }] };
  await page.addInitScript(
    ([k, l]) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(k as string, l as string);
        sessionStorage.setItem('seeded', '1');
      }
    },
    [KEY, JSON.stringify(log)],
  );
  await page.goto('/?e2e=1');
  await openCasino(page);
  const row = (id: string) => rows(page).and(page.locator(`[data-game="${id}"]`));
  await expect(row('g-blank')).toContainText('Game not logged');
  await expect(row('g-blank').getByTestId('assumed-badge')).toHaveCount(0);
  // The badge itself still works on a logged game beside it.
  await expect(row('g-dsa').getByTestId('assumed-badge')).toHaveText('1 rule assumed');
});

test('editing a rule: the old figures are marked Updating, and the new ones land without pressing anything', async ({ page }) => {
  await seed(page);
  await page.goto('/?e2e=1');
  await openCasino(page);
  const goodRow = rows(page).and(page.locator('[data-game="g-good"]'));
  await expect(rows(page).and(page.locator('[data-state="current"]'))).toHaveCount(3, { timeout: 30_000 });
  const before = (await stored(page, 'g-good'))!.key;

  // Hidden, nothing runs, so the in-between state holds still to be read.
  await setHidden(page, true);
  // Open Golden Nugget, two games in its editor; switch the first to S17.
  await editCasino(page, 'Golden Nugget');
  const editors = page.getByTestId('game-editor');
  await expect(editors).toHaveCount(2);
  await editors.nth(0).getByRole('group', { name: 'Dealer soft 17' }).getByRole('button', { name: 'Stands (S17)' }).click();
  await saveToRanked(page);

  // The old figures still shown, marked as on their way out; the line says it is waiting to run.
  await expect(goodRow).toHaveAttribute('data-state', 'stale');
  await expect(goodRow.getByTestId('stale-badge')).toHaveText('Updating');
  await expect(goodRow).toContainText('S17');
  await expect(ranked(page).getByTestId('rank-auto')).toHaveAttribute('data-phase', 'estimating');
  await expect(ranked(page).getByTestId('rank-auto')).toContainText('Making 1 estimate');
  // Held for longer than a run at this budget takes: still nothing, as the page is hidden.
  await page.waitForTimeout(1500);
  expect((await stored(page, 'g-good'))!.key).toBe(before);
  await goodRow.click();
  const card = page.getByTestId('game-stats');
  await expect(card).toHaveAttribute('data-state', 'stale');
  await expect(card.getByTestId('stale-note')).toContainText('Updating');
  await expect(card.getByTestId('gs-hero')).toHaveAttribute('data-stale', 'true');
  await noComputeButtons(page);

  // Shown again: the new figures land on their own.
  await setHidden(page, false);
  await expect(card).toHaveAttribute('data-state', 'current', { timeout: 20_000 });
  const after = (await stored(page, 'g-good'))!.key;
  expect(after).not.toBe(before);
  await back(page);
  await expect(goodRow).toHaveAttribute('data-state', 'current');
  await expect(goodRow.getByTestId('stale-badge')).toHaveCount(0);

  // Rounds per hour is applied when shown, not simulated: changing it keeps the result current.
  await editCasino(page, 'Golden Nugget');
  await page.locator('input[name="roundsPerHour-0"]').fill('120');
  await saveToRanked(page);
  await expect(goodRow).toHaveAttribute('data-state', 'current');
});

test('the minutes an exit costs are a setting, applied to the stored result without a re-run', async ({ page }) => {
  await seed(page, 20_000);
  await page.goto('/?e2e=1');
  await openCasino(page);
  const goodRow = rows(page).and(page.locator('[data-game="g-good"]'));
  await goodRow.click();
  const card = page.getByTestId('game-stats');
  await expect(card).toHaveAttribute('data-state', 'current', { timeout: 20_000 });
  const wongEv = async () =>
    money((await card.getByTestId('gs-method').filter({ hasText: 'wong out at −1' }).locator('.cas-gs-fig').first().locator('dd').textContent())!);
  const exitsPerHour = async () =>
    Number((await card.getByTestId('gs-method').filter({ hasText: 'wong out at −1' }).getByTestId('gs-exits').locator('dd').textContent())!.match(/^[\d.]+/)![0]);
  const at5 = await wongEv();
  const exits5 = await exitsPerHour();
  expect(exits5).toBeGreaterThan(0);

  // Leaving made free, then made slow: the same stored rounds, charged differently.
  // The same net over less (more) time: EV/h grows (shrinks) in size, whichever its sign.
  await back(page);
  await ranked(page).getByRole('button', { name: 'Settings' }).click();
  await page.locator('input[name="exitFindMinutes"]').fill('0');
  await page.getByTestId('save-exit-minutes').click();
  await expect(page.getByRole('status').filter({ hasText: '0 min to find a table' })).toBeVisible();
  await back(page);
  await goodRow.click();
  await expect(card).toHaveAttribute('data-state', 'current');
  const at0 = await wongEv();
  expect(at5).not.toBe(0);
  expect(Math.abs(at0)).toBeGreaterThan(Math.abs(at5));
  expect(await exitsPerHour()).toBeGreaterThan(exits5);
  await expect(card.getByTestId('gs-exit-cost')).toContainText('0 min');

  await back(page);
  await ranked(page).getByRole('button', { name: 'Settings' }).click();
  await page.locator('input[name="exitFindMinutes"]').fill('30');
  await page.getByTestId('save-exit-minutes').click();
  await back(page);
  await goodRow.click();
  await expect(card).toHaveAttribute('data-state', 'current');
  expect(Math.abs(await wongEv())).toBeLessThan(Math.abs(at5));
});

test('custom methods can be edited, and a duplicate of a default says so', async ({ page }) => {
  await seed(page);
  await page.goto('/?e2e=1');
  await openCasino(page);
  await ranked(page).getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByTestId('casino-settings');
  // Wong out at -1 is a default already.
  await settings.getByRole('group', { name: 'Leave' }).getByRole('button', { name: 'Wong out' }).click();
  await settings.locator('select[name="exitTc"]').selectOption('-1');
  await settings.getByTestId('add-method').click();
  await expect(settings.getByTestId('method-message')).toContainText('plays exactly like');
  await expect(settings.getByTestId('custom-duplicate')).toContainText('Profile ramp, wong out at −1');
  // Edit it into its own method: leave at -4.
  await settings.getByRole('button', { name: /^Edit / }).click();
  await expect(settings.locator('select[name="exitTc"]')).toHaveValue('-1');
  await settings.locator('select[name="exitTc"]').selectOption('-4');
  await settings.getByTestId('save-method').click();
  await expect(settings.getByTestId('custom-method')).toHaveCount(1);
  await expect(settings.getByTestId('custom-method')).toContainText('wong out at −4');
  await expect(settings.getByTestId('custom-duplicate')).toHaveCount(0);
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).settings.methods, KEY);
  expect(stored).toHaveLength(1);
  expect(stored[0].exitTc).toBe(-4);
});

test('review S4: renaming a custom method keeps every figure; the card shows the new name', async ({ page }) => {
  await seed(page);
  await page.goto('/?e2e=1');
  await openCasino(page);
  await ranked(page).getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByTestId('casino-settings');
  await settings.getByRole('group', { name: 'Leave' }).getByRole('button', { name: 'Wong out' }).click();
  await settings.locator('select[name="exitTc"]').selectOption('-4');
  await settings.locator('input[name="methodLabel"]').fill('Leave at -4');
  await settings.getByTestId('add-method').click();
  await back(page);
  await expect(rows(page).and(page.locator('[data-state="current"]'))).toHaveCount(3, { timeout: 30_000 });
  const keys = () => page.evaluate((k) => Object.values(JSON.parse(localStorage.getItem(k)!).results as Record<string, { key: string; computedAt: string }>).map((r) => r.key + r.computedAt).sort(), STATS_KEY);
  const before = await keys();

  await setHidden(page, true);
  await ranked(page).getByRole('button', { name: 'Settings' }).click();
  await settings.getByRole('button', { name: /^Edit / }).click();
  await settings.locator('input[name="methodLabel"]').fill('My exit');
  await settings.getByTestId('save-method').click();
  await expect(settings.getByTestId('method-message')).toHaveText('Saved. Only its name changed, so the figures stand.');
  await back(page);
  // Nothing went stale, and nothing is waiting to run.
  await expect(rows(page).and(page.locator('[data-state="current"]'))).toHaveCount(3);
  await expect(rows(page).getByTestId('stale-badge')).toHaveCount(0);
  await expect(ranked(page).getByTestId('rank-auto')).toHaveAttribute('data-phase', 'idle');
  await setHidden(page, false);
  await page.waitForTimeout(1000);
  expect(await keys()).toEqual(before);
  await rows(page).and(page.locator('[data-game="g-good"]')).click();
  await expect(page.getByTestId('game-stats')).toContainText('My exit');
  await expect(page.getByTestId('game-stats')).not.toContainText('Leave at -4');
});

/** "1.2M rounds" / "850k rounds" / "4,000 rounds" -> a number (to the precision shown). */
function roundsOf(text: string): number {
  const m = /([\d.,]+)(M|k)? rounds/.exec(text);
  if (!m) throw new Error(`no rounds in "${text}"`);
  return Number(m[1]!.replace(/,/g, '')) * (m[2] === 'M' ? 1e6 : m[2] === 'k' ? 1e3 : 1);
}

test('a long run shows its progress live, stops while the page is hidden, and picks up where it left off', async ({ page }) => {
  // A budget big enough to still be running when we look.
  await seed(page, 30_000_000);
  await page.goto('/?e2e=1');
  await openCasino(page);
  await rows(page).and(page.locator('[data-game="g-good"]')).click();
  const card = page.getByTestId('game-stats');
  // The open card's game goes first: running, live, with nothing pressed.
  await expect(card).toHaveAttribute('data-state', 'running');
  await expect(card.getByTestId('sim-running')).toContainText('rounds', { timeout: 10_000 });
  await expect(card.getByRole('progressbar')).toBeVisible();
  // The first estimate lands, then it keeps firming up.
  await expect(card.getByTestId('sim-running')).toContainText('Firming up', { timeout: 20_000 });
  expect((await stored(page, 'g-good'))!.status).toBe('partial');

  await setHidden(page, true);
  await expect(card).not.toHaveAttribute('data-state', 'running');
  await expect(card.getByTestId('sim-running')).toHaveCount(0);
  await expect(card.getByTestId('estimate-badge')).toHaveText('Estimate');
  // What it had was kept...
  const paused = (await stored(page, 'g-good'))!;
  expect(paused.status).toBe('partial');
  expect(paused.basicRounds).toBeGreaterThan(200_000);
  // ...and nothing more runs while hidden (watched for longer than many chunks and a checkpoint's paint).
  await page.waitForTimeout(2000);
  const still = (await stored(page, 'g-good'))!;
  expect([still.basicRounds, still.countRounds]).toEqual([paused.basicRounds, paused.countRounds]);
  await expect(card).not.toHaveAttribute('data-state', 'running');

  // Shown again: it carries on from those rounds, not from zero.
  await setHidden(page, false);
  await expect(card).toHaveAttribute('data-state', 'running');
  await expect(card.getByTestId('sim-running')).toContainText('rounds');
  const live = roundsOf((await card.getByTestId('sim-running').textContent())!);
  expect(live).toBeGreaterThanOrEqual(Math.floor((paused.basicRounds + paused.countRounds) / 1e5) * 1e5);
});

test("review B1: storage full -- the figures show, the ranking says they couldn't be saved, and nothing runs again", async ({ page }) => {
  await seed(page);
  await page.addInitScript((k) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === k) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  }, STATS_KEY);
  await page.goto('/?e2e=1');
  await openCasino(page);
  await expect(rows(page).and(page.locator('[data-state="current"]'))).toHaveCount(3, { timeout: 30_000 });
  await expect(ranked(page).getByTestId('rank-storage-full')).toHaveText('Couldn’t save figures — storage full');
  await expect(ranked(page).getByTestId('rank-auto')).toHaveAttribute('data-phase', 'idle');
  // Held well past a run at this budget: still nothing running, nothing stored.
  await page.waitForTimeout(1500);
  await expect(rows(page).and(page.locator('[data-running="true"]'))).toHaveCount(0);
  await expect(ranked(page).getByTestId('rank-auto')).toHaveAttribute('data-phase', 'idle');
  expect(await page.evaluate((k) => localStorage.getItem(k), STATS_KEY)).toBeNull();
});

test('review S2: a simulator that fails says so on the line, the row and the card, and leaves nothing pending', async ({ page }) => {
  await seed(page);
  await page.route(/casinoSim\.worker/, (route) =>
    route.fulfill({ contentType: 'text/javascript', body: "self.onmessage = () => self.postMessage({ type: 'error', message: 'test failure' });" }),
  );
  await page.goto('/?e2e=1');
  await openCasino(page);
  await expect(rows(page).getByTestId('rank-ev')).toHaveText(['not worked out', 'not worked out', 'not worked out']);
  await expect(rows(page).getByTestId('rank-failed')).toHaveText(Array(3).fill('The simulator failed: test failure'));
  await expect(ranked(page).getByTestId('rank-auto')).toHaveAttribute('data-phase', 'error');
  await expect(ranked(page).getByTestId('rank-failed-line')).toHaveText('The simulator failed on 3 games: test failure');
  await expect(ranked(page).getByTestId('rank-auto')).not.toContainText('Making');
  for (const sel of ['.cas-rank-failed', '[data-testid="rank-failed-line"]']) expect(await worstContrast(page, sel), sel).toBeGreaterThanOrEqual(4.5);
  await rows(page).and(page.locator('[data-game="g-good"]')).click();
  await expect(page.getByTestId('gs-failed')).toContainText('The simulator failed on this game: test failure');
  await expect(page.getByTestId('gs-waiting')).toHaveCount(0);
});

test('a casino session running: every game gets its estimate, the open card firms up, and the rest waits for the session', async ({ page }) => {
  const started = new Date(Date.now() - 30 * 60_000).toISOString();
  const session = { id: 's1', casinoId: 'c1', start: started, end: null, buyIns: [500], cashOut: null, avgBet: null, maxBet: null, maxTc: null, heat: 'none', notes: '', createdAt: started, updatedAt: started };
  // A budget big enough that a refine would show in the stored rounds.
  await seed(page, 30_000_000, { ...LOG, sessions: [session] });
  await page.goto('/?e2e=1');
  // Wave W: a running session opens on Sessions; the ranking is a tap away.
  await page.locator('.tab-bar').getByRole('button', { name: 'Casino', exact: true }).click();
  await expect(page.getByTestId('casino-seg-sessions')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('casino-live')).toBeVisible();
  await seg(page, 'ranked');
  await expect(rows(page).and(page.locator('[data-state="current"]'))).toHaveCount(3, { timeout: 30_000 });
  await expect(rows(page).getByTestId('estimate-badge')).toHaveCount(3);
  // Review N6: an estimate names no best method, and its edge carries its interval.
  await expect(rows(page).getByTestId('best-style')).toHaveCount(0);
  for (const meta of await rows(page).locator('.cas-rank-meta').allTextContents()) expect(meta).toMatch(/^edge −?\d+\.\d\d% ±\d+\.\d\d%/);
  await expect(ranked(page).getByTestId('rank-auto')).toHaveAttribute('data-phase', 'held');
  await expect(ranked(page).getByTestId('rank-held')).toHaveText('3 estimates firm up after this session');
  const games = ['g-good', 'g-csm', 'g-deep'];
  const rounds = async () => Promise.all(games.map(async (g) => (await stored(page, g))!.basicRounds));
  const at = await rounds();
  expect(at[0]).toBe(200_000);
  // Held for longer than a refine's first chunks and its first paint: no rounds added to any game.
  await page.waitForTimeout(2000);
  expect(await rounds()).toEqual(at);
  // Re-review ruling: the game he opens at the table is firmed up all the same.
  await rows(page).and(page.locator('[data-game="g-good"]')).click();
  const card = page.getByTestId('game-stats');
  await expect(card).toHaveAttribute('data-state', 'running');
  await expect(card.getByTestId('sim-running')).toContainText(/^Firming up… .* rounds$/, { timeout: 10_000 });
  await expect(card).not.toContainText('after this session');
  // Closed, it stops keeping what it dealt; the others were never touched.
  await back(page);
  await expect.poll(async () => (await stored(page, 'g-good'))!.basicRounds).toBeGreaterThan(200_000);
  expect((await rounds()).slice(1)).toEqual(at.slice(1));
  await expect(ranked(page).getByTestId('rank-auto')).toHaveAttribute('data-phase', 'held');
});

test('re-review R4: a session left open with nothing logged for 12 h holds nothing', async ({ page }) => {
  const started = new Date(Date.now() - 13 * 3600_000).toISOString();
  const session = { id: 's1', casinoId: 'c1', start: started, end: null, buyIns: [500], cashOut: null, avgBet: null, maxBet: null, maxTc: null, heat: 'none', notes: '', createdAt: started, updatedAt: started };
  await seed(page, 30_000_000, { ...LOG, sessions: [session] });
  await page.goto('/?e2e=1');
  // Wave W: a running session opens on Sessions; the ranking is a tap away.
  await page.locator('.tab-bar').getByRole('button', { name: 'Casino', exact: true }).click();
  await expect(page.getByTestId('casino-seg-sessions')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('casino-live')).toBeVisible();
  await seg(page, 'ranked');
  await expect(rows(page).and(page.locator('[data-state="current"]'))).toHaveCount(3, { timeout: 30_000 });
  await expect(ranked(page).getByTestId('rank-auto')).toHaveAttribute('data-phase', 'refining');
  await expect(ranked(page).getByTestId('rank-held')).toHaveCount(0);
});

test('an import: every game gets its figures on its own, and two games dealt alike are worked out once', async ({ page }) => {
  await page.addInitScript((b) => {
    (window as unknown as { __bjCasinoSimBudget: number }).__bjCasinoSimBudget = b;
  }, 4000);
  await page.goto('/?e2e=1');
  await openCasino(page);
  const file = {
    app: 'blackjack-trainer',
    version: 2,
    exportedAt: AT,
    casinos: [
      { ...base, id: 'i1', name: 'Pala', games: [{ ...good, id: 'i-g1' }, { ...deep, id: 'i-g2' }] },
      // Dealt exactly like Pala's first game: one run serves both.
      { ...base, id: 'i2', name: 'Pauma', games: [{ ...good, id: 'i-g3' }] },
      { ...base, id: 'i3', name: 'Viejas', games: [{ ...csm, id: 'i-g4' }, { id: 'i-gv', decks: 6, s17: false, das: null, surrender: null, payout: '3:2', cutDecksLeft: null, minBet: 25, maxBet: null, midShoeEntry: 'unknown', csm: false, variant: 'freebet' }] },
    ],
    sessions: [],
    settings: { startingBankroll: null, updatedAt: null },
  };
  await seg(page, 'casinos');
  await page.getByTestId('casino-import-file').setInputFiles({ name: 'casino.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toBeVisible();
  await seg(page, 'ranked');
  await expect(rows(page)).toHaveCount(5);
  await noComputeButtons(page);
  // Every standard game ends with its figures; the variant is not modelled.
  await expect(rows(page).and(page.locator('[data-state="current"]'))).toHaveCount(4, { timeout: 30_000 });
  await expect(rows(page).and(page.locator('[data-game="i-gv"]')).getByTestId('rank-ev')).toHaveText('not modelled');
  for (const ev of await rows(page).and(page.locator(':not([data-game="i-gv"])')).getByTestId('rank-ev').allTextContents()) expect(ev).toMatch(/\$\d/);
  await expect(ranked(page).getByTestId('rank-auto')).toHaveAttribute('data-phase', 'idle');
  // Three distinct games, three runs: the twins share one stored result.
  const keys = await page.evaluate((k) => Object.values(JSON.parse(localStorage.getItem(k)!).results as Record<string, { key: string }>).map((r) => r.key), STATS_KEY);
  expect(keys).toHaveLength(3);
  expect(new Set(keys).size).toBe(3);
});

test.describe('distance', () => {
  test.use({ geolocation: { latitude: 36.1, longitude: -115.17 }, permissions: ['geolocation'] });

  test('live miles once "Use my location" is on, drive minutes otherwise; sort by distance', async ({ page }) => {
    await seed(page);
    await page.goto('/?e2e=1');
    await openCasino(page);
    const nugget = rows(page).and(page.locator('[data-game="g-good"]'));
    const cortez = rows(page).and(page.locator('[data-game="g-deep"]'));
    await expect(nugget).toContainText('20 min drive');
    await seg(page, 'casinos');
    await expect(page.getByTestId('casino-row').filter({ hasText: 'El Cortez' })).toContainText('1 h 30 min drive');
    await seg(page, 'ranked');

    // Review N1: turning it on says the position is read each time Casino opens.
    await expect(ranked(page).getByTestId('use-location-hint')).toContainText('each time you open Casino');
    await ranked(page).getByTestId('use-location').check();
    await expect(nugget).toContainText('0.7 mi');
    await seg(page, 'casinos');
    await expect(page.getByTestId('casino-row').filter({ hasText: 'Golden Nugget' })).toContainText('0.7 mi');
    // And on the casino's own page.
    await page.getByTestId('casino-row').filter({ hasText: 'Golden Nugget' }).click();
    await expect(page.getByTestId('casino-detail-meta')).toContainText('0.7 mi');
    await back(page);
    await seg(page, 'ranked');
    // No saved spot at El Cortez: still its drive time.
    await expect(cortez).toContainText('1 h 30 min drive');

    await ranked(page).getByRole('group', { name: 'Sort games by' }).getByRole('button', { name: 'Distance' }).click();
    await expect(rows(page).first()).toHaveAttribute('data-game', /^g-(good|csm)$/);
    const order = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-game')));
    expect(order.slice(0, 2).sort()).toEqual(['g-csm', 'g-good']);
    expect(order[2]).toBe('g-deep');

    // The choice is remembered on this device.
    await page.reload();
    await openCasino(page);
    await expect(ranked(page).getByTestId('use-location')).toBeChecked();
    await expect(nugget).toContainText('0.7 mi');
  });

  test('"Save this spot" stores where you are; Clear forgets it', async ({ page }) => {
    await seed(page);
    await page.goto('/?e2e=1');
    await openCasino(page, 'casinos');
    await editCasino(page, 'El Cortez');
    await page.getByTestId('save-spot').click();
    await expect(page.getByTestId('spot-saved')).toBeVisible();
    await page.getByRole('button', { name: 'Save casino' }).click();
    const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).casinos[1].location, KEY);
    expect(saved).toEqual({ lat: 36.1, lon: -115.17 });

    // Saving went back to the casino's page.
    await page.getByRole('button', { name: 'Edit casino', exact: true }).click();
    await page.getByTestId('casino-spot').getByRole('button', { name: 'Clear' }).click();
    await page.getByRole('button', { name: 'Save casino' }).click();
    expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).casinos[1].location ?? null, KEY)).toBeNull();
  });
});

test('casino notes save as you type, survive a reload, and head the casino row', async ({ page }) => {
  await seed(page);
  await page.goto('/?e2e=1');
  await openCasino(page, 'casinos');
  await page.getByTestId('casino-row').filter({ hasText: 'El Cortez' }).click();
  const box = page.locator('textarea[name="casinoNotes"]');
  await box.click();
  await box.pressSequentially('Swing shift 2am, pit boss Ray watches\nComps at the cage', { delay: 5 });
  // Saved on the short debounce while still focused, without the text jumping.
  await expect(page.getByTestId('notes-status')).toHaveText('Saved', { timeout: 5000 });
  await expect(box).toBeFocused();
  await expect(box).toHaveValue('Swing shift 2am, pit boss Ray watches\nComps at the cage');
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).casinos[1], KEY);
  expect(stored.notes).toBe('Swing shift 2am, pit boss Ray watches\nComps at the cage');
  expect(stored.updatedAt).not.toBe(AT);

  await page.reload();
  await openCasino(page, 'casinos');
  await expect(page.getByTestId('casino-row').filter({ hasText: 'El Cortez' }).getByTestId('casino-row-note')).toHaveText(
    'Swing shift 2am, pit boss Ray watches',
  );
});

test('review S5: tapping into the notes and out again without typing keeps what another tab saved', async ({ context }) => {
  // Seeded once per context (a second tab has its own sessionStorage, so `seed` would re-seed).
  await context.addInitScript(
    ([k, log]) => {
      if (!localStorage.getItem(k as string)) localStorage.setItem(k as string, log as string);
    },
    [KEY, JSON.stringify(LOG)],
  );
  const a = await context.newPage();
  await a.goto('/?e2e=1');
  await openCasino(a, 'casinos');
  await a.getByTestId('casino-row').filter({ hasText: 'El Cortez' }).click();
  const boxA = a.locator('textarea[name="casinoNotes"]');
  await boxA.click();
  await expect(boxA).toBeFocused();

  const b = await context.newPage();
  await b.goto('/?e2e=1');
  await openCasino(b, 'casinos');
  await b.getByTestId('casino-row').filter({ hasText: 'El Cortez' }).click();
  const boxB = b.locator('textarea[name="casinoNotes"]');
  await boxB.fill('Written in tab B');
  await boxB.blur();
  await expect(b.getByTestId('notes-status')).toHaveText('Saved');

  // Tab A, focused all along, is left alone under the cursor...
  await expect(boxA).toHaveValue('');
  // ...and leaving it without a keystroke takes B's text instead of writing '' back.
  await boxA.blur();
  await expect(boxA).toHaveValue('Written in tab B');
  const notes = await a.evaluate((k) => JSON.parse(localStorage.getItem(k)!).casinos[1].notes, KEY);
  expect(notes).toBe('Written in tab B');
});

test('review S6: typing is saved when the page is hidden or closed, before the pause in typing', async ({ page }) => {
  await seed(page);
  await page.clock.install();
  await page.goto('/?e2e=1');
  await openCasino(page, 'casinos');
  await page.getByTestId('casino-row').filter({ hasText: 'El Cortez' }).click();
  // Paused: the 700 ms save-after-a-pause can never fire, so only the page events can save.
  await page.clock.pauseAt(new Date(Date.now() + 3_600_000));
  const box = page.locator('textarea[name="casinoNotes"]');
  const storedNotes = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{"casinos":[{},{"notes":""}]}').casinos[1].notes ?? '', KEY);
  await box.click();
  await box.pressSequentially('Pit 3');
  await expect(page.getByTestId('notes-status')).toHaveText('Saving…');
  expect(await storedNotes()).toBe('');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await storedNotes()).toBe('Pit 3');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
  await box.pressSequentially(' closes at 2');
  expect(await storedNotes()).toBe('Pit 3');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect(await storedNotes()).toBe('Pit 3 closes at 2');
  await expect(box).toBeFocused();
});

test('review N9: a notes save that does not land says "Not saved"', async ({ page }) => {
  await seed(page);
  await page.goto('/?e2e=1');
  await openCasino(page, 'casinos');
  await page.getByTestId('casino-row').filter({ hasText: 'El Cortez' }).click();
  await page.evaluate((k) => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === k) throw new DOMException('full', 'QuotaExceededError');
      return orig.call(this, key, value);
    };
  }, KEY);
  const box = page.locator('textarea[name="casinoNotes"]');
  await box.fill('This will not fit');
  await box.blur();
  await expect(page.getByTestId('notes-status')).toHaveText('Not saved');
});

for (const theme of ['midnight-felt', 'bone-ink'] as const) {
  test(`the ranking and the stats card reach 4.5:1 in ${theme}, and fit at 320`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await withSettings(page, { theme });
    await seed(page);
    await page.goto('/?e2e=1');
    await openCasino(page);
    await expect(rows(page).and(page.locator('[data-state="current"]'))).toHaveCount(3, { timeout: 30_000 });
    const bad: string[] = [];
    const check = async (sels: string[]) => {
      for (const sel of sels) {
        const ratio = await worstContrast(page, sel);
        if (ratio < 4.5) bad.push(`${sel} ${ratio.toFixed(2)}`);
      }
    };
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await check(['.cas-rank-row:not([data-greyed]) .cas-rank-meta', '.cas-rank-place', '.cas-rank-row [data-testid="best-style"]', '.cas-rank-controls .cas-note', '.cas-rank-row:not([data-greyed]) [data-testid="assumed-badge"]', '.cas-auto p', '.cas-rank-row [data-testid="partial-badge"]']);
    expect(await fits()).toBeLessThanOrEqual(0);
    // Wave W: the directory, and a casino's page with its rules.
    await seg(page, 'casinos');
    await check(['.cas-row-note', '.cas-row-meta', '.cas-dir-game .cas-row-game', '.cas-dir-extras', '.cas-dir-controls .cas-note', '.cas-group-title']);
    expect(await fits()).toBeLessThanOrEqual(0);
    await page.getByTestId('casino-row').filter({ hasText: 'Golden Nugget' }).click();
    await expect(page.getByTestId('detail-figures').first()).not.toHaveText('Figures being worked out…');
    await check(['.cas-detail-meta', '.cas-rule dt', '.cas-rule dd', '.cas-rule[data-unknown] dd', '.cas-dir-figures-text', '.cas-dir-sub-title', '.cas-dir-card .cas-note']);
    expect(await fits()).toBeLessThanOrEqual(0);
    await back(page);
    await seg(page, 'ranked');
    await rows(page).and(page.locator('[data-game="g-good"]')).click();
    await check(['.cas-gs-sub', '.cas-gs-fig dt', '.cas-gs-fig-sub', '.cas-gs-fig dd[data-sign="1"]', '.cas-gs-fig dd[data-sign="-1"]', '.cas-gs-notes', '.cas-gs-state', '.cas-gs-state [data-testid="partial-badge"]']);
    expect(await fits()).toBeLessThanOrEqual(0);
    await back(page);
    await rows(page).and(page.locator('[data-game="g-deep"]')).click();
    await expect(page.getByTestId('gs-assumed-rules')).toBeVisible();
    await check(['.cas-gs-assumed-rules', '.cas-gs-assumed-rules .cas-badge']);
    expect(await fits()).toBeLessThanOrEqual(0);
    expect(bad, `low contrast in ${theme}`).toEqual([]);
  });
}
