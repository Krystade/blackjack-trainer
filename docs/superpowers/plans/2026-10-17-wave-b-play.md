# Wave B, lane P (Play): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a Play round readable at a glance, turn the session report into a practice driver, add the opt-in Hot shoe, and finish the Table's real-minus leftover from Wave A.

**Architecture:** The pure logic goes in small new `.ts` modules, each with a vitest file: `roundBanner`, `feltLayout`, `reportSections`, `sessionFigures`, `engine/shoeBias`. `Table.tsx`, `useGame.ts` and `engine/game.ts` only wire those modules in. New CSS goes in new files. The Hot shoe reorders a complete shoe with a weighted random permutation, so it never adds, removes or duplicates a card.

**Tech Stack:** React 19, TypeScript ~6.0, Vite 8, vitest 4 (node environment, `.test.ts` only), Playwright 1.61 (chromium project), oxlint.

**Spec:** `docs/superpowers/specs/2026-10-16-wave-b-design.md` (items B5, B6 report part, B8). Lane contracts: `docs/superpowers/plans/2026-10-17-wave-b-contracts.md`. Both are binding. Evidence: backlog W4, W5, W6, W12, D6 and user story 7 and 9 in `docs/superpowers/specs/2026-10-16-swarm-backlog.md`; story findings s05, s07, s08 in `docs/superpowers/specs/2026-10-16-swarm-stories.json`.

**Where it runs:** branch `wave-b-play`, in its own worktree (for example `.claude/worktrees/play`). Run every command from that worktree's root. E2E port: **4710**.

## Global Constraints

- iPhone 13 mini: 375×812, notch insets, every tap target ≥ 44px, no sideways scroll, nothing under the status bar or the mute control.
- Low friction: no new required inputs. Anything new is a default-off option or a derived screen. Hot shoe is off by default (`hotShoe?: boolean`, absent = off).
- Strategy truth comes only from `src/engine/*`. No hard-coded strategy in UI code.
- Signed counts use a real minus sign (U+2212), through `src/drills/signed.ts` (contract 6). In this lane every signed number on the Table and its report uses it: counts, TC, net results and bankroll.
- Eyes-free, voice and wheel paths keep working. "Yes" by voice still dismisses the wrong-play card (`handleVoiceCommand`, Table.tsx:445-448).
- New CSS goes in new files, never appended to `app.css`. `store/types.ts` and `persist.ts` take additive optional fields only (append, comment, never rename).
- TDD. Mutation-check every new test: copy the file with `cp` to the scratch dir, break it, watch the test fail, then restore with `cp`. Never use `git checkout`.
- Gates: `npx tsc -b`, `npx vitest run`, `npm run lint` (exactly 13 warnings; an extra non-component export from a `.tsx` adds one, so all new helpers go in `.ts` files), `npm run build` plus a grep of `dist/`, and targeted `E2E_PORT=4710 npx playwright test <specs> --project=chromium --reporter=line`.
- Visual changes are checked with a headless 375×812 screenshot that the implementer opens and reads. B5 needs all four themes: `midnight-felt`, `bone-ink`, `amoled-night`, `slate-copper`.
- Commit explicit paths only. Never use `git add -A` or `git add .`, and never commit `docs/sources/chart-view-*.png`. Never stop a process you did not start. No audible audio and no headed browsers.
- Do not rename `.table-topbar`/`.topbar`, `.report-screen` or its leading `<h1>`. Do not move the mute control (contract 5).

## Review Focus

1. **Many hands, many cards at 375px:** after splits or hits the felt must shrink cards and never scroll sideways. Up to 3 two-card hands stay on one row; 4 or more hands, which only splits can produce, wrap. *Pinned by:* Task 2's `feltLayout` unit tests (`[2,2,2]`, `[5]`, `[6,2]` fit on one row; `[4,4,4,4]` sits at the floor with each hand fitting the width) and the 3-hand e2e.
2. **A session where every round was sat out (0 hands):** the report must not show NaN or Infinity. *Pinned by:* Task 4's `lossPer100(…, 0) === null` and the "no headline when 0 hands" case in Task 5's report e2e.
3. **Old session rows without the new fields:** Stats' per-100 figure must skip them rather than count them as 0 hands. *Pinned by:* Task 4's `sessionsLossPer100` test with legacy rows.
4. **Report whose only misses have no basic cell** (index plays, insurance, bets): "Drill these hands" must not open an empty or Auto-filled Custom. *Pinned by:* Task 4's `drillCellIds` exclusions and Task 6's "button hidden when no cells" unit check.
5. **Hot shoe and Losing shoe both on:** the losing (rigged) shoe deals. The session must not be called Hot shoe, and its bankroll still carries over. *Pinned by:* Task 7's `hotShoeActive` test.
6. Also pinned, though not counted in the five above: a banner when the hole card was never shown (every hand bust or surrendered) says "Dealer shows X" rather than a total it doesn't know (Task 1 unit test). An unanswered count check reads "not answered" (Task 4).

---

### Task 1: Result banner with both totals, and real minus on the Table

**Files:**
- Create: `src/ui/roundBanner.ts`, `src/ui/roundBanner.test.ts`, `src/ui/screens/tableGlance.css`, `e2e/play-glance.spec.ts`
- Modify: `src/ui/screens/Table.tsx`: imports (1-52), delete `resultMessage` (172-189), `formatSigned` (191-193), the settled-results map (998-1005), `count-voice-value` (1080)
- Modify (existing e2e that pinned the ASCII hyphen or the trailing net): `e2e/voice-count.spec.ts` (the seven `toHaveText('-N')` at 110-217 become `'−N'`), `e2e/game.spec.ts:547` (`'Surrender −0.5'`), `e2e/table-seats.spec.ts:14-20,158-162` (read nets from `data-net`), `e2e/play-bankroll.spec.ts:112-114` (negative delta written with `−`)

**Interfaces:**
- Produces: `roundBanner(hand: PlayerHand, playNumber: number, multi: boolean, dealerCards: readonly Card[], holeRevealed: boolean): RoundBanner`, where `interface RoundBanner { head: string; totals: string; net: number }`. Produces CSS file `tableGlance.css`, which Tasks 2, 3 and 8 append to. Also produces the e2e helpers `dealPlayerTurn(page, firstSeed?)` and `boxes(page, selector)` in `e2e/play-glance.spec.ts`, used by Tasks 2 and 3.

- [ ] **Step 1: Write the failing unit test** `src/ui/roundBanner.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { Card, Rank } from '../engine/cards';
import type { PlayerHand } from '../engine/game';
import { roundBanner } from './roundBanner';

const c = (...r: Rank[]): Card[] => r.map((rank) => ({ rank, suit: 's' }));
const hand = (cards: Card[], result: PlayerHand['result'], net: number): PlayerHand =>
  ({ cards, bet: 1, doubled: false, surrendered: false, fromSplit: false, splitAces: false, done: true, result, net, originIndex: 0 });

describe('roundBanner (B5/W5)', () => {
  it('a lost hand: result with a real minus, then both totals', () => {
    const b = roundBanner(hand(c('10', '7'), 'lose', -1), 1, false, c('10', '9'), true);
    expect(`${b.head} · ${b.totals}`).toBe('Lose −1 · You 17 · Dealer 19');
    expect(b.net).toBe(-1);
  });
  it('win, push, blackjack and surrender read as the table says them', () => {
    expect(roundBanner(hand(c('10', 'Q'), 'win', 2), 1, false, c('10', '8'), true).head).toBe('Win +2');
    expect(roundBanner(hand(c('10', '8'), 'push', 0), 1, false, c('9', '9'), true).head).toBe('Push');
    const bj = roundBanner(hand(c('A', 'K'), 'blackjack', 1.5), 1, false, c('10', '8'), true);
    expect(`${bj.head} · ${bj.totals}`).toBe('Blackjack! +1.5 · You blackjack · Dealer 18');
    expect(roundBanner(hand(c('10', '6'), 'surrender', -0.5), 1, false, c('10', '7'), false).head).toBe('Surrender −0.5');
  });
  it('a bust says so, and a dealer bust says so', () => {
    expect(roundBanner(hand(c('10', '6', '9'), 'lose', -1), 1, false, c('10', '7'), false).totals).toBe('You 25 (bust) · Dealer shows 10');
    expect(roundBanner(hand(c('10', '8'), 'win', 1), 1, false, c('6', '10', '9'), true).totals).toBe('You 18 · Dealer 25 (bust)');
  });
  it('never invents a dealer total for an unrevealed hole card', () => {
    expect(roundBanner(hand(c('10', '6'), 'surrender', -0.5), 1, false, c('A', '9'), false).totals).toBe('You 16 · Dealer shows A');
  });
  it('a dealer natural is named, not summed', () => {
    expect(roundBanner(hand(c('10', '8'), 'lose', -1), 1, false, c('A', 'K'), true).totals).toBe('You 18 · Dealer blackjack');
  });
  it('split and multi-hand rounds carry the play-order label', () => {
    expect(roundBanner(hand(c('8', '10'), 'win', 1), 2, true, c('10', '7'), true).head).toBe('Hand 2: Win +1');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ui/roundBanner.test.ts`
Expected: FAIL, because `./roundBanner` cannot be resolved.

- [ ] **Step 3: Implement `roundBanner` in `src/ui/roundBanner.ts`**

Build the head from the old `resultMessage` vocabulary (`Win`, `Lose`, `Push`, `Blackjack!`, `Surrender`) with the net through `signed(net, { plusZero: false })` from `src/drills/signed.ts`. Push carries no number. Prefix `Hand ${playNumber}: ` when `multi`. Build the totals with `handValue`/`isBlackjack` from `src/engine/hand.ts`:
- **You:** `You blackjack` when `result === 'blackjack'`; `You N (bust)` when over 21; otherwise `You N`.
- **Dealer:** `Dealer shows <upRank>` when `!holeRevealed`; `Dealer blackjack` for a two-card 21; `Dealer N (bust)`; otherwise `Dealer N`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/ui/roundBanner.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing e2e** in a new `e2e/play-glance.spec.ts`

```ts
import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, resolveInsurance, playRoundByAdvice, shot } from './helpers';

test.use({ viewport: { width: 375, height: 812 } });
const THEMES = ['midnight-felt', 'bone-ink', 'amoled-night', 'slate-copper'] as const;
const SOLO = { playerHands: 1, bots: 0, botMistakePct: 0, playerPosition: 0 };

/** Deal seeds from `firstSeed` until one stops at a player decision. */
async function dealPlayerTurn(page: Page, firstSeed = 1): Promise<number> {
  for (let seed = firstSeed; seed < firstSeed + 30; seed++) {
    await page.goto(`/?seed=${seed}&e2e=1`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await resolveInsurance(page, false);
    if (await page.locator('.action-bar[data-advice]').isVisible().catch(() => false)) return seed;
  }
  throw new Error('no seed reached a player decision');
}

async function boxes(page: Page, sel: string) {
  return page.locator(sel).evaluateAll((els) =>
    els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right }; }));
}

const BANNER = /^(Win \+[\d.]+|Lose −[\d.]+|Push|Blackjack! \+[\d.]+|Surrender −[\d.]+) · You (\d+( \(bust\))?|blackjack) · Dealer (\d+( \(bust\))?|blackjack|shows (A|[2-9]|10|J|Q|K))$/;

test('B5/W5: a settled hand shows its result and both totals at 20px or more', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { seats: SOLO });
  await dealPlayerTurn(page);
  await playRoundByAdvice(page);
  const banner = page.locator('.round-banner');
  await expect(banner).toHaveCount(1);
  await expect(banner).toHaveText(BANNER);
  expect(await banner.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(20);
});

test('B5/W5: two hands get a banner each, labelled in play order', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { seats: { ...SOLO, playerHands: 2 } });
  await dealPlayerTurn(page);
  await playRoundByAdvice(page);
  const banners = page.locator('.round-banner');
  const n = await banners.count();
  expect(n).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < n; i++) await expect(banners.nth(i)).toHaveText(new RegExp(`^Hand ${i + 1}: .+ · You .+ · Dealer .+$`));
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `E2E_PORT=4710 npx playwright test e2e/play-glance.spec.ts --project=chromium --reporter=line`
Expected: FAIL, with `.round-banner` count 0.

- [ ] **Step 7: Wire the banner and the real minus into `Table.tsx`**

- Replace `formatSigned` (191-193) with `(n: number) => signed(n, { plusZero: true })`. This puts U+2212 into the report's bankroll and TC, the insurance line, and `count-voice-value` (1080), which is the Wave A leftover.
- Replace each settled result line (998-1005) with `<div className="message-result round-banner" data-net={b.net}><span className="round-banner-head">{b.head}</span><span className="round-banner-totals"> · {b.totals}</span></div>`. Keep the play order (`.reverse()`) and the `handPlayNumber` label.
- Delete `resultMessage`. Import `./tableGlance.css`.
- In `tableGlance.css`: `.table-screen .round-banner { font-size: 1.375rem; font-weight: 800; line-height: 1.25; color: var(--ink); }` and `.round-banner-totals { white-space: nowrap; font-weight: 600; }`.

- [ ] **Step 8: Update the pinned e2e to the new text**

- `voice-count.spec.ts`: change `'-3'`, `'-2'` to `'−3'`, `'−2'` (leave `'+0'` and `'+7'` alone).
- `game.spec.ts:547`: `'Surrender −0.5'`.
- `table-seats.spec.ts`: replace `parseNet` and the `lines.map(parseNet)` with `const nets = await page.locator('.round-banner').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.net)));`, and keep the `Hand 1`/`Hand 2` checks.
- `play-bankroll.spec.ts:113`: `` `bankroll ${delta >= 0 ? `+${delta}` : `−${-delta}`}` ``.

- [ ] **Step 9: Run unit, new and touched e2e**

Run: `npx vitest run src/ui/roundBanner.test.ts` and `E2E_PORT=4710 npx playwright test e2e/play-glance.spec.ts e2e/voice-count.spec.ts e2e/game.spec.ts e2e/table-seats.spec.ts e2e/play-bankroll.spec.ts --project=chromium --reporter=line`
Expected: all PASS.

- [ ] **Step 10: Mutation-check**

Each of these must make a test fail, then restore from the `cp` backup:
- (a) In `roundBanner.ts`, emit `String(net)`. The unit test fails on `'Lose −1'`.
- (b) Drop the `.round-banner` font-size rule. The e2e fails on ≥ 20.
- (c) Put `formatSigned` back to ASCII at the count-voice value. `voice-count.spec.ts` fails.

- [ ] **Step 11: Commit**

```bash
git add src/ui/roundBanner.ts src/ui/roundBanner.test.ts src/ui/screens/tableGlance.css src/ui/screens/Table.tsx e2e/play-glance.spec.ts e2e/voice-count.spec.ts e2e/game.spec.ts e2e/table-seats.spec.ts e2e/play-bankroll.spec.ts
git commit -m "feat(play): result banner with both totals; real minus on the Table (B5/W5, Wave A leftover)"
```

---

### Task 2: Bigger cards on the felt, Count drill and Pair cancellation; bigger action labels; styled skip control

**Files:**
- Create: `src/ui/feltLayout.ts`, `src/ui/feltLayout.test.ts`, `src/ui/components/cardSize.css`
- Modify: `src/ui/components/PlayingCard.tsx:1-2` (add `import './cardSize.css';` and nothing else), `src/ui/screens/Table.tsx`: `.dealer-area` (870-883) and `.hands-row` (927-955) get the felt custom properties; the fast-forward button (1037-1046)
- Modify: `src/ui/screens/tableGlance.css` (append)
- Test: `e2e/play-glance.spec.ts` (append)
- **No edit** to `CountDrillView.tsx` or `PairCancelView.tsx`. `cardSize.css` targets their existing `.count-flash-cards` and `.pair-cancel-cards` and is loaded through `PlayingCard.tsx`, so it stays within the contract's "new CSS file, at most a one-line import" limit with zero lines changed in lane D's views.

**Interfaces:**
- Consumes: `dealPlayerTurn` and `boxes` from Task 1's spec.
- Produces: `interface FeltRow { slots: number; fixedPx: number }`, `playerFeltRow(cardCounts: readonly number[]): FeltRow`, `dealerFeltRow(cardCount: number): FeltRow`, `cardWidthAt(row: FeltRow, viewportPx: number): number`, and the constants `CARD_MIN_PX = 32`, `CARD_MAX_PX = 84`.

The sizing math (constants mirrored in `cardSize.css`, with a comment in each file pointing at the other):
- **Player row:** `slots = Σ max(2, n)`. `fixedPx = 24` (row padding) `+ 20·hands` (hand padding and border) `+ 4·(slots − hands)` (card gaps) `+ 16·(hands − 1)` (hand gaps). With no hands, use `[2]`.
- **Dealer row:** `slots = max(2, n)`, `fixedPx = 24 + 8·(slots − 1)`.
- `cardWidthAt = clamp(32, (min(viewport, 480) − fixedPx) / slots, 84)`.
- **CSS:** `--card-w: clamp(32px, calc((min(100vw, 480px) - var(--felt-fixed)) / var(--felt-slots)), 84px)`, with height `calc(var(--card-w) * 1.4167)`, rank font `calc(var(--card-w) * 0.34)` and suit font `calc(var(--card-w) * 0.38)`. Apply it through `:is(.table-screen .dealer-area, .table-screen .hands-row, .count-flash-cards, .pair-cancel-cards) .card:not(.card-compact)`. That selector's specificity is high enough to beat `app.css`'s `.card` without editing `app.css`.
- **Count drill:** `.count-flash-cards { --card-w: 104px }`, `:has(> :nth-child(2))` → 92px, `:has(> :nth-child(3))` → 84px, and `min-height: calc(var(--card-w) * 1.4167)`.
- **Pair cancellation:** `.pair-cancel-cards { --card-w: 96px }`.
- **Action labels:** `.table-screen .action-btn { font-size: clamp(0.8125rem, 3.6vw, 1rem); min-height: 52px; }`. That is 13.5px at 375; "Surrender" measures 60.5px at 13.5px against a ~62px content box.
- **Skip control:** `.table-screen .fast-forward-btn` becomes a pill: `min-height: 44px; padding: 0 1rem; font-size: 0.95rem; font-weight: 700; display: inline-flex; gap: 0.35rem; align-items: center; border-radius: 999px`.

- [ ] **Step 1: Write the failing unit test** `src/ui/feltLayout.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { playerFeltRow, dealerFeltRow, cardWidthAt, CARD_MIN_PX, CARD_MAX_PX } from './feltLayout';

const fits = (counts: number[], vw: number) => {
  const row = playerFeltRow(counts);
  return cardWidthAt(row, vw) * row.slots + row.fixedPx <= vw;
};

describe('feltLayout (B5/W4)', () => {
  it('reserves exactly the felt chrome app.css draws (row padding, hand padding+border, card and hand gaps)', () => {
    expect(playerFeltRow([2])).toEqual({ slots: 2, fixedPx: 24 + 20 + 4 });
    expect(playerFeltRow([2, 2])).toEqual({ slots: 4, fixedPx: 24 + 40 + 8 + 16 });
    expect(playerFeltRow([2, 2, 2])).toEqual({ slots: 6, fixedPx: 24 + 60 + 12 + 32 });
    expect(dealerFeltRow(3)).toEqual({ slots: 3, fixedPx: 24 + 16 });
  });
  it('one or two dealt hands get cards at least 70px wide at 375', () => {
    expect(cardWidthAt(playerFeltRow([2]), 375)).toBeGreaterThanOrEqual(70);
    expect(cardWidthAt(playerFeltRow([2, 2]), 375)).toBeGreaterThanOrEqual(70);
    expect(cardWidthAt(dealerFeltRow(2), 375)).toBeGreaterThanOrEqual(70);
  });
  it('never grows past the cap on a wide screen', () => {
    expect(cardWidthAt(playerFeltRow([2]), 480)).toBe(CARD_MAX_PX);
  });
  it('shrinks for more hands and more cards, and the row still fits at 375', () => {
    expect(cardWidthAt(playerFeltRow([2, 2, 2]), 375)).toBeLessThan(70);
    for (const counts of [[2, 2, 2], [3, 3], [5], [6, 2]]) expect(fits(counts, 375)).toBe(true);
    expect(cardWidthAt(dealerFeltRow(7), 375) * 7 + dealerFeltRow(7).fixedPx).toBeLessThanOrEqual(375);
  });
  it('past one row it bottoms out at the floor, and any single hand still fits the width (the row wraps, never scrolls)', () => {
    for (const counts of [[2, 2, 2, 2], [3, 3, 3, 3], [4, 4, 4, 4]]) {
      const w = cardWidthAt(playerFeltRow(counts), 375);
      expect(w).toBe(CARD_MIN_PX);
      const widest = Math.max(...counts);
      expect(w * widest + playerFeltRow([widest]).fixedPx).toBeLessThanOrEqual(375);
    }
  });
  it('counts an empty felt as one two-card hand', () => {
    expect(playerFeltRow([])).toEqual(playerFeltRow([2]));
  });
});
```

At the 32px floor, a row holds at most 3 two-card hands, or about 8 card slots. Four or more hands (only reachable by splitting) wrap onto a second row. That is allowed: the spec's requirement is "shrinking … without overflow", and the felt never scrolls sideways because every single hand fits the width.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ui/feltLayout.test.ts`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement `src/ui/feltLayout.ts`** with the formulas above.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/ui/feltLayout.test.ts`
Expected: PASS.

- [ ] **Step 5: Append the failing e2e** to `e2e/play-glance.spec.ts`

```ts
for (const hands of [1, 2] as const) {
  test(`B5/W4: ${hands} hand(s): cards ≥ 70px at 375, centred, one row, no sideways scroll`, async ({ page }) => {
    await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
    await withProfile(page, { seats: { ...SOLO, playerHands: hands } });
    await dealPlayerTurn(page);
    const player = await boxes(page, '.hands-row .card');
    const dealer = await boxes(page, '.dealer-area .card');
    expect(player.length).toBeGreaterThanOrEqual(hands * 2);
    for (const b of [...player, ...dealer]) {
      expect(b.w).toBeGreaterThanOrEqual(70);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(375);
    }
    const handBoxes = await boxes(page, '.player-hand');
    expect(new Set(handBoxes.map((h) => Math.round(h.y))).size).toBe(1);
    const left = Math.min(...handBoxes.map((h) => h.x));
    const right = 375 - Math.max(...handBoxes.map((h) => h.right));
    expect(Math.abs(left - right)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
}

test('B5/W4: three hands shrink to fit one row', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { seats: { ...SOLO, playerHands: 3 } });
  await dealPlayerTurn(page);
  const player = await boxes(page, '.hands-row .card');
  for (const b of player) { expect(b.w).toBeLessThan(70); expect(b.w).toBeGreaterThanOrEqual(32); expect(b.right).toBeLessThanOrEqual(375); }
  expect(new Set((await boxes(page, '.player-hand')).map((h) => Math.round(h.y))).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('B5/W4: action-bar labels are at least 13px and none is cut off', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { seats: SOLO });
  await dealPlayerTurn(page);
  const m = await page.locator('.action-bar .action-btn').evaluateAll((els) =>
    els.map((e) => ({ px: parseFloat(getComputedStyle(e).fontSize), fits: e.scrollWidth <= e.clientWidth, h: e.getBoundingClientRect().height })));
  expect(m).toHaveLength(5);
  for (const b of m) { expect(b.px).toBeGreaterThanOrEqual(13); expect(b.fits).toBe(true); expect(b.h).toBeGreaterThanOrEqual(48); }
});

test('B5: the skip control is a styled button, not an emoji', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 400 });
  await page.goto('/?seed=3&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  const ff = page.locator('.fast-forward-btn');
  await expect(ff).toBeVisible();
  await expect(ff).toHaveText('Skip');
  expect(await ff.innerText()).not.toMatch(/\p{Extended_Pictographic}/u);
  expect((await ff.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await ff.click();
  await expect(ff).toHaveCount(0);
});

for (const [group, min] of [[1, 96], [3, 70]] as const) {
  test(`B5/W4: the Count drill flashes big cards (group of ${group})`, async ({ page }) => {
    await withSettings(page, { drill: { countLengthCards: 6, countGroup: group, countManual: true } });
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: 'Count drill', exact: true }).click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    const cards = await boxes(page, '.manual-tap-zone .count-flash-cards .card');
    expect(cards).toHaveLength(group);
    for (const c of cards) { expect(c.w).toBeGreaterThanOrEqual(min); expect(c.right).toBeLessThanOrEqual(375); }
  });
}

test('B5/W4: Pair cancellation shows both cards at least 90px wide', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Pair cancellation', exact: true }).click();
  const cards = await boxes(page, '.pair-cancel-cards .card');
  expect(cards).toHaveLength(2);
  for (const c of cards) { expect(c.w).toBeGreaterThanOrEqual(90); expect(c.right).toBeLessThanOrEqual(375); }
});

for (const theme of THEMES) {
  test(`B5 screenshots: felt and banner at 375x812 in ${theme}`, async ({ page }) => {
    await withSettings(page, { theme, countCheckEvery: 0, dealSpeedMs: 0 });
    await withProfile(page, { seats: { ...SOLO, playerHands: 2 } });
    await dealPlayerTurn(page);
    await shot(page, `b5-felt-${theme}`);
    await playRoundByAdvice(page);
    await shot(page, `b5-banner-${theme}`);
  });
}
```

If Start sits behind the Options disclosure, call `openCountOptions(page)` from `./helpers` before Start, as `e2e/count-manual-pace.spec.ts:13-19` does.

- [ ] **Step 6: Run it to verify the new tests fail**

Run: `E2E_PORT=4710 npx playwright test e2e/play-glance.spec.ts --project=chromium --reporter=line`
Expected: the card tests fail on width ≥ 70 / 96 / 90 (cards are 48px today), the label test fails on 13 (10.875px today), and the skip test fails on the text `'⏩'`.

- [ ] **Step 7: Implement the felt and the styling**

- In `Table.tsx`, give `.dealer-area` the style `{ '--felt-slots': d.slots, '--felt-fixed': `${d.fixedPx}px` }` from `dealerFeltRow(game.dealerCards.length)`. Give `.hands-row` the same from `playerFeltRow(game.hands.map((h) => h.cards.length))`.
- Replace the button content `⏩` with `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="M2 3l6 5-6 5zM8 3l6 5-6 5z" fill="currentColor"/></svg>Skip`, put the SVG after the text, and keep the class and aria-label. This keeps the existing `table-seats.spec.ts`/`deal-animation.spec.ts` skip assertions valid.
- Write `cardSize.css`, append the action-label and skip rules to `tableGlance.css`, and add the import line to `PlayingCard.tsx`.

- [ ] **Step 8: Run e2e (new and neighbours)**

Run: `E2E_PORT=4710 npx playwright test e2e/play-glance.spec.ts e2e/table-seats.spec.ts e2e/deal-animation.spec.ts e2e/bot-card-pacing.spec.ts e2e/drill-layout.spec.ts e2e/count-manual-pace.spec.ts e2e/count-table.spec.ts --project=chromium --reporter=line`
Expected: PASS.

- [ ] **Step 9: Read the 8 screenshots** (`e2e/screenshots/b5-felt-*.png`, `b5-banner-*.png`)

Check: cards are big and centred; the banner is legible and doesn't overlap the peek dock; nothing sits under the top strip or mute control; no theme has a card face that disappears into the felt. Fix and re-shoot before moving on.

- [ ] **Step 10: Mutation-check**

Each must fail a test, then restore:
- (a) Remove the `cardSize.css` import. The width e2e fails.
- (b) In `playerFeltRow`, drop the `16·(hands − 1)` term. The "reserves exactly the felt chrome" unit test fails, and the 3-hand e2e wraps.
- (c) Remove the `.table-screen .action-btn` font rule. The label e2e fails.

- [ ] **Step 11: Commit**

```bash
git add src/ui/feltLayout.ts src/ui/feltLayout.test.ts src/ui/components/cardSize.css src/ui/components/PlayingCard.tsx src/ui/screens/Table.tsx src/ui/screens/tableGlance.css e2e/play-glance.spec.ts
git commit -m "feat(play): clamp-sized cards on the felt, Count drill and Pair cancellation; larger action labels; styled skip (B5/W4)"
```

---

### Task 3: Wrong-play card with one header line, gold Continue in the thumb zone, and a chart link

**Files:**
- Modify: `src/ui/components/MistakeCard.tsx`: add the prop `variant?: 'drill' | 'table'` (default `'drill'`, so the three drill call sites in `Drills.tsx` render exactly as before); the head (136-151) and actions (171-184) branch on it
- Modify: `src/ui/screens/Table.tsx`: the overlay (1100-1122) stops using `Modal`; drop the `Modal` import (36)
- Modify: `src/ui/screens/tableGlance.css` (append)
- Test: `e2e/play-glance.spec.ts` (append)

**Interfaces:**
- Consumes: `dealPlayerTurn` from Task 1.
- Produces: a `variant="table"` MistakeCard. In that variant the head reads `<span class="mistake-verdict result-wrong">Wrong play</span><span class="mistake-class">{copy.label}</span>` on one line, and "Show on chart" is `<button class="mistake-table-btn mistake-table-link">`.

The table overlay markup: `<div className="modal-backdrop wrong-play-backdrop" role="dialog" aria-modal="true" aria-label="Wrong play"><div className="wrong-play-sheet"><MistakeCard variant="table" …/><button type="button" className="overlay-continue-btn" onClick={dismissOverlay}>Continue</button></div></div>`. The classes `.modal-backdrop` and `.overlay-continue-btn` and the text "Wrong play" are kept, because `game.spec.ts:90` and `voice-table.spec.ts:130,167` select on them.

The CSS in `tableGlance.css`:
- `.wrong-play-backdrop { align-items: flex-end; padding: 0; }`
- `.wrong-play-sheet { width: 100%; max-width: 480px; background: var(--surface); border-radius: 14px 14px 0 0; padding: 0.75rem var(--space-4) calc(var(--space-3) + env(safe-area-inset-bottom, 0px)); max-height: 85svh; overflow-y: auto; }`
- `.wrong-play-sheet .overlay-continue-btn { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); min-height: 52px; font-size: 1.05rem; margin-top: 0.75rem; }`
- `.mistake-card-table .mistake-head { flex-wrap: nowrap; justify-content: flex-start; align-items: center; }`
- `.mistake-card-table .mistake-verdict { font-size: 1rem; white-space: nowrap; }`
- `.mistake-card-table .mistake-class { white-space: nowrap; }`
- `.mistake-table-link { border: none; background: none; text-decoration: underline; min-height: 44px; }`

If any text fails AA in a theme, fix its colour under `.mistake-card-table`. For the link, fall back to `color: var(--ink)` with an accent underline.

- [ ] **Step 1: Append the failing e2e**

```ts
async function makeWrongPlay(page: Page): Promise<void> {
  const bar = page.locator('.action-bar[data-advice]');
  const advice = await bar.getAttribute('data-advice');
  const enabled = bar.locator('button.action-btn:not([disabled])');
  const n = await enabled.count();
  for (let i = 0; i < n; i++) {
    if ((await enabled.nth(i).innerText()).trim().toLowerCase() !== advice) { await enabled.nth(i).click(); return; }
  }
  throw new Error('no legal wrong action');
}

function lum([r, g, b]: number[]): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
}
/** Worst-case contrast of an element's text against every background it can sit on (opaque ancestor colour plus any gradient stops on the way up). */
async function worstContrast(page: Page, sel: string): Promise<number> {
  const got = await page.locator(sel).first().evaluate((el) => {
    const nums = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
    const grounds: number[][] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      for (const m of cs.backgroundImage.match(/rgba?\([^)]+\)/g) ?? []) grounds.push(nums(m));
      const bg = nums(cs.backgroundColor);
      if (bg.length === 3 || (bg[3] ?? 0) > 0.9) { grounds.push(bg); break; }
    }
    return { color: nums(getComputedStyle(el).color), grounds };
  });
  return Math.min(...got.grounds.map((g) => { const [a, b] = [lum(got.color), lum(g)].sort((x, y) => y - x); return (a! + 0.05) / (b! + 0.05); }));
}

test('B5/W6: one header line, gold Continue below y=650, chart as a link', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'training', countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { seats: SOLO });
  await dealPlayerTurn(page);
  await makeWrongPlay(page);
  const sheet = page.locator('.wrong-play-sheet');
  await expect(sheet).toBeVisible();
  await expect(page.locator('.modal-title')).toHaveCount(0);
  await expect(sheet.locator('.mistake-verdict')).toHaveText('Wrong play');
  const v = (await sheet.locator('.mistake-verdict').boundingBox())!;
  const k = (await sheet.locator('.mistake-class').boundingBox())!;
  expect(Math.abs(v.y + v.height / 2 - (k.y + k.height / 2))).toBeLessThanOrEqual(4);
  expect((await sheet.locator('.mistake-head').boundingBox())!.height).toBeLessThanOrEqual(36);
  const cont = page.getByRole('button', { name: 'Continue', exact: true });
  const box = (await cont.boundingBox())!;
  expect(box.y).toBeGreaterThan(650);
  expect(box.y + box.height).toBeLessThanOrEqual(812);
  expect(box.height).toBeGreaterThanOrEqual(48);
  const { bg, accent } = await cont.evaluate((el) => {
    const probe = document.createElement('div'); probe.style.color = 'var(--accent)'; document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color; probe.remove();
    return { bg: getComputedStyle(el).backgroundColor, accent };
  });
  expect(bg).toBe(accent);
  const link = sheet.getByRole('button', { name: 'Show on chart', exact: true });
  await expect(link).toBeVisible();
  expect(await link.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await cont.click();
  await expect(sheet).toHaveCount(0);
});

for (const theme of THEMES) {
  test(`B5/W6: ${theme}: the wrong-play card passes AA`, async ({ page }) => {
    await withSettings(page, { theme, feedbackMode: 'training', countCheckEvery: 0, dealSpeedMs: 0 });
    await withProfile(page, { seats: SOLO });
    await dealPlayerTurn(page);
    await makeWrongPlay(page);
    for (const sel of ['.mistake-verdict', '.mistake-class', '.mistake-play-role', '.mistake-play-value', '.mistake-tc', '.mistake-table-link', '.overlay-continue-btn']) {
      const ratio = await worstContrast(page, `.wrong-play-sheet ${sel}`);
      expect(ratio, `${theme} ${sel} ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
    await shot(page, `b5-wrong-play-${theme}`);
  });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `E2E_PORT=4710 npx playwright test e2e/play-glance.spec.ts -g "W6" --project=chromium --reporter=line`
Expected: FAIL, because `.wrong-play-sheet` is missing.

- [ ] **Step 3: Implement the variant and the docked sheet** as specified above. In the `'table'` variant, add the class `mistake-card-table` to the root.

- [ ] **Step 4: Run W6 plus the specs that touch the overlay and the drills' MistakeCard**

Run: `E2E_PORT=4710 npx playwright test e2e/play-glance.spec.ts e2e/game.spec.ts e2e/voice-table.spec.ts e2e/correction-chart.spec.ts e2e/chart-note.spec.ts e2e/wrong-tap.spec.ts --project=chromium --reporter=line`
Expected: PASS. The drills' panels are unchanged. `voice-table.spec.ts:163` still proves that "yes" dismisses the card.

- [ ] **Step 5: Read the 4 `b5-wrong-play-*.png` screenshots**

Check that the sheet is docked at the bottom with the hands visible above, Continue is the only gold button, and nothing is clipped.

- [ ] **Step 6: Mutation-check**

Each must fail, then restore:
- (a) Revert to `<Modal title="Wrong play">`. The `y > 650` and `.modal-title` assertions fail.
- (b) Remove the gold rule. The `bg === accent` assertion fails.
- (c) Set `.mistake-card-table .mistake-class { color: var(--ink-faint) }`. The AA test fails in at least one theme.

- [ ] **Step 7: Commit**

```bash
git add src/ui/components/MistakeCard.tsx src/ui/screens/Table.tsx src/ui/screens/tableGlance.css e2e/play-glance.spec.ts
git commit -m "feat(play): wrong-play sheet with one header line, gold Continue in thumb zone, chart link (B5/W6)"
```

---

### Task 4: Report figures: hands played, sections, cost sorting and per-100 helpers

**Files:**
- Create: `src/ui/reportSections.ts`, `src/ui/reportSections.test.ts`, `src/ui/sessionFigures.ts`, `src/ui/sessionFigures.test.ts`
- Modify: `src/engine/game.ts`: add the public field `handsPlayed = 0` next to `roundNo` (198), and `this.handsPlayed += this.hands.length;` at the top of `finishRound()` (1298)
- Modify: `src/engine/game.test.ts` (append)
- Modify: `src/store/types.ts`: append to the `sessions` row (575-594) `hands?: number; mistakeUnits?: number;` with a comment (Wave B, B6; absent on older rows, which the per-100 figure skips)
- Modify: `src/ui/useGame.ts`: `SessionReport` (87-102) gains `hands: number; mistakeUnits: number`; `buildReport` (138-170) takes `hands` and computes `mistakeUnits`; `endSession` (674-710) writes `hands: game.handsPlayed, mistakeUnits` on the session row

**Interfaces:**
- Produces (in `reportSections.ts`):
  - `interface MistakeRow { mistake: GradedEvent; count: number; unitsTotal: number | null; cellId: string | null }`
  - `groupMistakes(mistakes: readonly GradedEvent[]): MistakeRow[]`, moved from `Table.tsx:228-243` with the same key
  - `reportSections(mistakes: readonly GradedEvent[]): { plays: MistakeRow[]; counts: MistakeRow[]; bets: MistakeRow[] }`. Plays are `action` and `insurance`, sorted by `unitsTotal` descending, with priced rows first and unpriced rows after them in first-seen order. Counts are `countCheck`. Bets are `bet` rows then `wong` rows.
  - `countMissText(m: GradedEvent): string`
  - `drillCellIds(rows: readonly MistakeRow[]): string[]`: unique `cellId`s in row order
  - `mistakeUnits(events: readonly GradedEvent[]): number`: the sum of `evCost`
  - `cellId` is `tallyCellIdFor(m)` (from `src/store/stats.ts`, so deviation-tagged events get `null`), kept only if it is in `ALL_PAINT_CELL_IDS` (from `src/drills/cellSelection.ts`).
- Produces (in `sessionFigures.ts`, where `type SessionRow = Stats['sessions'][number]`):
  - `lossPer100(units: number, hands: number): number | null`
  - `formatLossPer100(loss: number): string`
  - `sessionsLossPer100(rows: readonly SessionRow[]): number | null`
  - `sessionTag(row: SessionRow): string | null` (returns `'Hot shoe'` once Task 8 adds the field; until then it reads `(row as { hotShoe?: true }).hotShoe`)
- Produces: `Game.handsPlayed: number`, and `SessionReport.hands` and `SessionReport.mistakeUnits`.

- [ ] **Step 1: Write the failing tests**

`src/ui/reportSections.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { GradedEvent } from '../engine/grade';
import { reportSections, countMissText, drillCellIds, mistakeUnits, groupMistakes } from './reportSections';

const ev = (p: Partial<GradedEvent> & Pick<GradedEvent, 'kind'>): GradedEvent => ({
  category: 'hard', correct: false, classification: 'basic-error', taken: 'hit', expected: 'stand', reason: 'r', tc: 0, source: 'table', ...p,
});

describe('reportSections (B6/W12)', () => {
  it('plays, count checks and bets land in separate sections', () => {
    const s = reportSections([
      ev({ kind: 'countCheck', category: 'countCheck', taken: '2', expected: '0', reason: 'Running count check' }),
      ev({ kind: 'action', hand: '10,6 v 10', evCost: 0.1 }),
      ev({ kind: 'wong', category: 'wong', taken: 'play', expected: 'sit-out' }),
      ev({ kind: 'bet', category: 'bet', taken: '4', expected: '1' }),
      ev({ kind: 'insurance', category: 'insurance', taken: 'take', expected: 'decline' }),
    ]);
    expect(s.plays.map((r) => r.mistake.kind)).toEqual(['action', 'insurance']);
    expect(s.counts.map((r) => r.mistake.kind)).toEqual(['countCheck']);
    expect(s.bets.map((r) => r.mistake.kind)).toEqual(['bet', 'wong']);
  });
  it('plays are sorted by units lost; unpriced rows follow in the order they happened', () => {
    const s = reportSections([
      ev({ kind: 'action', hand: '9,3 v 4', taken: 'stand', expected: 'hit', classification: 'missed-deviation', deviationId: 'x' as GradedEvent['deviationId'] }),
      ev({ kind: 'action', hand: '10,6 v 10', evCost: 0.05 }),
      ev({ kind: 'action', hand: '8,8 v 4', taken: 'hit', expected: 'split', evCost: 0.61 }),
      ev({ kind: 'action', hand: 'A,7 v 9', taken: 'stand', expected: 'hit', evCost: 0.2 }),
    ]);
    expect(s.plays.map((r) => r.mistake.hand)).toEqual(['8,8 v 4', 'A,7 v 9', '10,6 v 10', '9,3 v 4']);
    expect(s.plays.map((r) => r.unitsTotal)).toEqual([0.61, 0.2, 0.05, null]);
  });
  it('a repeated mistake is one row whose cost is the total', () => {
    const rows = groupMistakes([ev({ kind: 'action', hand: '8,8 v 4', evCost: 0.3 }), ev({ kind: 'action', hand: '8,8 v 4', evCost: 0.3 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 2, unitsTotal: 0.6 });
  });
});

describe('countMissText (B6: RC off by N)', () => {
  it('says how far off the running and true counts were, with real minus signs', () => {
    expect(countMissText(ev({ kind: 'countCheck', taken: '2', expected: '0', reason: 'Running count check' }))).toBe('RC off by 2 · you said +2 · it was 0');
    expect(countMissText(ev({ kind: 'countCheck', taken: '-1', expected: '2', reason: 'True count check' }))).toBe('TC off by 3 · you said −1 · it was +2');
  });
  it('an unanswered check says so instead of "off by NaN"', () => {
    expect(countMissText(ev({ kind: 'countCheck', taken: '', expected: '-4', reason: 'Running count check' }))).toBe('RC not answered · it was −4');
  });
});

describe('drillCellIds (B6: Drill these hands)', () => {
  it('one id per chart cell, in report order, two hands on one cell collapse', () => {
    const rows = reportSections([
      ev({ kind: 'action', hand: '8,8 v 4', evCost: 0.6 }),
      ev({ kind: 'action', hand: '10,6 v 10', evCost: 0.1 }),
      ev({ kind: 'action', hand: '9,7 v K', evCost: 0.1, taken: 'stand', expected: 'hit' }),
    ]).plays;
    expect(drillCellIds(rows)).toEqual(['pair-8-v-4', 'hard-16-v-10']);
  });
  it('leaves out index plays, insurance and cells the Custom grid has no row for', () => {
    const rows = reportSections([
      ev({ kind: 'action', hand: '10,2 v 3', deviationId: 'i' as GradedEvent['deviationId'], classification: 'missed-deviation' }),
      ev({ kind: 'insurance', category: 'insurance', taken: 'take', expected: 'decline' }),
      ev({ kind: 'action', hand: '10,6,4 v 6', taken: 'hit', expected: 'stand', evCost: 0.8 }),
    ]).plays;
    expect(drillCellIds(rows)).toEqual([]);
  });
});

it('mistakeUnits adds priced mistakes only', () => {
  expect(mistakeUnits([ev({ kind: 'action', evCost: 0.5 }), ev({ kind: 'action', evCost: 0.25 }), ev({ kind: 'action' }), ev({ kind: 'bet', correct: true })])).toBeCloseTo(0.75);
});
```

`src/ui/sessionFigures.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { lossPer100, formatLossPer100, sessionsLossPer100, sessionTag } from './sessionFigures';

const row = (extra: Record<string, unknown> = {}) => ({ date: '2026-10-17', rounds: 10, graded: 10, correct: 9, bankrollDelta: 0, ...extra });

describe('per-100 figure (B6/W12)', () => {
  it('is units lost per 100 hands, and null with no hands', () => {
    expect(lossPer100(0.75, 30)).toBeCloseTo(2.5);
    expect(lossPer100(0, 40)).toBe(0);
    expect(lossPer100(1, 0)).toBeNull();
  });
  it('reads as the spec words it', () => {
    expect(formatLossPer100(2.5)).toBe('−2.50 u lost to mistakes per 100 hands');
    expect(formatLossPer100(0)).toBe('0 u lost to mistakes per 100 hands');
    expect(formatLossPer100(0.004)).toBe('Under 0.01 u lost to mistakes per 100 hands');
  });
  it('pools sessions that recorded it, skips older rows, and keeps Hot shoe rows (skill, not luck)', () => {
    expect(sessionsLossPer100([row({ hands: 50, mistakeUnits: 1 }), row({ hands: 50, mistakeUnits: 0.5, hotShoe: true }), row()])).toBeCloseTo(1.5);
    expect(sessionsLossPer100([row(), row()])).toBeNull();
    expect(sessionsLossPer100([])).toBeNull();
  });
  it('tags Hot shoe rows', () => {
    expect(sessionTag(row({ hotShoe: true }))).toBe('Hot shoe');
    expect(sessionTag(row())).toBeNull();
  });
});
```

Append to `src/engine/game.test.ts`:

```ts
describe('handsPlayed (B6)', () => {
  it('counts each settled player hand, splits included, and nothing for a sit-out', () => {
    const one = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '8', '5'));
    one.startRound(); one.act('hit'); one.act('stand');
    expect(one.handsPlayed).toBe(1);

    const split = Game.withRiggedShoe(cfg(), rig('8', '9', '8', '7', '10', '10', '10', '10', '10'));
    split.startRound(); split.act('split');
    while (split.phase === 'player') split.act('stand');
    expect(split.handsPlayed).toBe(2);

    const sat = new Game(cfg({ seed: 5 }));
    sat.sitOut();
    expect(sat.handsPlayed).toBe(0);
  });
});
```

If the rig does not leave `8,8 v 9` splittable under the default rules, pick another pair and upcard that `basicPlay` splits. The assertion is the same.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/ui/reportSections.test.ts src/ui/sessionFigures.test.ts src/engine/game.test.ts`
Expected: FAIL, with the modules missing and `handsPlayed` undefined.

- [ ] **Step 3: Implement both modules, `handsPlayed`, the session-row fields and the `SessionReport` fields**

- `formatLossPer100` uses `MINUS` from `src/drills/signed.ts` and `toFixed(2)`. When `0 < loss < 0.005` it returns the "Under 0.01" form.
- `buildReport(events, bankrollDelta, peeks, hands)` sets `hands` and `mistakeUnits: mistakeUnits(events)`.
- On the session row, write `mistakeUnits` rounded to 4 decimals.
- `Table.tsx` keeps importing nothing new yet. Its local `groupMistakes` is deleted in Task 5, when the report UI starts using `reportSections`.

- [ ] **Step 4: Run them to verify they pass, then run the whole suite**

Run: `npx vitest run`
Expected: PASS. The `persist`/`stats` suites are unaffected because the session fields are optional.

- [ ] **Step 5: Mutation-check**

Each must fail, then restore:
- (a) Flip the sort comparator. The sort test fails.
- (b) Make `lossPer100` return `units / hands` without `* 100`. It fails.
- (c) Drop the `ALL_PAINT_CELL_IDS` filter. `drillCellIds` gets `hard-20-v-6` and fails.
- (d) Remove the `finishRound` increment. `handsPlayed` fails.

- [ ] **Step 6: Commit**

```bash
git add src/ui/reportSections.ts src/ui/reportSections.test.ts src/ui/sessionFigures.ts src/ui/sessionFigures.test.ts src/engine/game.ts src/engine/game.test.ts src/store/types.ts src/ui/useGame.ts
git commit -m "feat(play): report figures: hands played, sections sorted by cost, per-100 helper (B6/W12)"
```

---

### Task 5: Session report UI: headline, Plays / Count checks / Bets, RC off by N

**Files:**
- Create: `src/ui/screens/sessionReport.css`
- Modify: `src/ui/screens/Table.tsx`: `ReportScreen` (248-341); delete the local `groupMistakes` (217-243) and use `reportSections`
- Modify: `e2e/game.spec.ts:450-452`: the count row now reads `RC off by …`
- Create: `e2e/play-report.spec.ts`

**Interfaces:**
- Consumes: from Task 4, `reportSections`, `countMissText`, `lossPer100`, `formatLossPer100`, and `SessionReport.hands` and `.mistakeUnits`.
- Produces the DOM hooks Tasks 6 and 8 use:
  - `.report-headline[data-units-total][data-hands]`
  - `<h2>Plays</h2>` with `ul.report-mistakes.report-plays`, each `li` carrying `data-units` (when priced) and `data-cell` (when it has a cell)
  - `<h2>Count checks</h2>` with `ul.report-mistakes.report-counts`, rendered only when the session graded a count check
  - `<h2>Bets</h2>` with `ul.report-mistakes.report-bets`, rendered only when it has rows
  - `.report-unpriced`
  - `.report-summary`, keeping the text `N / M correct · bankroll ±x`

The report layout, top to bottom:
1. `h1` Session report.
2. The headline (`formatLossPer100`), omitted when `hands === 0`.
3. `.report-unpriced`, "Plus N index or insurance misses with no price.", shown only when some play rows are unpriced.
4. `.report-summary`, then the assisted and cover lines unchanged.
5. The categories table.
6. Plays. Each row: `{hand} · TC {±} · you played {X} · correct {Y} — {reason}`, then ` ×n`, then ` · −0.61 u` when priced. Empty: "No play mistakes."
7. Count checks. Each row: `countMissText`. Empty: "No count checks missed."
8. Bets: the existing bet/wong copy.
9. Back to Home.

In `sessionReport.css`: `.report-headline { font-size: 1.25rem; font-weight: 800; color: var(--ink); }` and `.report-unpriced { font-size: 0.8rem; color: var(--ink-dim); }`.

- [ ] **Step 1: Write the failing e2e** `e2e/play-report.spec.ts`

```ts
import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, resolveInsurance, shot } from './helpers';

test.use({ viewport: { width: 375, height: 812 } });

/** Plays a dealt round, taking the first legal non-advised action once. */
export async function playRoundWithOneMistake(page: Page): Promise<void> {
  let mistaken = false;
  for (let guard = 0; guard < 30; guard++) {
    if (await resolveInsurance(page, false)) continue;
    const bar = page.locator('.action-bar[data-advice]');
    if (!(await bar.isVisible().catch(() => false))) return;
    const advice = (await bar.getAttribute('data-advice'))!;
    const enabled = bar.locator('button.action-btn:not([disabled])');
    if (!mistaken) {
      for (let i = 0; i < (await enabled.count()); i++) {
        const t = (await enabled.nth(i).innerText()).trim();
        if (t.toLowerCase() !== advice) { mistaken = true; await enabled.nth(i).click(); break; }
      }
      if (mistaken) continue;
    }
    await bar.getByRole('button', { name: advice.charAt(0).toUpperCase() + advice.slice(1), exact: true }).click();
  }
  throw new Error('round did not settle');
}

export async function endWithReport(page: Page): Promise<void> {
  await page.locator('.end-btn').click();
  await page.locator('.end-btn').click();
}

test('B6: plays and count checks are separate, plays sorted by cost, headline is u lost per 100 hands', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  // Basic grading only, so every play mistake is a priced basic error; one check, asked at End.
  await withProfile(page, { gradeDeviations: false, countCheckEvery: 3, countCheckAsk: 'running' });
  await page.goto('/?seed=4&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  for (let r = 0; r < 3; r++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await playRoundWithOneMistake(page);
  }
  await endWithReport(page);
  const sheet = page.locator('.bottom-sheet');
  await expect(sheet.locator('.bottom-sheet-title')).toHaveText('Running count?');
  for (const k of ['3', '0', 'OK']) await sheet.getByRole('button', { name: k, exact: true }).click(); // +30: impossible after 3 rounds
  await expect(page.locator('.report-screen')).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Plays', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Count checks', exact: true })).toBeVisible();
  await expect(page.locator('.report-counts li')).toHaveCount(1);
  await expect(page.locator('.report-counts li')).toHaveText(/^RC off by \d+ · you said \+30 · it was (0|[+−]\d+)$/);
  await expect(page.locator('.report-plays')).not.toContainText('count');

  const units = await page.locator('.report-plays li[data-units]').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.units)));
  expect(units.length, 'need two priced rows to check the order').toBeGreaterThanOrEqual(2);
  expect([...units].sort((a, b) => b - a)).toEqual(units);

  const head = page.locator('.report-headline');
  await expect(head).toHaveText(/^(−\d+\.\d\d u|0 u|Under 0\.01 u) lost to mistakes per 100 hands$/);
  const total = Number(await head.getAttribute('data-units-total'));
  const hands = Number(await head.getAttribute('data-hands'));
  expect(hands).toBeGreaterThanOrEqual(3);
  expect(total).toBeCloseTo(units.reduce((a, b) => a + b, 0), 3);
  const shown = Number((await head.innerText()).replace('−', '').split(' ')[0]);
  if (!Number.isNaN(shown)) expect(shown).toBeCloseTo((total / hands) * 100, 2);
  await expect(page.locator('.report-screen')).not.toContainText(/per hour/i);
  await shot(page, 'b6-report');
});

test('B6: a session that only sat out shows no per-100 headline', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  await withProfile(page, { betSpreadOn: true, countCheckEvery: 0 });
  await page.goto('/?seed=4&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Sit out', exact: true }).click();
  await endWithReport(page);
  await expect(page.locator('.report-screen')).toBeVisible();
  await expect(page.locator('.report-headline')).toHaveCount(0);
  await expect(page.locator('.report-screen')).not.toContainText(/NaN|Infinity/);
});
```

If seed 4 does not give two distinct priced rows, step the seed (5, 6, …) until it does, and record the seed in a comment. The vacuity guard stops the test from passing silently.

- [ ] **Step 2: Run it to verify it fails**

Run: `E2E_PORT=4710 npx playwright test e2e/play-report.spec.ts --project=chromium --reporter=line`
Expected: FAIL, with no "Plays" heading.

- [ ] **Step 3: Implement the report layout** above in `ReportScreen`. Format the priced cost with `signed(-unitsTotal)` (two decimals). Update `game.spec.ts:450-452` to `/^RC off by \d+ · you said \+2 · it was (0|[+−]\d+)$/`.

- [ ] **Step 4: Run the report specs**

Run: `E2E_PORT=4710 npx playwright test e2e/play-report.spec.ts e2e/game.spec.ts e2e/cycle1.spec.ts e2e/play-persistence.spec.ts e2e/play-bankroll.spec.ts e2e/layout-guard.spec.ts --project=chromium --reporter=line`
Expected: PASS. `game.spec.ts:879`'s grouped-wong count still holds, because every list keeps `.report-mistakes` and `.report-mistake-count`.

- [ ] **Step 5: Read `e2e/screenshots/b6-report.png`**

Check that the headline is the first thing under the title, the sections are clearly separated, nothing is clipped, and nothing is under the mute control.

- [ ] **Step 6: Mutation-check**

Each must fail, then restore:
- (a) Render `report.mistakes` in one list. The heading and count-isolation assertions fail.
- (b) Render without `reportSections`' sort. The order assertion fails.
- (c) Render the headline when `hands === 0`. The sit-out test fails.

- [ ] **Step 7: Commit**

```bash
git add src/ui/screens/Table.tsx src/ui/screens/sessionReport.css e2e/play-report.spec.ts e2e/game.spec.ts
git commit -m "feat(play): session report leads with u lost per 100 hands; plays, count checks and bets apart (B6/W12)"
```

---

### Task 6: "Drill these hands" opens Custom with exactly the missed cells

**Files:**
- Modify: `src/ui/drillLaunch.ts`: append (contract 4, additive only)
- Modify: `src/ui/drillLaunch.test.ts`: append
- Modify: `src/ui/screens/Table.tsx`: `ReportScreen` gains `onDrill?: (cellIds: string[]) => void`; the button sits under the Plays list; the handler sits next to `handleReportDone` (693-696)
- Test: `e2e/play-report.spec.ts` (append)

**Interfaces:**
- Consumes: `drillCellIds` (Task 4), `ALL_PAINT_CELL_IDS` and `autoTiers` (`src/drills/cellSelection.ts`), `saveSettings` (`src/store/persist.ts`), and `setDrillLaunch`.
- Produces: `customCellsSettings(cellIds: readonly string[], settings: Settings): Settings`, which is pure, and `launchCustomCells(cellIds: readonly string[], settings: Settings): Settings`, which saves, sets the launch to `'custom'`, and returns the settings.

Why this survives Auto: `Drills.tsx` opens Custom with `autoOnOpen` when the launch is `'custom'` (Drills.tsx:3072). Auto (`autoTiers`) never touches a cell marked `painted`. So the selection marks **every** cell in `ALL_PAINT_CELL_IDS` as painted: the missed cells are `'focus'` and every other cell is Off (no tier). The existing `mix` and `favourMissed` are kept. That needs no change to lane D's `Drills.tsx` or to `CustomDrillEditor`.

Table handler: `const next = launchCustomCells(ids, settings); onSettingsChange(next); setShowReport(false); onNavigate('drills');`. The button reads "Drill these hands" and has class `report-drill-btn`, with min-height 48px and the secondary style, in `sessionReport.css`. It renders only when `drillCellIds(plays).length > 0`.

- [ ] **Step 1: Write the failing unit test** (append to `src/ui/drillLaunch.test.ts`)

```ts
import { ALL_PAINT_CELL_IDS, autoTiers } from '../drills/cellSelection';
import { customCellsSettings, launchCustomCells } from './drillLaunch';
import { loadSettings } from '../store/persist';

describe('customCellsSettings (B6: Drill these hands)', () => {
  const ids = ['pair-8-v-4', 'hard-16-v-10'];
  it('paints exactly those cells Focus and every other cell Off', () => {
    const sel = customCellsSettings(ids, structuredClone(DEFAULT_SETTINGS)).drill.custom!;
    expect(Object.keys(sel.tiers).sort()).toEqual([...ids].sort());
    expect(Object.values(sel.tiers).every((t) => t === 'focus')).toBe(true);
  });
  it('survives the Auto that a Custom launch applies', () => {
    const sel = customCellsSettings(ids, structuredClone(DEFAULT_SETTINGS)).drill.custom!;
    const weak = Object.fromEntries(ALL_PAINT_CELL_IDS.map((id) => [id, { right: 0, wrong: 9, lastAt: '' }]));
    expect(autoTiers(ALL_PAINT_CELL_IDS, weak, sel.painted, sel.tiers)).toEqual(sel.tiers);
  });
  it('keeps the mix and the favour-missed toggle', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.drill.custom = { tiers: {}, painted: {}, mix: { focus: 80, regular: 15, rare: 5 }, favourMissed: true };
    expect(customCellsSettings(ids, s).drill.custom).toMatchObject({ mix: { focus: 80, regular: 15, rare: 5 }, favourMissed: true });
  });
  it('launch saves it and hands Custom across once', () => {
    const next = launchCustomCells(ids, structuredClone(DEFAULT_SETTINGS));
    expect(loadSettings().drill.custom).toEqual(next.drill.custom);
    expect(takeDrillLaunch()).toBe('custom');
    expect(takeDrillLaunch()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ui/drillLaunch.test.ts`
Expected: FAIL, because `customCellsSettings` is not exported.

- [ ] **Step 3: Implement both functions** in `drillLaunch.ts`, with a header comment naming contract 4. Leave `launchSettings` untouched.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/ui/drillLaunch.test.ts`
Expected: PASS.

- [ ] **Step 5: Append the failing e2e** to `e2e/play-report.spec.ts`

```ts
test('B6: Drill these hands opens Custom with exactly the missed cells as Focus', async ({ page }) => {
  await withSettings(page, { feedbackMode: 'test', dealSpeedMs: 0 });
  await withProfile(page, { gradeDeviations: false, countCheckEvery: 0 });
  await page.goto('/?seed=4&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  for (let r = 0; r < 3; r++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await playRoundWithOneMistake(page);
  }
  await endWithReport(page);
  const cells = await page.locator('.report-plays li[data-cell]').evaluateAll((els) =>
    [...new Set(els.map((e) => (e as HTMLElement).dataset.cell!))].sort());
  expect(cells.length).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Drill these hands', exact: true }).click();
  await expect(page.getByTestId('cde-counts')).toHaveText(`${cells.length} Focus · 0 Regular · 0 Rare · ${330 - cells.length} Off`);
  const focus = await page.locator('.cpg-cell[data-tier="focus"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.cell!).sort());
  expect(focus).toEqual(cells);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1')!).drill.custom.tiers);
  expect(Object.keys(stored).sort()).toEqual(cells);
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `E2E_PORT=4710 npx playwright test e2e/play-report.spec.ts -g "Drill these hands" --project=chromium --reporter=line`
Expected: FAIL, because the button is missing.

- [ ] **Step 7: Add the button and handler** to `Table.tsx`.

- [ ] **Step 8: Run it plus the Custom specs**

Run: `E2E_PORT=4710 npx playwright test e2e/play-report.spec.ts e2e/custom-drill-editor.spec.ts e2e/custom-persist.spec.ts e2e/next-step.spec.ts --project=chromium --reporter=line`
Expected: PASS.

- [ ] **Step 9: Mutation-check**

Each must fail, then restore:
- (a) Mark only the Focus cells as painted. The unit "survives Auto" test fails, and the e2e counts show Regular/Rare cells.
- (b) Skip `saveSettings`. The unit launch test fails.

- [ ] **Step 10: Commit**

```bash
git add src/ui/drillLaunch.ts src/ui/drillLaunch.test.ts src/ui/screens/Table.tsx src/ui/screens/sessionReport.css e2e/play-report.spec.ts
git commit -m "feat(play): Drill these hands opens Custom on exactly the report's missed cells (B6, contract 4)"
```

---

### Task 7: Hot shoe engine, a weighted permutation of a full shoe

**Files:**
- Create: `src/engine/shoeBias.ts`, `src/engine/shoeBias.test.ts`
- Modify: `src/engine/cards.ts`: the `Shoe` constructor options (74) gain `order?: (cards: Card[], rng: () => number) => Card[]`; `buildShoe` (111) returns `(this.order ?? fisherYatesShuffle)(cards, this.rng)`. Nothing else changes: no `order` means the same calls on the same rng, so the cards are byte-identical.
- Modify: `src/engine/game.ts`: `GameConfig` (57-96) appends `hotShoe?: boolean`; the constructor (291) passes `order: cfg.hotShoe ? hotShoeOrder : undefined`
- Modify: `src/ui/playConfig.ts`: `...(profile.hotShoe ? { hotShoe: true } : {})`; `src/ui/playConfig.test.ts` (append)
- Modify: `src/store/types.ts`: `Profile` appends `hotShoe?: boolean` with a comment (B8, opt-in, absent = off)

**Interfaces:**
- Produces: `HOT_SHOE_WEIGHT = 1.06`, `hotShoeOrder(cards: readonly Card[], rng: () => number, weight = HOT_SHOE_WEIGHT): Card[]`, `hotShoeActive(cfg: { hotShoe?: boolean }, rigged: boolean): boolean`, `GameConfig.hotShoe`, `Profile.hotShoe`.

**The biasing method.** This is a weighted random permutation (Efraimidis–Spirakis):
- Each card gets the key `ln(u) / w`, where `u = 1 − rng()` lies in (0, 1]. The weight `w` is `HOT_SHOE_WEIGHT` for Hi-Lo +1 ranks (2–6), `1 / HOT_SHOE_WEIGHT` for −1 ranks (10–A), and 1 for 7–9.
- Sort by key, descending.

Low cards then tend to come out earlier, so the running count climbs through the dealt part of the shoe and the true count is positive more often. The method only **reorders** the exact list of cards it is given: 52 × decks cards, 4 × decks of each rank per suit set, none added, removed or duplicated. So the shoe stays a legal set of cards. Hi-Lo is balanced, so the count still returns to 0 at the end. The cut card, penetration, rigged shoes and the bot rng are untouched. A weight of 1 is an ordinary uniform shuffle.

The weight was picked with a scratch simulation (seeds 1–200, 6 decks, 75% penetration, a TC sample every 5 cards before the cut):

| | TC +2..+5 | TC ≥ +6 | TC ≤ −2 |
|---|---|---|---|
| fair shoe | 15.1% | 1.6% | 25.2% |
| hot shoe at 1.06 | 27.7% | 5.9% | 11.8% |

The hot shoe nearly doubles the practice band without becoming a fantasy shoe. Weights of 1.2 or more push TC ≥ +6 past 25%.

- [ ] **Step 1: Write the failing tests** `src/engine/shoeBias.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { Shoe, RANKS, mulberry32, type Card } from './cards';
import { hiLoTag, trueCount } from './count';
import { hotShoeOrder, hotShoeActive } from './shoeBias';
import { Game, DEFAULT_SPREAD } from './game';

const SUITS = ['s', 'h', 'd', 'c'] as const;
const freshDeck = (decks: number): Card[] =>
  Array.from({ length: decks }).flatMap(() => SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit }))));
const key = (c: Card) => `${c.rank}${c.suit}`;
const drawN = (s: { draw(): Card }, n: number) => Array.from({ length: n }, () => key(s.draw()));
type Order = (cards: Card[], rng: () => number) => Card[];

function tcShares(order: Order | undefined, decks: number, penetration: number, seeds = 200) {
  let n = 0, mid = 0, high = 0, low = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const shoe = new Shoe({ decks, penetration, seed, order });
    let rc = 0;
    while (!shoe.cutCardReached) {
      rc += hiLoTag(shoe.draw().rank);
      if (shoe.cardsDealt % 5 === 0) {
        const tc = trueCount(rc, shoe.decksRemaining);
        n++; if (tc >= 2 && tc <= 5) mid++; if (tc >= 6) high++; if (tc <= -2) low++;
      }
    }
  }
  return { mid: mid / n, high: high / n, low: low / n };
}

describe('hotShoeOrder keeps the shoe a legal set of cards (B8)', () => {
  it('is a permutation of exactly the cards it was given, for every seed, and leaves its input alone', () => {
    const deck = freshDeck(6);
    const before = deck.map(key);
    for (let seed = 1; seed <= 50; seed++) {
      const out = hotShoeOrder(deck, mulberry32(seed));
      expect(out).toHaveLength(312);
      expect(out.map(key).sort()).toEqual([...before].sort());
    }
    expect(deck.map(key)).toEqual(before);
  });
  it('a hot Shoe deals 24 of every rank per full 6-deck shoe, before and after shuffle()', () => {
    const shoe = new Shoe({ decks: 6, seed: 7, order: hotShoeOrder });
    for (let pass = 0; pass < 2; pass++) {
      const counts = new Map<string, number>();
      for (let i = 0; i < 312; i++) { const r = shoe.draw().rank; counts.set(r, (counts.get(r) ?? 0) + 1); }
      for (const r of RANKS) expect(counts.get(r)).toBe(24);
      shoe.shuffle();
    }
  });
});

describe('Hot shoe true-count distribution (fixed seeds 1..200)', () => {
  const normal6 = tcShares(undefined, 6, 0.75);
  const hot6 = tcShares(hotShoeOrder, 6, 0.75);
  it('a normal 6-deck shoe sits where a fair shoe does', () => {
    expect(normal6.mid).toBeGreaterThan(0.12);
    expect(normal6.mid).toBeLessThan(0.18);
    expect(normal6.high).toBeLessThan(0.03);
  });
  it('the hot shoe makes TC +2..+5 at least 1.5x as common, over 23% of points', () => {
    expect(hot6.mid).toBeGreaterThan(0.23);
    expect(hot6.mid).toBeGreaterThanOrEqual(1.5 * normal6.mid);
  });
  it('stays mild: TC +6 or more under 9%, negative counts still happen but less', () => {
    expect(hot6.high).toBeLessThan(0.09);
    expect(hot6.low).toBeGreaterThan(0.05);
    expect(hot6.low).toBeLessThan(normal6.low);
  });
  it('holds for 8 decks too', () => {
    expect(tcShares(hotShoeOrder, 8, 0.8).mid).toBeGreaterThanOrEqual(1.5 * tcShares(undefined, 8, 0.8).mid);
  });
});

describe('the normal shoe is unchanged (B8)', () => {
  const base = { penetration: 0.75, betSpreadOn: false, spread: DEFAULT_SPREAD, bankrollStart: 100, countCheckEvery: 0, seed: 42 };
  it('seed 42 deals the same first 12 cards as before Wave B', () => {
    expect(drawN(new Shoe({ decks: 6, seed: 42 }), 12)).toEqual(['5s', '4s', '9d', '10s', '5d', '2c', '6d', '9h', '3d', 'Ks', '3s', 'Js']);
  });
  it('a Game without hotShoe, or with it false, deals that same shoe', () => {
    const plain = drawN(new Shoe({ decks: 6, seed: 42 }), 40);
    expect(drawN(new Game(base).shoe, 40)).toEqual(plain);
    expect(drawN(new Game({ ...base, hotShoe: false }).shoe, 40)).toEqual(plain);
  });
  it('a Game with hotShoe deals the biased order for the same seed', () => {
    const hot = drawN(new Game({ ...base, hotShoe: true }).shoe, 40);
    expect(hot).toEqual(drawN(new Shoe({ decks: 6, seed: 42, order: hotShoeOrder }), 40));
    expect(hot).not.toEqual(drawN(new Shoe({ decks: 6, seed: 42 }), 40));
  });
  it('a rigged (Losing) shoe is never a hot shoe', () => {
    expect(hotShoeActive({ hotShoe: true }, false)).toBe(true);
    expect(hotShoeActive({ hotShoe: true }, true)).toBe(false);
    expect(hotShoeActive({}, false)).toBe(false);
  });
});
```

Append to `src/ui/playConfig.test.ts`:

```ts
it('B8: carries hotShoe only when it is on', () => {
  expect(playConfigFor({ ...base, hotShoe: true }, 100, 1).hotShoe).toBe(true);
  expect('hotShoe' in playConfigFor({ ...base, hotShoe: false }, 100, 1)).toBe(false);
  expect('hotShoe' in playConfigFor(base, 100, 1)).toBe(false);
});
```

- [ ] **Step 2: Run the characterization test on unchanged `main` code first**

Do this before writing any implementation. Comment out the import of `./shoeBias` and every test that uses it, then run `npx vitest run src/engine/shoeBias.test.ts -t "first 12 cards"`.
Expected: PASS. That proves the pinned cards really are today's shoe. Then restore the file.

- [ ] **Step 3: Run the full file to verify it fails**

Run: `npx vitest run src/engine/shoeBias.test.ts src/ui/playConfig.test.ts`
Expected: FAIL, because `./shoeBias` is missing.

- [ ] **Step 4: Implement** `shoeBias.ts` (the method above; `hotShoeActive = cfg.hotShoe === true && !rigged`), the `Shoe` option, `GameConfig.hotShoe` and the constructor wiring, `playConfig`, and the `Profile` field.

- [ ] **Step 5: Run the tests to verify they pass, plus the engine suite**

Run: `npx vitest run src/engine src/ui/playConfig.test.ts`
Expected: PASS. `cards.test.ts`'s same-seed tests still pass.

- [ ] **Step 6: Mutation-check**

Each must fail, then restore:
- (a) `HOT_SHOE_WEIGHT = 1`. The "1.5x" test fails.
- (b) `HOT_SHOE_WEIGHT = 1.25`. The "mild" test fails (about 34% at TC ≥ +6).
- (c) Make `buildShoe` default to `hotShoeOrder`. The seed-42 characterization fails.
- (d) In `hotShoeOrder`, push a duplicate of the first card instead of the last. The permutation test fails.

- [ ] **Step 7: Commit**

```bash
git add src/engine/shoeBias.ts src/engine/shoeBias.test.ts src/engine/cards.ts src/engine/game.ts src/ui/playConfig.ts src/ui/playConfig.test.ts src/store/types.ts
git commit -m "feat(engine): Hot shoe, a weighted permutation of a full shoe biased to positive counts (B8)"
```

---

### Task 8: Hot shoe in the product: toggle, label, and bankroll exclusion

**Files:**
- Modify: `src/ui/screens/ProfileEditor.tsx`: one `Toggle` plus one `<p className="stats-detail">`, directly after the Fab 4 detail paragraph (ends at 521). This is the only edit this lane makes in that file (contract: shared opt-in row).
- Modify: `src/store/types.ts`: the `sessions` row appends `hotShoe?: true` with a comment
- Modify: `src/ui/useGame.ts`: compute `const hotShoe = hotShoeActive(game.cfg, game.isRigged)`; skip `storeBankrollNow` in the per-round effect (339-341) and in `endSession` (682-683) when `hotShoe`; the session row gets `...(hotShoe ? { hotShoe: true } : {})`; `SessionReport` gains `hotShoe: boolean`; return `hotShoe` from the hook
- Modify: `src/ui/screens/Table.tsx`: a badge after `LosingShoeBadge` (848); `ReportScreen` adds `.report-hot-shoe` under the h1, and for a hot-shoe session `.report-summary` drops the bankroll part
- Modify: `src/ui/sessionFigures.ts`: `sessionTag` reads the now-typed `row.hotShoe`
- Modify: `src/ui/screens/tableGlance.css` (append the badge style: accent colour, pill, the same metrics as `.losing-shoe-badge`)
- Create: `e2e/hot-shoe.spec.ts`

**Interfaces:**
- Consumes: `hotShoeActive` and `Profile.hotShoe` (Task 7), and `.report-summary` (Task 5).
- Produces: the session row field `hotShoe?: true` and `SessionReport.hotShoe`. The copy:
  - Toggle label: **"Hot shoe (practice)"**
  - Detail: **"Deals shoes that run to high counts on purpose: true counts of +2 to +5 come up almost twice as often, so index plays and big bets get practice. These sessions are labelled Hot shoe and don't change your bankroll."**
  - Badge: **"Hot shoe"**
  - Report line: **"Hot shoe: the counts ran high on purpose, so this session's bankroll isn't kept."**

- [ ] **Step 1: Write the failing e2e** `e2e/hot-shoe.spec.ts`

```ts
import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, playRoundByAdvice, readStats } from './helpers';

test.use({ viewport: { width: 375, height: 812 } });

async function playUntilBankrollMoves(page: Page): Promise<void> {
  for (let i = 0; i < 15; i++) {
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await playRoundByAdvice(page);
    const t = await page.locator('.topbar-stat').first().innerText();
    if (!/Bankroll:\s*100(?![\d.])/.test(t)) return;
  }
  throw new Error('bankroll never moved');
}
const storedProfile = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.profiles.v1')!)[0]);
async function endIt(page: Page) { await page.locator('.end-btn').click(); await page.locator('.end-btn').click(); }

test('B8: a Hot shoe session is labelled, flagged, and leaves the bankroll alone', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { hotShoe: true });
  await page.goto('/?seed=2&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('hot-shoe-badge')).toHaveText('Hot shoe');
  await playUntilBankrollMoves(page);
  expect((await storedProfile(page)).bankrollNow).toBeUndefined();
  await endIt(page);
  await expect(page.locator('.report-hot-shoe')).toContainText('Hot shoe');
  await expect(page.locator('.report-summary')).not.toContainText('bankroll');
  const stats = (await readStats(page)) as { sessions: { hotShoe?: boolean }[] };
  expect(stats.sessions.at(-1)!.hotShoe).toBe(true);
  expect((await storedProfile(page)).bankrollNow).toBeUndefined();
});

test('B8: without Hot shoe nothing is labelled and the bankroll carries over', async ({ page }) => {
  await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page);
  await page.goto('/?seed=2&e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('hot-shoe-badge')).toHaveCount(0);
  await playUntilBankrollMoves(page);
  expect(typeof (await storedProfile(page)).bankrollNow).toBe('number');
  await endIt(page);
  await expect(page.locator('.report-hot-shoe')).toHaveCount(0);
  await expect(page.locator('.report-summary')).toContainText('bankroll');
  const stats = (await readStats(page)) as { sessions: { hotShoe?: boolean }[] };
  expect('hotShoe' in stats.sessions.at(-1)!).toBe(false);
});

test('B8: the Hot shoe toggle sits with the Fab 4 toggle, is off by default, and saves', async ({ page }) => {
  await withProfile(page);
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await page.getByRole('button', { name: 'Edit' }).first().click();
  const row = page.locator('.settings-toggle-row', { hasText: 'Hot shoe' });
  await expect(row.locator('input')).not.toBeChecked();
  await row.locator('input').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await storedProfile(page)).hotShoe).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `E2E_PORT=4710 npx playwright test e2e/hot-shoe.spec.ts --project=chromium --reporter=line`
Expected: FAIL, because the badge is missing and `bankrollNow` gets written.

- [ ] **Step 3: Implement** the toggle, the session flag, the bankroll guard, the badge, the report line and the summary variant as specified above.

- [ ] **Step 4: Run it plus neighbours**

Run: `E2E_PORT=4710 npx playwright test e2e/hot-shoe.spec.ts e2e/play-bankroll.spec.ts e2e/losing-shoe.spec.ts e2e/profile-editor-guard.spec.ts e2e/surrender-indices.spec.ts e2e/profiles.spec.ts --project=chromium --reporter=line`, then `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Screenshot and read it**

Add `await shot(page, 'b8-hot-shoe-report')` at the end of the first test, re-run, and read the PNG. Check that the label reads as a note, not an error, and that no layout breaks.

- [ ] **Step 6: Mutation-check**

Each must fail, then restore:
- (a) Remove the per-round `storeBankrollNow` guard. The first test fails on `bankrollNow`.
- (b) Always write `hotShoe: true`. The control test fails.
- (c) Default the toggle `checked` to `true`. The toggle test fails.

- [ ] **Step 7: Commit**

```bash
git add src/ui/screens/ProfileEditor.tsx src/store/types.ts src/ui/useGame.ts src/ui/screens/Table.tsx src/ui/sessionFigures.ts src/ui/screens/tableGlance.css e2e/hot-shoe.spec.ts
git commit -m "feat(play): Hot shoe option: labelled on Play and the report, bankroll not carried (B8)"
```

---

### Task 9: Gate run

**Files:** none new. This task fixes whatever the gates find.

- [ ] **Step 1: Types.** Run `npx tsc -b`. Expected: exit 0, no output.
- [ ] **Step 2: Unit.** Run `npx vitest run`. Expected: all files pass, including `roundBanner`, `feltLayout`, `reportSections`, `sessionFigures`, `shoeBias`, `drillLaunch`, `playConfig` and `game`.
- [ ] **Step 3: Lint.** Run `npm run lint`. Expected: `Found 13 warnings and 0 errors.` (no new warnings, since every new helper lives in a `.ts` file).
- [ ] **Step 4: Build and check what ships.** Run `npm run build`, then

```bash
grep -l "lost to mistakes per 100 hands" dist/assets/*.js
grep -l "Drill these hands" dist/assets/*.js
grep -l "Hot shoe (practice)" dist/assets/*.js
grep -l "round-banner" dist/assets/*.css
grep -l "felt-slots" dist/assets/*.css
```

Expected: each prints one file. Also run `grep -c "⏩" dist/assets/*.js`; expected 0.
- [ ] **Step 5: Targeted e2e**, from a clean tree with no edits while it runs:

```bash
E2E_PORT=4710 npx playwright test e2e/play-glance.spec.ts e2e/play-report.spec.ts e2e/hot-shoe.spec.ts e2e/game.spec.ts e2e/table-seats.spec.ts e2e/voice-count.spec.ts e2e/voice-table.spec.ts e2e/play-bankroll.spec.ts e2e/play-persistence.spec.ts e2e/cycle1.spec.ts e2e/deal-animation.spec.ts e2e/bot-card-pacing.spec.ts e2e/layout-guard.spec.ts e2e/drill-layout.spec.ts e2e/count-manual-pace.spec.ts e2e/count-table.spec.ts e2e/custom-drill-editor.spec.ts e2e/custom-persist.spec.ts e2e/correction-chart.spec.ts e2e/chart-note.spec.ts e2e/losing-shoe.spec.ts e2e/surrender-indices.spec.ts e2e/profiles.spec.ts e2e/smoke.spec.ts e2e/topbar-profile-name.spec.ts e2e/peek-and-dealer.spec.ts --project=chromium --reporter=line
```

Expected: all pass. If a test flakes only under load, read its `error-context.md` and don't raise the timeout.
- [ ] **Step 6: Final look.** Re-open the twelve B5 screenshots (felt, banner and wrong-play in 4 themes), `b6-report.png` and `b8-hot-shoe-report.png` from this final build's run.
- [ ] **Step 7: Commit any gate fixes** with explicit paths. Do not push; the controller merges the lanes.

---

## Cross-lane requests

1. **H (owns `src/ui/screens/Stats.tsx` and `e2e/settings-stats.spec.ts`).** This is a small change, about 8 lines. Apply it after P merges, or the controller applies it post-merge.
   - At Stats.tsx:766, 774 and 788-790, replace `totalBankrollDelta` / `unitsPerHourProxy` and the "Your units per hour (at 80 rounds an hour)" row with `import { sessionsLossPer100, formatLossPer100, sessionTag } from '../sessionFigures';` and `const loss = sessionsLossPer100(profileSessions); if (loss !== null) profileRows.push(['Lost to mistakes', formatLossPer100(loss)]);`.
   - In the Table sessions row (Stats.tsx:1704-1722), add `{sessionTag(s) && <span className="session-assisted"> · {sessionTag(s)}</span>}` next to the accuracy.
   - Update `e2e/settings-stats.spec.ts:195`, which asserts the "Your units per hour" row, to assert the `Lost to mistakes` row and its text pattern `/(−\d+\.\d\d|0|Under 0\.01) u lost to mistakes per 100 hands/`. It needs a seeded session row with `hands` and `mistakeUnits`.
   - This removes the only luck-driven aggregate on Stats. Hot-shoe rows then appear only labelled, so no Stats figure needs a further exclusion.
2. **Controller (merge order).** `ProfileEditor.tsx` gets one toggle row from P (Hot shoe) and one from D (BJA extras), both directly after the Fab 4 paragraph. Expect an adjacent-line conflict; keep both rows.
3. **Notice, nothing needed.** Outside its listed files, P also edits: `src/engine/cards.ts` (an additive `Shoe` option; no other lane touches it); `src/ui/playConfig.ts` (Play's config); and the Play e2e specs `voice-count`, `game`, `table-seats` and `play-bankroll` (their text moves to the real minus and the banner). The B5 card sizes for the Count drill and Pair cancellation come from a CSS file loaded through `PlayingCard.tsx`, so lane D's `CountDrillView.tsx` and `PairCancelView.tsx` get **zero** line changes.
