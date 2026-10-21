import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { readStoredDiagnostics, withSettings } from './helpers';
import { worstContrast } from './contrast';

/**
 * Wave J (lane C): the Casino tab, the real-play notebook.
 *
 * One long walk through a real evening -- add a casino, start a session, buy
 * in twice, reload mid-session, get backed off and burn the casino -- then the
 * figures it leaves behind, and the backup round trip into a wiped store. Time
 * is the page's fake clock throughout, so "an hour and a half later" costs
 * nothing and the elapsed clock is exact.
 */

test.use({ viewport: { width: 375, height: 812 } });

/** Wave K (review S2): the log's own key; the v1 key is only read, as the migration source. */
const KEY = 'bjtrainer.casinoLog.v2';
const LEGACY_KEY = 'bjtrainer.casinoLog.v1';
/** 7pm local on 18 Oct 2026: a back-off today cools off until 18 Apr 2027. */
const T0 = new Date(2026, 9, 18, 19, 0, 0).getTime();

const openCasino = (page: Page) => page.locator('.tab-bar').getByRole('button', { name: 'Casino', exact: true }).click();
const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), KEY);

/** The live card's clock as seconds. */
async function elapsedSeconds(page: Page): Promise<number> {
  const text = (await page.getByTestId('casino-elapsed').textContent()) ?? '';
  const [h, m, s] = text.split(':').map(Number) as [number, number, number];
  return h * 3600 + m * 60 + s;
}

/**
 * Review N6: with the clock paused, React's own timers (the Suspense reveal of
 * a lazy screen) are held too. Step the fake clock 100 ms at a time until
 * `target` shows, and return the fake milliseconds that cost, so the caller
 * can account for them.
 */
async function stepUntilVisible(page: Page, target: ReturnType<Page['getByTestId']>): Promise<number> {
  let spent = 0;
  while (!(await target.isVisible())) {
    if (spent >= 3000) break;
    await page.clock.runFor(100);
    spent += 100;
  }
  await expect(target).toBeVisible();
  return spent;
}

/** No Web Share with files: the export falls back to a download. */
const noFileShare = (page: Page) =>
  page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });

test('a real session: casino, buy-ins, reload, back-off, burn, figures, and the backup round trip', async ({ page }) => {
  await page.clock.install({ time: T0 });
  await noFileShare(page);
  await page.goto('/?e2e=1');
  await openCasino(page);
  await expect(page.getByRole('heading', { name: 'Your real-play notebook' })).toBeVisible();
  // Review N6: from here the clock is paused, so real time cannot leak into
  // the session's length: only the fast-forwards and runFor below move it.
  await page.clock.pauseAt(T0 + 60_000);

  // --- Add a casino, with what a first visit learns.
  await page.getByRole('button', { name: 'Add a casino' }).click();
  await page.locator('input[name="name"]').fill('Golden Nugget');
  await page.locator('input[name="area"]').fill('Downtown');
  await page.getByRole('group', { name: 'Decks' }).getByRole('button', { name: '6' }).click();
  await page.getByRole('button', { name: 'Hits (H17)' }).click();
  await page.getByRole('group', { name: 'Double after split' }).getByRole('button', { name: 'Yes' }).click();
  await page.getByRole('group', { name: 'Late surrender' }).getByRole('button', { name: 'Yes' }).click();
  await page.getByRole('group', { name: 'Blackjack pays' }).getByRole('button', { name: '3:2' }).click();
  await page.locator('input[name="cutDecksLeft-0"]').fill('1.5');
  await page.getByRole('button', { name: 'Save casino' }).click();
  const row = page.getByTestId('casino-row').filter({ hasText: 'Golden Nugget' });
  await expect(row).toContainText('Downtown · never visited');
  await expect(row).toContainText('6D H17 DAS LS 3:2 · cut 1.5');

  // --- Start a session there; the card asks for the buy-in at once.
  await page.getByRole('button', { name: 'Start session' }).click();
  await page.getByTestId('start-at').filter({ hasText: 'Golden Nugget' }).click();
  const live = page.getByTestId('casino-live');
  await expect(live).toContainText('Golden Nugget');
  await expect(live.getByTestId('casino-buyin-total')).toHaveText('No buy-in yet');
  await live.locator('input[name="buyIn"]').fill('1000');
  await live.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(live.getByTestId('casino-buyin-total')).toHaveText('$1,000 in');
  // The tab carries the live dot from every screen.
  await expect(page.getByTestId('casino-tab-live')).toBeVisible();
  // Review N5: the dot is drawn only; a screen reader hears it as the tab's description.
  const casinoTab = page.getByRole('button', { name: 'Casino', exact: true });
  await expect(casinoTab).toHaveAccessibleDescription('Session running');
  // Review S2: mid-session the live card comes first; the backup nudge waits below it.
  await expect(page.getByTestId('casino-export-nudge')).toBeVisible();
  const liveTop = (await live.boundingBox())!.y;
  const nudgeTop = (await page.getByTestId('casino-export-nudge').boundingBox())!.y;
  expect(liveTop, 'the nudge pushes the live card down').toBeLessThan(nudgeTop);

  // --- An hour later, a rebuy; half an hour after that, a reload.
  await page.clock.fastForward('01:00:00');
  await live.getByRole('button', { name: 'Add buy-in' }).click();
  await live.locator('input[name="buyIn"]').fill('500');
  await live.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(live.getByTestId('casino-buyin-total')).toHaveText('$1,500 in');
  await page.clock.fastForward('00:30:00');
  await page.reload();
  await expect(page.getByTestId('casino-tab-live')).toBeVisible();
  await openCasino(page);
  const stepped = await stepUntilVisible(page, live);
  // The $400 an hour below holds while the session runs under 1.5 h + 6.7 s.
  expect(stepped, 'fake time spent bringing the screen back').toBeLessThanOrEqual(2000);
  await expect(live).toContainText('Golden Nugget');
  await expect(live.getByTestId('casino-buyin-total')).toHaveText('$1,500 in');
  // The clock is the stored start against now, so the reload lost nothing.
  await expect.poll(() => elapsedSeconds(page)).toBeGreaterThanOrEqual(90 * 60);
  expect(await elapsedSeconds(page)).toBeLessThan(91 * 60);
  // And it keeps ticking.
  const before = await elapsedSeconds(page);
  await page.clock.runFor(2000);
  await expect.poll(() => elapsedSeconds(page)).toBeGreaterThanOrEqual(before + 2);

  // --- Heat mid-session, then cash out after a back-off.
  await live.getByRole('button', { name: 'Heat', exact: true }).click();
  await live.getByRole('button', { name: /^Attention/ }).click();
  await expect(live).toContainText('Attention');
  await live.getByRole('button', { name: 'End session' }).click();
  const end = page.getByTestId('end-session');
  await expect(end.getByTestId('end-hours')).toHaveText('1.5 h');
  // The heat picked mid-session is already chosen.
  await expect(end.getByRole('button', { name: /^Attention/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(end.getByTestId('burn-offer')).toHaveCount(0);
  await end.locator('input[name="cashOut"]').fill('2100');
  await expect(end.getByTestId('end-net')).toHaveText('+$600');
  await end.getByRole('button', { name: /^Back-off/ }).click();
  const offer = end.getByTestId('burn-offer');
  await expect(offer).toContainText('Mark Golden Nugget burned');
  await expect(offer.getByRole('checkbox')).toBeChecked();
  await expect(offer.locator('input[name="burnUntil"]')).toHaveValue('2027-04-18');
  await end.locator('input[name="maxTc"]').fill('5');
  await end.getByRole('button', { name: 'End session' }).click();

  // --- The casino is burned, the session is in the history, the totals add up.
  await expect(page.getByTestId('casino-live')).toHaveCount(0);
  await expect(page.getByTestId('casino-tab-live')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Casino', exact: true })).toHaveAccessibleDescription('');
  const burned = page.locator('.cas-group[data-group="burned"]').getByTestId('casino-row');
  await expect(burned).toHaveCount(1);
  await expect(burned).toContainText('Golden Nugget');
  await expect(burned.getByTestId('burned-badge')).toHaveText('Burned until 18 Apr 2027');
  await expect(burned.getByTestId('heat-badge')).toHaveText('Worst: Back-off');
  await expect(burned).toContainText('today');
  const hist = page.getByTestId('history-row');
  await expect(hist).toHaveCount(1);
  await expect(hist).toContainText('Sun 18 Oct');
  await expect(hist).toContainText('Golden Nugget');
  await expect(hist).toContainText('+$600');
  await expect(hist).toContainText('1.5 h');
  await expect(hist.getByTestId('heat-badge')).toHaveText('Back-off');
  await expect(page.getByTestId('casino-net')).toHaveText('+$600');
  await expect(page.getByTestId('casino-hours')).toHaveText('1.5');
  // 1.5 h of fast-forward, the 2 s runFor and at most 2 s of steps: +$600 over
  // at most 1.5011 h is $399.7 or more, so exactly +$400.
  await expect(page.getByTestId('casino-per-hour')).toHaveText('+$400');
  // The session is over and its length is fixed; the rest runs on real time again.
  await page.clock.resume();
  await expect(page.getByTestId('casino-sessions')).toHaveText('1');
  await expect(page.getByTestId('casino-bankroll')).toHaveText('—');
  await page.locator('input[name="startingBankroll"]').fill('10000');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('casino-bankroll')).toHaveText('$10,600');

  // --- Never exported, with data: the nudge is up. Export clears it.
  await expect(page.getByTestId('casino-export-nudge')).toBeVisible();
  const before_export = JSON.parse((await stored(page))!) as { casinos: unknown[]; sessions: unknown[]; settings: unknown };
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('casino-log-2026-10-18.json');
  const file = readFileSync((await download.path())!, 'utf8');
  await expect(page.getByTestId('casino-export-nudge')).toHaveCount(0);

  // --- Storage wiped (iOS eviction), then the file brings it all back.
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await page.reload();
  await openCasino(page);
  await expect(page.getByRole('heading', { name: 'Your real-play notebook' })).toBeVisible();
  await page.getByTestId('casino-import-file').setInputFiles({
    name: 'casino-log-2026-10-18.json',
    mimeType: 'application/json',
    buffer: Buffer.from(file),
  });
  await expect(page.locator('.cas-message')).toHaveText(
    'Imported: 1 casino added, 0 updated, 1 session added, 0 updated.',
  );
  await expect(page.getByTestId('casino-bankroll')).toHaveText('$10,600');
  await expect(page.getByTestId('history-row')).toContainText('+$600');
  const after = JSON.parse((await stored(page))!) as typeof before_export;
  expect(after.casinos).toEqual(before_export.casinos);
  expect(after.sessions).toEqual(before_export.sessions);
  expect(after.settings).toEqual(before_export.settings);

  // --- Importing the same file again changes nothing.
  await page.getByTestId('casino-import-file').setInputFiles({
    name: 'again.json',
    mimeType: 'application/json',
    buffer: Buffer.from(file),
  });
  await expect(page.locator('.cas-message')).toContainText('2 already up to date');

  // --- None of it reached the diagnostic log (the navigation did, so the log is being read).
  await page.clock.runFor(3000);
  const diag = (await readStoredDiagnostics(page)) ?? '';
  expect(diag).toContain('casino');
  expect(diag).not.toContain('Golden Nugget');
  expect(diag).not.toContain('2100');
});

test('a trespass offers an indefinite burn, and leaving it unticked leaves the casino playable', async ({ page }) => {
  await page.clock.install({ time: T0 });
  await page.goto('/?e2e=1');
  await openCasino(page);
  await page.getByRole('button', { name: 'Start session' }).click();
  await page.locator('input[name="newCasinoName"]').fill('Bellagio');
  await page.getByRole('button', { name: 'Add and start' }).click();
  const live = page.getByTestId('casino-live');
  await live.locator('input[name="buyIn"]').fill('2000');
  await live.getByRole('button', { name: 'Add', exact: true }).click();
  await page.clock.fastForward('02:00:00');
  await live.getByRole('button', { name: 'End session' }).click();
  const end = page.getByTestId('end-session');
  await end.locator('input[name="cashOut"]').fill('1500');
  await end.getByRole('button', { name: /^Trespass/ }).click();
  const offer = end.getByTestId('burn-offer');
  await expect(offer).toContainText('Mark Bellagio burned indefinitely');
  await expect(offer.locator('input[name="burnUntil"]')).toHaveCount(0);
  await offer.getByRole('checkbox').uncheck();
  await end.getByRole('button', { name: 'End session' }).click();
  await expect(page.locator('.cas-group[data-group="playable"]').getByTestId('casino-row')).toContainText('Bellagio');
  await expect(page.getByTestId('history-row').getByTestId('heat-badge')).toHaveText('Trespass');
  await expect(page.getByTestId('casino-net')).toHaveText('−$500');
  await expect(page.getByTestId('casino-per-hour')).toHaveText('−$250');

  // The same, ticked: burned indefinitely.
  await page.getByRole('button', { name: 'Start session' }).click();
  await page.getByTestId('start-at').filter({ hasText: 'Bellagio' }).click();
  await page.getByRole('button', { name: 'Later' }).click();
  await page.getByTestId('casino-live').getByRole('button', { name: 'End session' }).click();
  await end.locator('input[name="cashOut"]').fill('0');
  await end.getByRole('button', { name: /^Trespass/ }).click();
  await end.getByRole('button', { name: 'End session' }).click();
  await expect(page.locator('.cas-group[data-group="burned"]').getByTestId('burned-badge')).toHaveText('Burned indefinitely');
});

test('a finished session can be edited and deleted, and the figures follow', async ({ page }) => {
  // Seconds on both ends: the form's fields are minute precision (review N4).
  const start = new Date(T0 - 3 * 86_400_000 + 37_000).toISOString();
  const endAt = new Date(T0 - 3 * 86_400_000 + 2 * 3_600_000 + 37_000).toISOString();
  await page.clock.install({ time: T0 });
  await page.addInitScript(
    ([k, blob]) => {
      if (!localStorage.getItem(k)) localStorage.setItem(k, blob);
    },
    [
      LEGACY_KEY,
      JSON.stringify({
        version: 1,
        casinos: [{ id: 'c1', name: 'El Cortez', game: { decks: 2 }, midShoeEntry: 'no', csm: false, status: 'ok', notes: '', createdAt: start, updatedAt: start }],
        sessions: [{ id: 's1', casinoId: 'c1', start, end: endAt, buyIns: [500], cashOut: 800, heat: 'none', notes: '', createdAt: start, updatedAt: endAt }],
        settings: { startingBankroll: null, updatedAt: null },
        lastExportAt: new Date(T0 - 86_400_000).toISOString(),
      }),
    ] as const,
  );
  await page.goto('/?e2e=1');
  await openCasino(page);
  // Exported yesterday: no nudge. The row warns about no mid-shoe entry.
  await expect(page.getByTestId('casino-export-nudge')).toHaveCount(0);
  await expect(page.getByTestId('casino-row').getByTestId('warn-badge')).toHaveText('No mid-shoe');
  await expect(page.getByTestId('casino-row')).toContainText('3 days ago');
  await expect(page.getByTestId('casino-net')).toHaveText('+$300');

  await page.getByTestId('history-row').click();
  const form = page.getByTestId('session-form');
  // Review S1: a finished session cannot lose its cash-out (it would leave every total).
  await form.locator('input[name="cashOut"]').fill('');
  await form.getByRole('button', { name: 'Save session' }).click();
  await expect(form.getByRole('alert')).toContainText('Enter what you cashed out');
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('casino-net')).toHaveText('+$300');
  await expect(page.getByTestId('history-row')).toContainText('+$300');

  await page.getByTestId('history-row').click();
  await form.getByRole('button', { name: '+ Add a buy-in' }).click();
  await form.locator('input[name="buyIn1"]').fill('200');
  await form.locator('input[name="cashOut"]').fill('650');
  await expect(form.getByTestId('session-preview')).toContainText('−$50');
  await form.getByRole('button', { name: /^Shuffle-up/ }).click();
  await form.getByRole('button', { name: 'Save session' }).click();
  await expect(page.getByTestId('casino-net')).toHaveText('−$50');
  await expect(page.getByTestId('history-row').getByTestId('heat-badge')).toHaveText('Shuffle-up');
  // Review N4: times left alone are kept to the second, not cut to the minute.
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').sessions[0], KEY);
  expect([saved.start, saved.end]).toEqual([start, endAt]);
  // Review S2: the edit went to the v2 key; the v1 blob an older build reads is untouched.
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).version, KEY)).toBe(2);
  const legacy = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), LEGACY_KEY))!);
  expect(legacy.version).toBe(1);
  expect(legacy.sessions[0].cashOut).toBe(800);

  // Delete asks first, in words, then goes.
  await page.getByTestId('history-row').click();
  await form.getByRole('button', { name: 'Delete session' }).click();
  await expect(form.getByRole('group', { name: 'Confirm delete' })).toContainText('Delete this session (−$50)?');
  await form.getByRole('button', { name: 'Keep it' }).click();
  await form.getByRole('button', { name: 'Delete session' }).click();
  await form.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByTestId('history-row')).toHaveCount(0);
  await expect(page.getByText('No finished sessions yet.')).toBeVisible();
});

test('a half-filled end-of-session form asks before a stray tab tap throws it away', async ({ page }) => {
  await page.clock.install({ time: T0 });
  await page.goto('/?e2e=1');
  await openCasino(page);
  await page.getByRole('button', { name: 'Start session' }).click();
  await page.locator('input[name="newCasinoName"]').fill('Wynn');
  await page.getByRole('button', { name: 'Add and start' }).click();
  await page.getByRole('button', { name: 'Later' }).click();
  await page.getByTestId('casino-live').getByRole('button', { name: 'End session' }).click();
  await page.locator('input[name="cashOut"]').fill('750');

  const asked: string[] = [];
  page.once('dialog', (d) => {
    asked.push(d.message());
    void d.dismiss();
  });
  await page.locator('.tab-bar').getByRole('button', { name: 'Home', exact: true }).click();
  expect(asked).toEqual(['Discard what you entered on this form?']);
  await expect(page.locator('input[name="cashOut"]')).toHaveValue('750');

  // Back is the deliberate way out and does not ask; with nothing typed, the tabs do not either.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('casino-live')).toBeVisible();
  page.once('dialog', (d) => {
    asked.push(d.message());
    void d.dismiss();
  });
  await page.locator('.tab-bar').getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('.tab-bar [aria-current="page"]')).toHaveText(/Home/);
  expect(asked).toHaveLength(1);
});

test('export by the share sheet counts only when a file was actually handed over', async ({ page }) => {
  await page.clock.install({ time: T0 });
  // Review S3: a share sheet can be dismissed. Stub one that is dismissed once, then completes.
  await page.addInitScript(() => {
    const w = window as unknown as { __shared: string[]; __shareCalls: number };
    w.__shared = [];
    w.__shareCalls = 0;
    Object.defineProperty(navigator, 'canShare', {
      value: (d: { files?: File[] }) => Boolean(d.files?.length),
      configurable: true,
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (d: { files: File[] }) => {
        w.__shareCalls += 1;
        if (w.__shareCalls === 1) throw new DOMException('dismissed', 'AbortError');
        w.__shared.push(d.files[0]!.name);
      },
    });
  });
  await page.goto('/?e2e=1');
  await openCasino(page);
  await page.getByRole('button', { name: 'Start session' }).click();
  await page.locator('input[name="newCasinoName"]').fill('Wynn');
  await page.getByRole('button', { name: 'Add and start' }).click();
  const nudge = page.getByTestId('casino-export-nudge');
  await expect(nudge).toBeVisible();

  await nudge.getByRole('button', { name: 'Export now' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shareCalls: number }).__shareCalls)).toBe(1);
  await expect(nudge).toBeVisible();
  expect((JSON.parse((await stored(page))!) as { lastExportAt: unknown }).lastExportAt).toBeNull();

  await nudge.getByRole('button', { name: 'Export now' }).click();
  await expect(nudge).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __shared: string[] }).__shared)).toEqual([
    'casino-log-2026-10-18.json',
  ]);
  expect((JSON.parse((await stored(page))!) as { lastExportAt: unknown }).lastExportAt).not.toBeNull();
});

test("a second tab sees the first tab's buy-in, and ending there keeps it", async ({ context }) => {
  // Review S5: the cross-tab refresh. Without it, tab A would save its stale log over B's buy-in.
  const a = await context.newPage();
  await a.goto('/?e2e=1');
  await openCasino(a);
  await a.getByRole('button', { name: 'Start session' }).click();
  await a.locator('input[name="newCasinoName"]').fill('Aria');
  await a.getByRole('button', { name: 'Add and start' }).click();
  await a.locator('input[name="buyIn"]').fill('1000');
  await a.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(a.getByTestId('casino-buyin-total')).toHaveText('$1,000 in');

  const b = await context.newPage();
  await b.goto('/?e2e=1');
  await openCasino(b);
  await b.getByTestId('casino-live').getByRole('button', { name: 'Add buy-in' }).click();
  await b.locator('input[name="buyIn"]').fill('500');
  await b.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(b.getByTestId('casino-buyin-total')).toHaveText('$1,500 in');

  await expect(a.getByTestId('casino-buyin-total')).toHaveText('$1,500 in');
  await a.getByTestId('casino-live').getByRole('button', { name: 'End session' }).click();
  await a.locator('input[name="cashOut"]').fill('2000');
  await a.getByTestId('end-session').getByRole('button', { name: 'End session' }).click();
  await expect(a.getByTestId('casino-net')).toHaveText('+$500');
  const log = JSON.parse((await stored(a))!) as { sessions: { buyIns: number[]; cashOut: number }[] };
  expect(log.sessions[0]).toMatchObject({ buyIns: [1000, 500], cashOut: 2000 });
});

test('an unreadable stored log does not crash the tab, and is kept aside', async ({ page }) => {
  await page.addInitScript((k) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(k, '{"version":1,"casinos":[{"id":"c1","name":"Trunc');
      sessionStorage.setItem('seeded', '1');
    }
  }, KEY);
  await page.goto('/?e2e=1');
  await openCasino(page);
  await expect(page.getByTestId('casino-screen')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your real-play notebook' })).toBeVisible();
  await expect(page.getByText('An earlier copy of this log could not be read')).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(`${k}.corrupt`), KEY)).toContain('"name":"Trunc');
});

/** A populated log for the looks tests: every badge tone, a burn, a cool-off, a live session. */
function richLog(now: number): string {
  const D = 86_400_000;
  const H = 3_600_000;
  const at = (t: number) => new Date(t).toISOString();
  const casino = (id: string, name: string, extra: Record<string, unknown>) => ({
    id,
    name,
    area: 'Las Vegas',
    game: { decks: 6, s17: false, das: true, surrender: true, payout: '3:2', cutDecksLeft: 1 },
    midShoeEntry: 'allowed',
    csm: false,
    status: 'ok',
    burnedUntil: null,
    notes: '',
    createdAt: at(now - 90 * D),
    updatedAt: at(now - 90 * D),
    ...extra,
  });
  const session = (id: string, casinoId: string, ago: number, buyIns: number[], cashOut: number | null, heat: string) => ({
    id,
    casinoId,
    start: at(now - ago),
    end: cashOut === null ? null : at(now - ago + 2 * H),
    buyIns,
    cashOut,
    heat,
    notes: '',
    createdAt: at(now - ago),
    updatedAt: at(now - ago),
  });
  return JSON.stringify({
    version: 1,
    casinos: [
      casino('c1', 'Golden Nugget', {}),
      casino('c2', 'Bellagio', { status: 'burned', burnedUntil: '2099-01-01' }),
      casino('c3', 'Excalibur', { status: 'avoid', csm: true, midShoeEntry: 'no', game: { payout: '6:5' } }),
      casino('c4', 'El Cortez', { status: 'burned', burnedUntil: '2020-01-01' }),
    ],
    sessions: [
      session('s1', 'c1', 5 * D, [1000], 1450, 'attention'),
      session('s2', 'c2', 9 * D, [2000], 600, 'back-off'),
      session('s3', 'c4', 30 * D, [500], 900, 'shuffle-up'),
      session('s4', 'c1', H, [1000], null, 'attention'),
    ],
    settings: { startingBankroll: 10000, updatedAt: null },
    lastExportAt: null,
  });
}

for (const theme of ['midnight-felt', 'bone-ink', 'amoled-night', 'slate-copper'] as const) {
  test(`the Casino tab's small text reaches 4.5:1 in ${theme}`, async ({ page }) => {
    await withSettings(page, { theme });
    // A v1 blob under the v1 key, as an older build left it: read through the migration.
    await page.addInitScript(([k, blob]) => localStorage.setItem(k, blob), [LEGACY_KEY, richLog(Date.now())] as const);
    await page.goto('/?e2e=1');
    await openCasino(page);
    await expect(page.getByTestId('casino-live')).toBeVisible();
    // Every tone of badge is on screen, so none is measured by its absence.
    for (const tone of ['warn', 'bad', 'good']) await expect(page.locator(`.cas-badge[data-tone="${tone}"]`).first()).toBeVisible();
    const bad: string[] = [];
    for (const sel of [
      '.cas-badge[data-tone="warn"]',
      '.cas-badge[data-tone="bad"]',
      '.cas-badge[data-tone="good"]',
      '.cas-row-meta',
      '.cas-row-game',
      '.cas-group-title',
      '.cas-stat-label',
      '.cas-note',
      '.cas-hist-date',
      '.cas-hist-hours',
      '.cas-live-tag',
      '.cas-live-figs',
      '.cas-nudge-text',
      '.casino-screen [data-sign="1"]',
      '.casino-screen [data-sign="-1"]',
      // The resting tabs. (The ACTIVE label is accent on the accent wash,
      // themeCues.css, shared by every tab and not this screen's to change.)
      '.tab-btn:not(.tab-btn-active) .tab-label',
    ]) {
      const ratio = await worstContrast(page, sel);
      if (ratio < 4.5) bad.push(`${sel} ${ratio.toFixed(2)}`);
    }
    await page.getByTestId('casino-live').getByRole('button', { name: 'Heat', exact: true }).click();
    for (const sel of ['.cas-heat-opt-name', '.cas-heat-opt-hint']) {
      const ratio = await worstContrast(page, sel);
      if (ratio < 4.5) bad.push(`${sel} ${ratio.toFixed(2)}`);
    }
    expect(bad, `low contrast in ${theme}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
