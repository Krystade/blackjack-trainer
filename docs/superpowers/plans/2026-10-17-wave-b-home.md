# Wave B lane H (Home/shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the mute control in every screen's top bar (B1), replace Home's single Next step with the 7-rung casino-order ladder plus "Review N due" and stalest-skill rotation (B2), and finish the Wave A leftovers that belong to this lane (bet ramp sentinel, "Edit profile and bet ramp", real minus in `peekFlag.ts` and Stats rows).

**Architecture:** B1 drops the 44px `--mute-h` strip and moves every seat rule into one new stylesheet, `src/ui/muteSeat.css`. That file is imported last, so it wins the cascade. It defines `--mute-seat` (the width kept free on the right of every top bar) and works in two modes. On screens with a sticky top bar (Charts model, #24), the shell's single fixed `.mute-btn` sits in that bar's seat. On Home, the Drills picker and the session report there is no bar, so the disc is `position: absolute` and scrolls away with the top of the page. B2 rewrites `nextStep.ts` as `ladder()`, which takes pure per-rung rules from a new `ladderRules.ts`. `nextStep()` stays as a thin wrapper. Home renders the result through a new `LadderCard.tsx`.

**Tech Stack:** React 19, TypeScript, Vite, Vitest (pure units only, no DOM env), Playwright (chromium, headless, 375×812).

**Spec:** `docs/superpowers/specs/2026-10-16-wave-b-design.md` (B1, B2, Global constraints). The lane contracts in `docs/superpowers/plans/2026-10-17-wave-b-contracts.md` are binding too: contract 1 (`betsizing`, `stats.betSizing?.history`), contract 5 (mute seat) and contract 6 (U+2212). Evidence: `docs/superpowers/specs/2026-10-16-swarm-backlog.md` (D3, D5, W2, W13, F21) and `docs/superpowers/specs/2026-10-16-swarm-stories.json` (s01, s02, s05 and s09 top-bar findings).

## Global Constraints

- Work only in the `wave-b-home` worktree on branch `wave-b-home`. E2E port is **4740**, set with `E2E_PORT=4740` on every Playwright command.
- iPhone 13 mini: 375×812 with notch insets. Every tap target must be at least 44px. No sideways scroll. Nothing may sit under the status bar or under the mute control, whether the page is scrolled or not.
- Low friction: no new required inputs. Anything new is either derived or default-off.
- Strategy truth comes only from `src/engine/*`. Use `indexSetFor(strategyRulesFor(profile))` through `activeIndices(rules)`. Grade bets only through `src/engine/wong.ts`.
- Signed counts and figures use a real minus sign (U+2212) from `src/drills/signed.ts` (`MINUS`, `signed`, `plainNumber`).
- New CSS goes in new files and never in `app.css`. You may touch other lanes' screens only through NEW css files that target existing class names. The only JSX edits allowed there are removing the Back-to-Home button in Stats and changing the back-button element in Charts.
- `store/types.ts`, `persist.ts`, `ui/drillLaunch.ts` and `e2e/helpers.ts` are append-only (never rename). This plan does not touch `types.ts` at all.
- In `Drills.tsx`, H may only add `'betsizing'` to the `DrillMode` union.
- TDD. Mutation-check every new test: `cp` the file to your scratch dir, break the change, watch the test fail, then restore with `cp`. Never use `git checkout`.
- Commit explicit paths only. Never `git add -A` or `.`, and never commit `docs/sources/chart-view-*.png`.
- No audible audio and no headed browsers. Visual checks are headless 375×812 screenshots that you open and read.
- Gates: `npx tsc -b`, `npx vitest run`, `npm run lint` (exactly 13 warnings; exporting a non-component from a `.tsx` adds one), `npm run build` plus a grep of `dist/`, and the targeted Playwright run.

## Review Focus

1. **Short viewport (Safari toolbars up, 375×667).** Below 700px the disc shrinks to 32px (`--mute-disc`). The seat and disc position must still keep it clear of every control. Pinned by the 667px pass in Task 1's layout guard.
2. **Legacy or corrupt stats** (a session with `graded: 0`, an unparseable `date`, a non-boolean `ok`). The ladder must not throw or print NaN, and an unparseable date counts as "never". Pinned in Task 3 (`'survives legacy and corrupt rows'`).
3. **Device clock behind the SR timestamps** (`lastSeenAt`/`dueAt` in the future). A future `dueAt` is not due, and the stalest-skill text says "today", never "-3 days". Pinned in Task 4.
4. **Bet spread off when tapping "Edit profile and bet ramp".** There is no ramp section to show, so the editor must land on the "Vary bets with the count" toggle instead of an empty scroll. Pinned in Task 6's e2e.
5. **Charts reached from a non-Home origin** (Settings, Drills, a running drill). The bar must still fit on one line and keep a working Back. Pinned in Task 2's e2e (Settings origin).

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/ui/muteSeat.css` | new | Strip removal, `--mute-seat`/`--topbar-h`/`--mute-top`, the disc's two modes, every top bar's seat, the Charts no-wrap rules |
| `src/ui/stickyTopbars.css` | delete | Its one rule moves into `muteSeat.css` |
| `src/ui/App.tsx` | modify | Import `muteSeat.css` last. Pass Charts `onBack` only when the origin is not Home |
| `src/ui/screens/Stats.tsx` | modify | Remove the Back to Home button. Real minus in the Drift and Pace drift rows |
| `src/ui/screens/Charts.tsx` | modify (back button only) | Render Back only when `onBack` is given. Text "Back", with an aria-label naming the destination |
| `src/ui/screens/ladderRules.ts` | new | Pure rules for rungs 3, 4, 6 and 7, the due count, the stalest skill, constants |
| `src/ui/screens/nextStep.ts` | modify | `ladder()` in casino order, review insertion, stale rotation. `nextStep()` becomes a wrapper |
| `src/ui/drillLaunch.ts` | append | `reviewLaunchSettings()` |
| `src/ui/screens/Drills.tsx` | 1 line | `'betsizing'` in `DrillMode` |
| `src/drills/fluencyGate.ts` | doc only | States that this rule is rung 3 |
| `src/ui/screens/LadderCard.tsx` | new | Next step card: title, why, gold Start, 7 rows |
| `src/ui/screens/Home.tsx` | modify | Loads both SR decks, renders `LadderCard` above readiness, launches targets |
| `src/ui/screens/nextStep.css` | modify | Ladder row styles |
| `src/ui/spreadRows.ts` | new | Floor-row ("Any count") detection, TC label, stepper clamp |
| `src/ui/profileLaunch.ts` | new | One-shot "open the editor at the ramp" handoff |
| `src/ui/screens/ProfileEditor.tsx` | modify | Floor row label, real minus, launched edit, scroll to the ramp, return to origin |
| `src/ui/screens/profileRamp.css` | new | `scroll-margin-top` for the ramp anchor |
| `src/ui/components/TabSettingsButton.tsx` | modify (one button) | "Profiles" becomes "Edit profile and bet ramp" |
| `src/ui/peekFlag.ts` | modify | `signedFixed` uses U+2212 and is exported |
| Tests | new/modify | `src/ui/screens/ladder.test.ts` (new), `nextStep.test.ts`, `drillLaunch.test.ts`, `spreadRows.test.ts` (new), `profileLaunch.test.ts` (new), `peekFlag.test.ts`; e2e `layout-guard.spec.ts`, `ladder.spec.ts` (new), `profile-ramp.spec.ts` (new), `stats-real-minus.spec.ts` (new), plus the listed edits to existing specs |

---

### Task 1: B1, remove the strip and give the mute control a seat in every top bar

**Files:**
- Create: `src/ui/muteSeat.css`
- Delete: `src/ui/stickyTopbars.css`
- Modify: `src/ui/App.tsx:3` (drop the stickyTopbars import) and the end of the import block (add `import './muteSeat.css';` as the very last import, after `./components/*` and `./screens/*`, so it is last in the bundle's cascade)
- Rewrite: `e2e/layout-guard.spec.ts`. Replace its first two tests. Keep `hit targets`, `numpad gutter` and the contrast tests.
- Modify: `e2e/charts.spec.ts`. In the `'#24: the disc is not moved on other screens'` test, the premise (disc at y=0 elsewhere) is gone. Rename it `'the disc sits on the same seat line on Home, Drills and Charts'` and assert `discTop` is `6` on all three. Its final `Back to Drills` click stays: the accessible name survives Task 2.

**Interfaces:**
- Produces (CSS custom properties, used by Tasks 2 and 6):
  - `--mute-seat: calc(var(--mute-disc, 44px) + 16px)`
  - `--topbar-h: calc(48px + 1.2rem)` (height of the 0.6rem-padded bar family)
  - `--mute-top` (the disc's offset below `--safe-top`)
- Produces (e2e helpers inside `layout-guard.spec.ts`): `discOffenders(page)`, `statusBarOffenders(page, inset)`, `checkScreen(page, name)`, and the `SCREENS: { name: string; open: (page: Page) => Promise<void> }[]` table that Task 2 appends to.

- [ ] **Step 1: Write the failing guard.** Replace the first two tests of `e2e/layout-guard.spec.ts` with:

```ts
import { withSettings, withStats, openSettingsScreen, statsTab, shot } from './helpers'; // Task 2 adds openCountOptions

const INTERACTIVE = 'button, input, select, textarea, a[href], [role="button"], [role="switch"], summary';
const HEADING = 'h1, h2, h3, [class*="heading"], [class*="title"]';

/** Controls or heading WORDS visible under the disc (topmost at the overlap). [] = clear. */
async function discOffenders(page: Page): Promise<string[]> {
  return page.evaluate(([MUTE_SEL, INT, HEAD]) => {
    const disc = document.querySelector(MUTE_SEL);
    if (!disc) return ['no mute button'];
    const d = disc.getBoundingClientRect();
    if (d.bottom <= 0) return []; // scrolled away with the top of the page (absolute mode)
    const visibleAt = (el: Element, x: number, y: number) => {
      const top = document.elementsFromPoint(x, y).find((e) => !e.closest(MUTE_SEL));
      return !!top && (top === el || el.contains(top));
    };
    const hit = (r: DOMRect) => {
      const l = Math.max(r.left, d.left), t = Math.max(r.top, d.top);
      const rr = Math.min(r.right, d.right), b = Math.min(r.bottom, d.bottom);
      return rr > l && b > t ? [(l + rr) / 2, (t + b) / 2] : null;
    };
    const out = new Set<string>();
    for (const el of document.querySelectorAll(INT)) {
      if (el.closest(MUTE_SEL)) continue;
      const p = hit(el.getBoundingClientRect());
      if (p && visibleAt(el, p[0]!, p[1]!)) out.add(`control ${el.tagName}.${el.className} "${(el.textContent ?? '').trim().slice(0, 24)}"`);
    }
    for (const el of document.querySelectorAll(HEAD)) {
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent!.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          const p = hit(r);
          if (p && visibleAt(el, p[0]!, p[1]!)) out.add(`heading .${el.className} "${node.textContent!.trim().slice(0, 24)}"`);
        }
      }
    }
    return [...out];
  }, [MUTE, INTERACTIVE, HEADING] as const);
}

/** Visible text painted above `inset` (the status bar). [] = clear. */
async function statusBarOffenders(page: Page, inset: number): Promise<string[]> {
  if (inset === 0) return [];
  return page.evaluate((inset) => {
    const out = new Set<string>();
    for (const el of document.querySelectorAll('body *')) {
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent!.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.height === 0 || r.bottom <= 0 || r.top >= inset) continue;
          const x = Math.min(Math.max(r.left + 2, 0), innerWidth - 1);
          const y = Math.max(r.top, 0) + 1;
          const top = document.elementsFromPoint(x, y)[0];
          if (top && (top === el || el.contains(top))) out.add(`${el.className || el.tagName} "${node.textContent!.trim().slice(0, 24)}"`);
        }
      }
    }
    return [...out];
  }, inset);
}

async function checkScreen(page: Page, name: string, inset: number): Promise<void> {
  for (const where of ['top', 'bottom'] as const) {
    if (where === 'bottom') {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    expect(await discOffenders(page), `${name} (${where}): under the mute control`).toEqual([]);
    expect(await statusBarOffenders(page, inset), `${name} (${where}): under the status bar`).toEqual([]);
    if (process.env.B1_SHOTS) await shot(page, `b1-${inset}-${name.replace(/\W+/g, '-')}-${where}`);
  }
}

const SEED = {
  cellStats: {
    'hard-16-v-10': { right: 30, wrong: 0, lastAt: '' },
    'soft-18-v-9': { right: 30, wrong: 0, lastAt: '' },
    'pair-8-v-A': { right: 30, wrong: 0, lastAt: '' },
  },
  masterySweepsCompleted: 1,
  countDrill: { history: Array.from({ length: 12 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 1, 10, i)).toISOString(), cards: 52, intervalMs: 700, correct: i % 3 !== 0 })) },
  sessions: [{ date: '2026-10-01T10:00:00.000Z', rounds: 40, graded: 60, correct: 55, bankrollDelta: -3 }],
};

const tab = (page: Page, name: string) => page.locator('.tab-bar').getByRole('button', { name, exact: true }).click();

/** Every screen at 375 wide. Task 2 appends the screens other lanes own. */
const SCREENS: { name: string; open: (page: Page) => Promise<void> }[] = [
  { name: 'Home', open: async () => {} },
  { name: 'Stats Play', open: async (p) => { await p.locator('.home-stats-link').click(); } },
  { name: 'Stats Drills', open: async (p) => { await p.locator('.home-stats-link').click(); await statsTab(p, 'Drills'); } },
  { name: 'Stats Progress', open: async (p) => { await p.locator('.home-stats-link').click(); await statsTab(p, 'Progress'); } },
  { name: 'Settings', open: (p) => openSettingsScreen(p) },
  { name: 'Profiles', open: async (p) => { await p.locator('.home-profile-chip').click(); } },
  { name: 'Profile editor', open: async (p) => { await p.locator('.home-profile-chip').click(); await p.getByRole('button', { name: 'Edit', exact: true }).first().click(); } },
  { name: 'Test kit', open: async (p) => { await openSettingsScreen(p); await p.getByTestId('settings-testkit-open').click(); } },
  { name: 'Field test gate', open: async (p) => { await openSettingsScreen(p); await p.getByTestId('settings-testkit-open').click(); await p.getByTestId('fieldtest-open').click(); } },
  { name: 'Charts (from Home)', open: (p) => tab(p, 'Charts') },
];

for (const [label, inset, height] of [['inset 0', 0, 812], ['inset 47', 47, 812], ['short 667', 0, 667]] as const) {
  test(`B1: nothing under the mute control or the status bar, scrolled or not (${label})`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 375, height });
    await withSettings(page, { audio: { enabled: true } });
    await withStats(page, SEED);
    if (inset > 0) {
      await page.addInitScript((px) => {
        document.addEventListener('DOMContentLoaded', () => {
          const s = document.createElement('style');
          s.textContent = `:root { --safe-top: ${px}px; }`;
          document.head.appendChild(s);
        });
      }, inset);
    }
    for (const s of SCREENS) {
      await page.goto('/?e2e=1&seed=4');
      await s.open(page);
      await checkScreen(page, s.name, inset);
    }
  });
}

test('B1: the 44px strip is gone; the reclaimed space is content', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true } });
  await page.goto('/?e2e=1');
  expect(await page.evaluate(() => getComputedStyle(document.body).paddingTop)).toBe('0px');
  const head = await page.locator('.home-head').boundingBox();
  expect(head!.y).toBeLessThan(44);
  for (const open of [() => page.locator('.home-stats-link').click(), () => openSettingsScreen(page)]) {
    await page.goto('/?e2e=1');
    await open();
    const bar = page.locator('.stats-topbar, .settings-topbar').first();
    const [b, d] = [await bar.boundingBox(), await page.locator(MUTE).boundingBox()];
    expect(d!.y, 'the disc sits inside the bar').toBeGreaterThanOrEqual(b!.y - 0.5);
    expect(d!.y + d!.height).toBeLessThanOrEqual(b!.y + b!.height + 0.5);
  }
});
```

- [ ] **Step 2: Run it and confirm it fails.**
Run: `E2E_PORT=4740 npx playwright test e2e/layout-guard.spec.ts --project=chromium --reporter=line`
Expected: FAIL on `'the 44px strip is gone'` (paddingTop `44px`, and the disc is not inside the Stats bar). The inset-47 tour should also fail on a scrolled sticky bar (`Stats … (bottom)` or `Settings (bottom)`), whose text sits under the status bar because the bar sticks at `top: 0`. Record the actual offender list.

- [ ] **Step 3: Write `src/ui/muteSeat.css`.** Every selector and value below is a decision. Add a short header comment saying why each block exists (D3, #24 model, and why there are two modes).

```css
:root {
  --mute-h: 0px;                                      /* D3: the strip is gone (overrides primitives.css, incl. its <700px block) */
  --mute-seat: calc(var(--mute-disc, 44px) + 16px);   /* disc + 8px either side, kept free at the right of every top bar */
  --topbar-h: calc(48px + 1.2rem);                    /* 0.6rem-padded bars holding 48px controls */
  --mute-top: calc((56px - var(--mute-disc, 44px)) / 2); /* default seat line: Home head, picker, report, Charts' 56px bar */
}
.mute-btn { top: calc(var(--safe-top, 0px) + var(--mute-top)); }

/* The 0.6rem bar family: centre the disc on the bar's 48px control line. */
body[data-screen='stats'], body[data-screen='settings'], body[data-screen='profiles'],
body[data-screen='testkit'],
body[data-screen='drills']:not(:has(.drills-picker)),
body[data-screen='table']:not(:has(.report-screen)) {
  --mute-top: calc(0.6rem + (48px - var(--mute-disc, 44px)) / 2);
}

/* No bar: the disc scrolls away with the top of the page instead of floating over content. */
body[data-screen='home'] .mute-btn,
body:has(.drills-picker) .mute-btn,
body:has(.report-screen) .mute-btn { position: absolute; }

/* Home: the title row sits on the seat line and keeps the seat free. */
.home-screen { padding-top: var(--mute-top); }
.home-head { min-height: var(--mute-disc, 44px); padding-right: calc(var(--mute-seat) - var(--space-4)); }

/* Sticky bars: pinned below the status bar, opaque cover over the inset, seat on the right. */
.stats-topbar, .settings-topbar,
body[data-screen='testkit'] .fieldtest-topbar {
  position: sticky; top: var(--safe-top, 0px); z-index: 5;
  min-height: var(--topbar-h); padding-right: var(--mute-seat);
}
.stats-topbar::before, .settings-topbar::before,
body[data-screen='testkit'] .fieldtest-topbar::before {
  content: ''; position: absolute; left: 0; right: 0; bottom: 100%;
  height: var(--safe-top, 0px); background: inherit;
}
```

Delete `src/ui/stickyTopbars.css` and its import. The field test keeps its own rule (app.css `body[data-screen='fieldtest'] .fieldtest-topbar`). Leave it alone.

- [ ] **Step 4: Run the guard again.** The H screens pass. Screens Task 2 adds are not in `SCREENS` yet.
Run: `E2E_PORT=4740 npx playwright test e2e/layout-guard.spec.ts e2e/charts.spec.ts e2e/safe-area.spec.ts e2e/mute.spec.ts --project=chromium --reporter=line`
Expected: PASS.

- [ ] **Step 5: Mutation-check.** Back up `muteSeat.css` to scratch with `cp`, then break it three ways, one at a time:
  - (a) delete `--mute-h: 0px`: `'the 44px strip is gone'` fails.
  - (b) delete `padding-right: var(--mute-seat)` from the sticky-bar block: `Settings (top)` reports the heading under the disc.
  - (c) delete `position: absolute` for Home: `Home (bottom)` reports content under the disc.
  Restore with `cp` after each.

- [ ] **Step 6: Visual check.** Run `B1_SHOTS=1 E2E_PORT=4740 npx playwright test e2e/layout-guard.spec.ts -g "inset 47" --project=chromium --reporter=line`. Open `e2e/screenshots/b1-47-*.png` and check that each disc sits in its bar, nothing shows through the inset, and nothing looks broken.

- [ ] **Step 7: Commit.**
```bash
git add src/ui/muteSeat.css src/ui/App.tsx e2e/layout-guard.spec.ts e2e/charts.spec.ts
git rm src/ui/stickyTopbars.css
git commit -m "B1: drop the mute strip; the disc sits in each top bar's seat (--mute-seat)"
```

### Task 2: B1 on other lanes' screens, Back to Home removal and the one-line Charts bar

**Files:**
- Modify: `src/ui/muteSeat.css` (append)
- Modify: `src/ui/screens/Stats.tsx:797-799` (delete the `stats-back-btn` button)
- Modify: `src/ui/screens/Charts.tsx:293-301` (back-button element only)
- Modify: `src/ui/App.tsx:370-377` (Charts `onBack`)
- Modify: `e2e/layout-guard.spec.ts` (append to `SCREENS`, add the Charts one-line test)
- Modify (spec fallout, exact sites):
  - `e2e/charts.spec.ts:38`: `Back to Home` becomes `tab(page,'Home')`.
  - `e2e/charts.spec.ts:282`: the bottom-of-page check becomes `.charts-topbar` in viewport, because the test opens Charts from Home.
  - `e2e/charts-return.spec.ts:19,113`: `toHaveText('Back to Drills')` becomes `toHaveAccessibleName('Back to Drills')` plus `toHaveText('Back')`.
  - `e2e/charts-return.spec.ts:100-104`: rename to `'opened from Home, Charts has no Back (the tab bar is Home)'` and assert `.charts-back-btn` has count 0.
  - `e2e/settings-stats.spec.ts:69`: `Back to Home` becomes `page.locator('.tab-bar').getByRole('button', { name: 'Home', exact: true }).click()`.

**Interfaces:**
- Consumes: `--mute-seat`, `--topbar-h`, `--mute-top` and `SCREENS`/`checkScreen` from Task 1.
- Produces: Charts prop semantics. `onBack` undefined means no Back button in the top bar. `backLabel` names the destination for the aria-label.

- [ ] **Step 1: Write the failing tests.** Add `openCountOptions` to the `./helpers` import, then append these to `SCREENS`:

```ts
const drill = (name: string, run?: (p: Page) => Promise<void>) => ({
  name: `Drill ${name}${run ? ' (running)' : ''}`,
  open: async (p: Page) => { await tab(p, 'Drills'); await p.getByRole('button', { name, exact: true }).click(); await expect(p.locator('.drill-topbar')).toBeVisible(); if (run) await run(p); },
});
const start = async (p: Page) => { await p.getByRole('button', { name: 'Start', exact: true }).click(); };
SCREENS.push(
  { name: 'Drills picker', open: (p) => tab(p, 'Drills') },
  drill('Flashcards'), drill('Deviation quiz'), drill('Mixed'), drill('Mastery challenge'), drill('Speed'),
  drill('Custom'), drill('Pair cancellation'), drill('Bet or sit'),
  drill('Count drill', openCountOptions), drill('Count drill', start),
  drill('True count drill', start), drill('Deck estimation', start), drill('Produce the true count', start),
  { name: 'Table (bet)', open: (p) => tab(p, 'Play') },
  { name: 'Table (dealt)', open: async (p) => { await tab(p, 'Play'); await p.getByRole('button', { name: 'Deal', exact: true }).click(); await expect(p.locator('.action-bar')).toBeVisible(); } },
  { name: 'Session report', open: async (p) => { await tab(p, 'Play'); await p.getByRole('button', { name: 'Deal', exact: true }).click(); await p.locator('.end-btn').click(); await p.locator('.end-btn').click(); await expect(p.locator('.report-screen')).toBeVisible(); } },
  { name: 'Charts (from Drills)', open: async (p) => { await tab(p, 'Drills'); await tab(p, 'Charts'); } },
  { name: 'Charts (from Settings)', open: async (p) => { await openSettingsScreen(p); await tab(p, 'Charts'); } },
);
```

If a `drills-nav-btn` aria-label differs from these names on this branch, read the picker's `entry(...)` lines in `Drills.tsx` and use the exact accessible names. Keep "Bet or sit" until lane N replaces it.

Then add:

```ts
test('B1: the Custom editor palette sticks below the drill bar, not under it', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true } });
  await page.goto('/?e2e=1');
  await tab(page, 'Drills');
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 900));
  const [bar, pal] = [await page.locator('.drill-topbar').boundingBox(), await page.locator('.cde-palette').boundingBox()];
  expect(pal!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height - 1);
});

test('B1/s09: the Charts bar is one line from every origin; Back only where it goes somewhere', async ({ page }) => {
  await page.goto('/?e2e=1');
  const oneLine = (sel: string) => page.locator(sel).evaluate((el) => {
    const r = document.createRange(); r.selectNodeContents(el); return r.getClientRects().length;
  });
  await tab(page, 'Charts');
  await expect(page.locator('.charts-back-btn')).toHaveCount(0);
  expect(await oneLine('.charts-heading')).toBe(1);
  for (const origin of ['Drills', 'Settings'] as const) {
    await page.goto('/?e2e=1');
    if (origin === 'Settings') await openSettingsScreen(page); else await tab(page, 'Drills');
    await tab(page, 'Charts');
    const back = page.locator('.charts-back-btn');
    await expect(back).toHaveText('Back');
    await expect(back).toHaveAccessibleName(`Back to ${origin}`);
    expect(await oneLine('.charts-back-btn')).toBe(1);
    expect(await oneLine('.charts-heading')).toBe(1);
    expect((await page.locator('.charts-topbar').boundingBox())!.height).toBeLessThanOrEqual(57);
  }
});

test('B1: Stats is a tab screen with no Back to Home', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await expect(page.locator('.stats-heading')).toHaveText('Stats');
  await expect(page.getByRole('button', { name: 'Back to Home' })).toHaveCount(0);
});
```

- [ ] **Step 2: Run and confirm failures.** Run `E2E_PORT=4740 npx playwright test e2e/layout-guard.spec.ts --project=chromium --reporter=line`. Expected: FAIL, for example on `Drills picker` (`.tab-gear` under the disc), `Table (bet)` (`.tab-gear`) and drill top bars whose right-hand content sits under the disc. Record the actual offender list in the task report. The one-line test also fails while `Back to Home` is present, and so does the Stats test.

- [ ] **Step 3: Append to `muteSeat.css`.**

```css
/* Drill top bars (every drill view, HandDeckGate, Custom editor): sticky, seat, inset cover. */
.drill-topbar {
  position: sticky; top: var(--safe-top, 0px); z-index: 5;
  min-height: var(--topbar-h); padding-right: var(--mute-seat);
}
.drill-topbar::before { content: ''; position: absolute; left: 0; right: 0; bottom: 100%; height: var(--safe-top, 0px); background: inherit; }
.cde-palette { top: calc(var(--safe-top, 0px) + var(--topbar-h)); }

/* Drills picker: no bar; the gear joins the disc's line, left of the seat. */
.drills-picker > .tab-gear { top: var(--mute-top); right: var(--mute-seat); }

/* Play: only row 1 col 3 (the gear) shares the disc's line; End on row 2 keeps its full 8.5rem. */
.table-screen > .topbar { position: sticky; top: var(--safe-top, 0px); z-index: 5; }
.table-screen > .topbar > .tab-gear { margin-right: calc(var(--mute-seat) - 0.75rem); }

/* s05/s09: Charts bar on one line. */
.charts-back-btn { flex: none; white-space: nowrap; }
.charts-heading { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

- [ ] **Step 4: JSX.**
  - Stats: delete the Back to Home `<button>` (`Stats.tsx:797-799`) and keep the heading.
  - Charts: the top-bar Back renders only when `backPlacement === 'topbar' && onBack`. Its text is `Back` and its `aria-label` is `backText`. Leave `FloatingBackPill` and `goBack` unchanged.
  - App: `onBack={chartsReturn === 'home' ? undefined : () => navigate(chartsReturn)}`.

- [ ] **Step 5: Run.** `E2E_PORT=4740 npx playwright test e2e/layout-guard.spec.ts e2e/charts.spec.ts e2e/charts-return.spec.ts e2e/settings-stats.spec.ts e2e/safe-area.spec.ts e2e/drill-layout.spec.ts e2e/custom-drill-editor.spec.ts e2e/table-seats.spec.ts e2e/field-test-layout.spec.ts --project=chromium --reporter=line`. Expected: PASS.

- [ ] **Step 6: Mutation-check** (cp backup each time):
  - (a) drop `.drill-topbar { padding-right }`: `Drill Speed` fails.
  - (b) drop the `.cde-palette` rule: the palette test fails.
  - (c) restore `Back to {label}` as the visible text: the one-line test fails at the Settings origin.
  - (d) restore Stats' button: the Stats test fails.

- [ ] **Step 7: Visual check.** Run `B1_SHOTS=1` with the inset 0 tour. Open the drill, table, report and Charts PNGs.

- [ ] **Step 8: Commit.**
```bash
git add src/ui/muteSeat.css src/ui/screens/Stats.tsx src/ui/screens/Charts.tsx src/ui/App.tsx e2e/layout-guard.spec.ts e2e/charts.spec.ts e2e/charts-return.spec.ts e2e/settings-stats.spec.ts
git commit -m "B1: seats on drill, picker, table and report; no Back to Home on Stats/Charts; Charts bar on one line"
```

### Task 3: B2 rungs, the casino-order ladder

**Files:**
- Create: `src/ui/screens/ladderRules.ts`
- Modify: `src/ui/screens/nextStep.ts` (rewrite `stepFor` into `ladder`; keep `masterySweepDone`, `isWholeChartSweep`, `cellLabel` and the re-exports)
- Modify: `src/ui/screens/Drills.tsx:2938-2950` (add `| 'betsizing'` to `DrillMode`, and nothing else)
- Modify: `src/drills/fluencyGate.ts` (doc comment only: "this rule is rung 3 of the ladder, nextStep.ts")
- Create: `src/ui/screens/ladderFixtures.ts` (test-only stats builders. It is not a `*.test.ts`, so vitest does not run it, and no app code imports it. Do not import one test file from another, or its tests register twice.)
- Create: `src/ui/screens/ladder.test.ts`
- Modify: `src/ui/screens/nextStep.test.ts`. Import `stateAt`/`withIndices`/`runs` from `./ladderFixtures`. Update for the casino order:
  - `'2: a cell with too few answers…'` now expects `'count'`.
  - `'4: deviations…'` and `'F11'` are rebuilt on `stateAt(5)` (see below).
  - `'5: counting…'` passes into `'deckest'`, not `'play'`.
  - `'6: everything on target'` uses `stateAt(8)`.

**Interfaces:**
- Consumes: `handCategoryProgress`, `weakCells`, `goalPct`, `pctDown` (handProgress.ts); `countFluency`, `COUNT_RUNS_JUDGED`, `COUNT_RUNS_NEEDED` (fluencyGate.ts); `activeIndices`, `IndexRules` (readiness.ts); `SrDeck` (spacedRepetition.ts).
- Produces (`ladderRules.ts`):
```ts
export const DRILL_WINDOW = 10;          // Wave A's recent window for drill histories (statsFormat.trendLine)
export const DRILL_WINDOW_NEEDED = 8;    // 80%: the count rule's 4 of 5
export const PLAY_SESSIONS_JUDGED = 5;
export const PLAY_MIN_GRADED = 40;
export const PLAY_TARGET = 0.9;
export interface WindowResult { judged: number; right: number; passed: boolean }
export function recentWindow(history: readonly { correct: unknown }[], window?: number, needed?: number): WindowResult; // last `window` rows; right counts `correct === true`; passed = judged >= window && right >= needed
export function deckTcResult(stats: Stats): { deck: WindowResult; tc: WindowResult; passed: boolean };
export type BetSizingRow = { date: string; ok: boolean };
export function betSizingRows(stats: Stats): readonly BetSizingRow[];   // (stats as Stats & { betSizing?: { history?: BetSizingRow[] } }).betSizing?.history ?? [] — contract 1; drop the cast after merge
export function betRampResult(stats: Stats): WindowResult;               // recentWindow over rows as { correct: row.ok }
export function playResult(stats: Stats): { best: { graded: number; correct: number } | null; passed: boolean }; // last PLAY_SESSIONS_JUDGED sessions; qualifying = graded >= 40 && correct/graded >= 0.9; best = most graded among the last 5 (null if none)
export function parseTime(iso: unknown): number; // Date.parse, NaN/'' → 0 (never)
```
- Produces (`nextStep.ts`):
```ts
export type NextStepKind = 'flash' | 'custom' | 'mastery' | 'quiz' | 'count' | 'deckest' | 'truecount' | 'betsizing' | 'play';
export type RungId = 'basic' | 'repair' | 'count' | 'tc' | 'deviations' | 'betramp' | 'play';
export const RUNG_LABELS: Record<RungId, string>; // 'Basic strategy', 'Weak cells and a full sweep', 'Running count at table pace', 'Deck estimation and true count', 'Deviations', 'Bet ramp', 'Play a shoe'
export interface StartTarget { kind: NextStepKind; scope?: HandScope }
export interface RungResult { id: RungId; label: string; passed: boolean; progress: string; start: StartTarget }
export type CardKind = 'rung' | 'review' | 'stale';
export interface NextStep extends StartTarget { card: CardKind; title: string; why: string; progress?: HandCategoryProgress[]; reviewCells?: string[] }
export interface Ladder { rungs: RungResult[]; current: number | null; step: NextStep }
export interface LadderContext { sweepDone: boolean; rules?: IndexRules; flashSr?: SrDeck; quizSr?: SrDeck; now?: number }
export function ladder(stats: Stats, ctx: LadderContext): Ladder;
export function nextStep(stats: Stats, ctx: LadderContext): NextStep; // = ladder(stats, ctx).step
```
- `DrillLaunch` (`drillLaunch.ts`, `Exclude<NextStepKind,'play'>`) widens automatically. No edit is needed there.

**Pass rules (the decisions; rung N passed is independent of the other rungs):**

| # | Rung | Passed when | Start target (failing; passed) |
|---|---|---|---|
| 1 | basic | every hard/soft/pairs category `onTarget` (≥ 20 answers, judged figure ≥ 90%, W3 window of 30) | existing step 1 (flash + scope, or s07 custom); `{flash}` |
| 2 | repair | `weakCells(stats).length === 0 && ctx.sweepDone` | `custom` if weak cells, else `mastery`; `{mastery}` |
| 3 | count | `countFluency(history).fluent` (≥ 4 of the last 5 paced runs of ≥ 52 cards) | `count` |
| 4 | tc | deck estimation **and** true count each ≥ 8 right of the last 10 (≥ 10 rows) | `deckest` while deck fails, else `truecount`; `{deckest}` |
| 5 | deviations | every active index ≥ 3 answers **and** pooled active-index accuracy ≥ 90% (`perIndex`, unchanged Wave A rule) | `quiz` |
| 6 | betramp | `betSizing.history` ≥ 8 `ok` of the last 10 (≥ 10 rows) | `betsizing` |
| 7 | play | one of the last 5 sessions has `graded ≥ 40` and `correct/graded ≥ 0.9` | `play` |

`current` is the index of the first rung that has not passed, or `null`. The step is the current rung's card (in Task 3; Task 4 adds review and stale). Rung cards for 1, 2, 3 and 5 keep their existing titles and copy, because existing tests match on them. New copy:
- Rung 4: title `Deck estimation and true count`. Why, deck failing: `Deck estimation: ${right} of your last ${judged} right; aim for 8 of 10.`, or `${judged} of 10 deck estimation answers so far.` when judged < 10. TC failing: the same with `True count drill`.
- Rung 6: title `Bet ramp`. Why: `Bet sizing: ${right} of your last ${judged} right; aim for 8 of 10.`, or `Size bets from the count: ${judged} of 10 answers so far.`
- Rung 7: title `Play a shoe`. Why: `Strategy, counting, deviations and the bet ramp are on target. Play a shoe: ${PLAY_MIN_GRADED}+ decisions at 90%.`
- Row `progress` strings (pinned by tests): rung 3 `${judged}/5 paced deck runs` when judged < 5, else `${right}/5 right (need 4)`. Rung 4 `Decks ${d.right}/${d.judged} · TC ${t.right}/${t.judged} (need 8/10 each)`. Rung 6 `${right}/${judged} right (need 8/10)`, or `No bet sizing answers yet`.

- [ ] **Step 1: Write the failing tests.** Put the builders in `src/ui/screens/ladderFixtures.ts`:

```ts
import { EMPTY_STATS, type Stats } from '../../store/types';
import { ILLUSTRIOUS_18 } from '../../engine/deviations';

export const NOW = Date.parse('2026-10-17T12:00:00.000Z');
export const DAY = 86_400_000;
export const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
/** n results, the last `right` of them right. */
export const flags = (right: number, n: number) => Array.from({ length: n }, (_, i) => i >= n - right);

export function learned(): Stats {
  const s = structuredClone(EMPTY_STATS);
  s.cellStats = {
    'hard-16-v-10': { right: 30, wrong: 0, lastAt: iso(1) },
    'soft-18-v-9': { right: 30, wrong: 0, lastAt: iso(1) },
    'pair-8-v-A': { right: 30, wrong: 0, lastAt: iso(1) },
  };
  return s;
}
export const runs = (ok: boolean[], cards = 52) => ok.map((correct) => ({ date: iso(1), cards, intervalMs: 700, correct }));
export const deckRows = (ok: boolean[]) => ok.map((correct) => ({ date: iso(1), actualDecks: 3, guess: 3, errorDecks: correct ? 0 : 1, correct }));
export const tcRows = (ok: boolean[]) => ok.map((correct) => ({ date: iso(1), runningCount: 6, decksRemaining: 3, guess: 2, correctTc: 2, correct }));
export const betRows = (ok: boolean[]) => ok.map((v) => ({ date: iso(1), rc: 6, decksRemaining: 3, tc: 2, taken: 4, correct: 4, ok: v }));
export function withBets(s: Stats, ok: boolean[]): Stats { (s as Stats & { betSizing?: unknown }).betSizing = { history: betRows(ok) }; return s; }
export function withIndices(s: Stats, right = 10, wrong = 0): Stats {
  for (const d of ILLUSTRIOUS_18.filter((x) => x.active)) s.perIndex[d.id] = { right, wrong };
  return s;
}

/** Stats where rungs 1..r-1 pass and rung r fails (r = 8: everything passes). ctx.sweepDone = r !== 2. */
export function stateAt(r: number): Stats {
  if (r === 1) return structuredClone(EMPTY_STATS);
  const s = learned();
  if (r >= 4) s.countDrill.history = runs(flags(5, 5));
  if (r >= 5) { s.deckEstimation.history = deckRows(flags(10, 10)); s.trueCount.history = tcRows(flags(10, 10)); }
  if (r >= 6) withIndices(s);
  if (r >= 7) withBets(s, flags(10, 10));
  if (r >= 8) s.sessions = [{ date: iso(1), rounds: 45, graded: 40, correct: 36, bankrollDelta: 0 }];
  return s;
}
export const ctxFor = (r: number) => ({ sweepDone: r !== 2, now: NOW });
```

Then write `src/ui/screens/ladder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EMPTY_STATS } from '../../store/types';
import { isCountFluent } from '../../drills/fluencyGate';
import { ladder } from './nextStep';
import { NOW, DAY, iso, flags, runs, deckRows, tcRows, withBets, withIndices, stateAt, ctxFor } from './ladderFixtures';

describe('ladder: casino order (B2)', () => {
  it.each([
    [1, 'basic', 'flash'], [2, 'repair', 'mastery'], [3, 'count', 'count'], [4, 'tc', 'deckest'],
    [5, 'deviations', 'quiz'], [6, 'betramp', 'betsizing'], [7, 'play', 'play'],
  ] as const)('rung %i (%s) is current and Start opens %s', (r, id, kind) => {
    const l = ladder(stateAt(r), ctxFor(r));
    expect(l.current).toBe(r - 1);
    expect(l.rungs.map((x) => x.id)).toEqual(['basic', 'repair', 'count', 'tc', 'deviations', 'betramp', 'play']);
    expect(l.rungs[r - 1]!.id).toBe(id);
    expect(l.step).toMatchObject({ card: 'rung', kind });
    expect(l.rungs.slice(0, r - 1).every((x) => x.passed)).toBe(true);
  });

  it('every rung passed: no current rung', () => {
    expect(ladder(stateAt(8), ctxFor(8)).current).toBeNull();
  });

  it('a later rung already met reports passed while an earlier one is current', () => {
    const s = structuredClone(EMPTY_STATS);
    s.countDrill.history = runs(flags(5, 5));
    const l = ladder(s, { sweepDone: false, now: NOW });
    expect(l.current).toBe(0);
    expect(l.rungs[2]!.passed).toBe(true);
  });

  it('rung 3 is the Drills picker fluency rule (fluencyGate reads the same result)', () => {
    const cases = [[], runs(flags(4, 4)), runs(flags(5, 5)), runs([true, true, false, false, true]), runs([true, true, true, false, true]), [...runs(flags(5, 5), 20), ...runs([true])]];
    for (const h of cases) {
      const s = stateAt(3); s.countDrill.history = h;
      expect(ladder(s, ctxFor(3)).rungs[2]!.passed).toBe(isCountFluent(h));
    }
    const s = stateAt(3); s.countDrill.history = runs([true, true, true, false, false]);
    expect(ladder(s, ctxFor(3)).rungs[2]!.progress).toBe('3/5 right (need 4)');
  });

  it('rung 4: 8 of the last 10 each; deck estimation first; 9 rows are too few', () => {
    const s = stateAt(4); s.countDrill.history = runs(flags(5, 5));
    s.deckEstimation.history = deckRows(flags(7, 10)); s.trueCount.history = tcRows(flags(10, 10));
    expect(ladder(s, ctxFor(4)).step.kind).toBe('deckest');
    expect(ladder(s, ctxFor(4)).rungs[3]!.progress).toBe('Decks 7/10 · TC 10/10 (need 8/10 each)');
    s.deckEstimation.history = deckRows(flags(8, 10)); s.trueCount.history = tcRows(flags(7, 10));
    expect(ladder(s, ctxFor(4)).step.kind).toBe('truecount');
    s.trueCount.history = tcRows(flags(8, 10));
    expect(ladder(s, ctxFor(4)).rungs[3]!.passed).toBe(true);
    s.trueCount.history = tcRows(flags(9, 9));
    expect(ladder(s, ctxFor(4)).rungs[3]!.passed).toBe(false);
    // Old misses outside the last 10 do not count against you.
    s.trueCount.history = tcRows([false, false, false, ...flags(10, 10)]);
    expect(ladder(s, ctxFor(4)).rungs[3]!.passed).toBe(true);
  });

  it('rung 6 reads stats.betSizing.history (contract 1): 8 of last 10, absent = not met', () => {
    const s = stateAt(6); withIndices(s);
    expect(ladder(s, ctxFor(6)).rungs[5]!.progress).toBe('No bet sizing answers yet');
    withBets(s, flags(7, 10));
    expect(ladder(s, ctxFor(6))).toMatchObject({ current: 5, step: { kind: 'betsizing' } });
    expect(ladder(s, ctxFor(6)).rungs[5]!.progress).toBe('7/10 right (need 8/10)');
    withBets(s, flags(8, 10));
    expect(ladder(s, ctxFor(6)).current).toBe(6);
  });

  it('rung 7: a session of 40+ graded decisions at 90%, among the last 5', () => {
    const s = stateAt(7);
    const row = (graded: number, correct: number) => ({ date: iso(1), rounds: 45, graded, correct, bankrollDelta: 0 });
    s.sessions = [row(39, 39)];
    expect(ladder(s, ctxFor(7)).rungs[6]!.passed).toBe(false);
    s.sessions = [row(40, 35)];
    expect(ladder(s, ctxFor(7)).rungs[6]!.passed).toBe(false);
    s.sessions = [row(40, 36)];
    expect(ladder(s, ctxFor(7)).rungs[6]!.passed).toBe(true);
    s.sessions = [row(40, 36), ...Array.from({ length: 5 }, () => row(10, 10))];
    expect(ladder(s, ctxFor(7)).rungs[6]!.passed).toBe(false);
  });

  it('survives legacy and corrupt rows (Review Focus 2)', () => {
    const s = stateAt(8);
    s.sessions = [{ date: 'garbage', rounds: 0, graded: 0, correct: 0, bankrollDelta: 0 }];
    (s as unknown as { betSizing: unknown }).betSizing = { history: [{ date: '', ok: 'yes' }] };
    const l = ladder(s, ctxFor(8));
    expect(l.rungs[5]!.passed).toBe(false);
    expect(l.rungs[6]!.passed).toBe(false);
    expect(JSON.stringify(l)).not.toMatch(/NaN|Infinity/);
  });
});
```

- [ ] **Step 2: Run and confirm it fails.** `npx vitest run src/ui/screens/ladder.test.ts`. Expected: FAIL with `ladder is not exported`.

- [ ] **Step 3: Implement** `ladderRules.ts` and `ladder()`/`nextStep()` with the signatures and the table above. Rung 1/2 logic is today's `stepFor` steps 1–3, unchanged. The rung 5 copy is today's step 4. Every step carries `progress: cats` (s02). Add `| 'betsizing'` to `DrillMode`. Update `fluencyGate.ts`'s doc comment. In `nextStep.test.ts`, import `stateAt` from `./ladder.test` (or copy the builder) and update the four tests named under **Files**.

- [ ] **Step 4: Run.** `npx vitest run src/ui/screens/ladder.test.ts src/ui/screens/nextStep.test.ts src/drills/fluencyGate.test.ts src/ui/drillLaunch.test.ts && npx tsc -b`. Expected: PASS, and tsc is clean (the `Drills.tsx` `launch ?? 'picker'` still type-checks because every `DrillLaunch` is a `DrillMode`).

- [ ] **Step 5: Mutation-check** (cp backup):
  - (a) `DRILL_WINDOW_NEEDED = 7`: the rung 4 and rung 6 tests fail.
  - (b) rung 3 rule changed to `right >= 3`: the fluencyGate cross-check fails.
  - (c) swap rungs 3 and 5 in the order: the `it.each` fails.
  - (d) `PLAY_MIN_GRADED = 39`: the rung 7 test fails.
  - (e) rung 7 judged over all sessions: the last rung 7 assertion fails.

- [ ] **Step 6: Commit.**
```bash
git add src/ui/screens/ladderRules.ts src/ui/screens/nextStep.ts src/ui/screens/ladderFixtures.ts src/ui/screens/ladder.test.ts src/ui/screens/nextStep.test.ts src/ui/screens/Drills.tsx src/drills/fluencyGate.ts
git commit -m "B2: casino-order ladder, seven rungs with recent-window pass rules; rung 6 reads betSizing (contract 1)"
```

### Task 4: B2, "Review N due" insertion and stalest-skill rotation

> **CONTROLLER RULING (overrides this task's `reviewLaunchSettings` design wherever they disagree):** Review's Start must NOT write or replace the user's saved Custom deck or any persisted Settings (s07 made Custom persistence a high-severity fix; silently replacing it regresses that). Instead, append to `src/ui/drillLaunch.ts` an in-memory hand-over next to the existing pending launch: `setReviewDeck(cellIds: readonly string[]): void` and `takeReviewDeck(): string[] | null` (cleared as read, never persisted, never replayed on reload). Review sets it and launches `'flash'` with settings unchanged (apart from `launchSettings('flash', undefined, …)` scope behaviour, which must not touch `drill.custom`). Lane H may make ONE minimal, clearly commented edit in `src/ui/screens/Drills.tsx` (precedent: Wave A F21) so Flashcards, when it mounts with a taken review deck, deals only those cell ids for that session. Unit test: `reviewLaunch` leaves `settings.drill.custom` and the saved settings byte-identical; e2e: after a Review session, the Custom editor still shows the user's previous Focus cells. Drop `reviewLaunchSettings` entirely.

**Files:**
- Modify: `src/ui/screens/ladderRules.ts` (append), `src/ui/screens/nextStep.ts` (the `ladder()` step choice)
- Modify (append only): `src/ui/drillLaunch.ts`, `src/ui/drillLaunch.test.ts`
- Modify: `src/ui/screens/ladder.test.ts` (append)

**Interfaces:**
- Produces (`ladderRules.ts`):
```ts
export const REVIEW_DUE_MIN = 20;
export interface DueCount { cells: string[]; indexes: string[]; total: number }
export function dueForReview(flashSr: SrDeck, quizSr: SrDeck, activeIndexIds: readonly string[], now: number): DueCount;
// due = card.box >= 1 && card.dueAt <= now; cells limited to generateAllCells() ids; indexes limited to activeIndexIds; both sorted
export type StaleKind = 'flash' | 'count' | 'deckest' | 'truecount' | 'quiz' | 'betsizing' | 'play';
export interface StaleSkill { kind: StaleKind; label: string; lastAt: number /* 0 = never */ }
export function stalestSkill(stats: Stats, quizSr: SrDeck, activeIndexIds: readonly string[]): StaleSkill;
```
  - Candidates, in ladder order:
    - flash 'Basic strategy': max `cellStats[*].lastAt`
    - count 'Running count': last `countDrill.history[].date`
    - deckest 'Deck estimation': last `deckEstimation.history[].date`
    - truecount 'True count': last `trueCount.history[].date`
    - quiz 'Deviations': max `quizSr[id].lastSeenAt` over active ids
    - betsizing 'Bet ramp': last `betSizingRows` date
    - play 'Play a shoe': last `sessions[].date`
  - Each time comes from `parseTime`. Pick the smallest `lastAt`; ties go to the earlier candidate.
- Produces (`drillLaunch.ts`, appended, existing branches untouched):
```ts
/** B2 "Review N due": Flashcards on a Custom deck whose Focus tier is exactly the due cells (mix 100/0/0), every hand type. */
export function reviewLaunchSettings(settings: Settings, cellIds: readonly string[]): Settings;
// → withScopes(settings, ALL_SCOPES), drill.deck 'custom', drill.custom = { tiers: {id:'focus'…}, painted: {}, mix: { focus: 100, regular: 0, rare: 0 }, favourMissed: false }
```
- Step choice in `ladder()`, first match wins:
  1. **review**, when `current === null || current >= 2` and `due.total >= REVIEW_DUE_MIN`. `kind` is `'flash'` if `due.cells.length >= due.indexes.length`, else `'quiz'`; `reviewCells = due.cells` when the kind is flash. Title: `Review ${total} due`. Why: `${cells} cells and ${indexes} indexes are due for review. Start reviews the ${cells|indexes}.`
  2. **rung**: the current rung's card.
  3. **stale**: kind = `stalestSkill(...).kind`. Title: `Keep it fresh: ${label}`. Why: `Every rung is done. ${label} was practised longest ago (${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}).`, where `days = max(0, floor((now − lastAt)/DAY))`. If `lastAt === 0` the why is `Every rung is done. ${label} has not been practised yet.`
  - Missing `flashSr`/`quizSr` means `{}`. Missing `now` means `Date.now()`.

- [ ] **Step 1: Write the failing tests.** Append to `ladder.test.ts` and put the new imports at the top of the file. `stateAt`, `iso`, `NOW` and `DAY` come from `ladderFixtures.ts`.

```ts
import type { SrCard, SrDeck } from '../../drills/spacedRepetition';
import { generateAllCells } from '../../drills/flashcards';
import { activeIndices } from './readiness';

const CELLS = generateAllCells().map((c) => c.id);
const ACTIVE = activeIndices().map((d) => d.id);
const card = (box: number, dueAt: number, lastSeenAt = dueAt - DAY): SrCard => ({ box, dueAt, lastSeenAt, lapses: 0, reviews: 3 });
const deckOf = (ids: readonly string[], c: SrCard): SrDeck => Object.fromEntries(ids.map((id) => [id, c]));

describe('Review N due (W2)', () => {
  const ctx = (flashSr: SrDeck, quizSr: SrDeck = {}) => ({ sweepDone: true, flashSr, quizSr, now: NOW });

  it('20 due cells put Review first once strategy is in hand; 19 do not', () => {
    const due = (n: number) => deckOf(CELLS.slice(0, n), card(2, NOW - DAY));
    expect(ladder(stateAt(3), ctx(due(19))).step.card).toBe('rung');
    const l = ladder(stateAt(3), ctx(due(20)));
    expect(l.step).toMatchObject({ card: 'review', kind: 'flash', title: 'Review 20 due' });
    expect(l.step.reviewCells).toEqual([...CELLS.slice(0, 20)].sort());
    expect(l.current).toBe(2); // the rung under it is unchanged
  });

  it('a card missed today (box 0), one not yet due, and a non-cell key are not due', () => {
    const sr = { ...deckOf(CELLS.slice(0, 19), card(2, NOW - DAY)), [CELLS[19]!]: card(0, NOW - 1), [CELLS[20]!]: card(3, NOW + DAY), junk: card(2, NOW - DAY) };
    expect(ladder(stateAt(3), ctx(sr)).step.card).toBe('rung');
  });

  it('nothing is inserted while rung 1 or 2 is current', () => {
    const sr = deckOf(CELLS.slice(0, 100), card(2, NOW - DAY));
    expect(ladder(stateAt(1), ctx(sr)).step.card).toBe('rung');
    expect(ladder(stateAt(2), { ...ctx(sr), sweepDone: false }).step.card).toBe('rung');
  });

  it('counts only active indexes, and reviews indexes when more of them are due', () => {
    const q = { ...deckOf(ACTIVE.slice(0, 15), card(2, NOW - DAY)), notAnIndex: card(2, NOW - DAY) };
    const l = ladder(stateAt(5), ctx(deckOf(CELLS.slice(0, 5), card(2, NOW - DAY)), q));
    expect(l.step).toMatchObject({ card: 'review', kind: 'quiz', title: 'Review 20 due' });
    expect(l.step.reviewCells).toBeUndefined();
  });

  it('after the ladder, Review still comes before the stalest skill', () => {
    expect(ladder(stateAt(8), ctx(deckOf(CELLS.slice(0, 20), card(1, NOW - DAY)))).step.card).toBe('review');
  });
});

describe('stalest skill after the ladder (W2)', () => {
  /** All rungs passed; each skill last practised `days` ago (deviations through quizSr). */
  function done(days: Partial<Record<'cells' | 'count' | 'deck' | 'tc' | 'quiz' | 'bets' | 'play', number>>) {
    const d = { cells: 1, count: 1, deck: 1, tc: 1, quiz: 1, bets: 1, play: 1, ...days };
    const s = stateAt(8);
    for (const t of Object.values(s.cellStats!)) t.lastAt = iso(d.cells);
    s.countDrill.history.forEach((r) => (r.date = iso(d.count)));
    s.deckEstimation.history.forEach((r) => (r.date = iso(d.deck)));
    s.trueCount.history.forEach((r) => (r.date = iso(d.tc)));
    (s as unknown as { betSizing: { history: { date: string }[] } }).betSizing.history.forEach((r) => (r.date = iso(d.bets)));
    s.sessions.forEach((r) => (r.date = iso(d.play)));
    const quizSr = deckOf(ACTIVE, card(3, NOW + 5 * DAY, NOW - d.quiz * DAY));
    return { s, ctx: { sweepDone: true, flashSr: {}, quizSr, now: NOW } };
  }

  it('rotates to the skill practised longest ago, saying how long', () => {
    const { s, ctx } = done({ deck: 30, tc: 2 });
    expect(ladder(s, ctx).step).toMatchObject({ card: 'stale', kind: 'deckest', title: 'Keep it fresh: Deck estimation' });
    expect(ladder(s, ctx).step.why).toMatch(/\(30 days ago\)/);
  });

  it('ties go to the earlier rung; never practised counts as oldest', () => {
    expect(ladder(done({ count: 9, quiz: 9 }).s, done({ count: 9, quiz: 9 }).ctx).step.kind).toBe('count');
    const { s, ctx } = done({});
    s.sessions.forEach((r) => (r.date = ''));
    expect(ladder(s, ctx).step).toMatchObject({ kind: 'play', why: 'Every rung is done. Play a shoe has not been practised yet.' });
  });

  it('a timestamp in the future (device clock behind) reads "today", never negative (Review Focus 3)', () => {
    const { s, ctx } = done({ bets: 40 });
    s.cellStats!['hard-16-v-10']!.lastAt = iso(-3);
    expect(ladder(s, ctx).step.why).toMatch(/40 days ago/);
    const fut = done({ cells: -3, count: -3, deck: -3, tc: -3, quiz: -3, bets: -3, play: -3 });
    expect(ladder(fut.s, fut.ctx).step.why).toMatch(/\(today\)/);
  });
});
```

Append to `src/ui/drillLaunch.test.ts`:

```ts
it('B2 review: Flashcards on a Custom deck whose Focus is exactly the due cells, every hand type', () => {
  const base = structuredClone(DEFAULT_SETTINGS); // deck 'chart' by default
  const out = reviewLaunchSettings(base, ['hard-16-v-10', 'pair-8-v-A']);
  expect(out.drill.deck).toBe('custom');
  expect(out.drill.scopes).toEqual(['hard', 'soft', 'pairs']);
  expect(out.drill.custom).toEqual({ tiers: { 'hard-16-v-10': 'focus', 'pair-8-v-A': 'focus' }, painted: {}, mix: { focus: 100, regular: 0, rare: 0 }, favourMissed: false });
  expect(out).not.toBe(base);
  expect(base.drill.deck).not.toBe('custom'); // input untouched
});
```

- [ ] **Step 2: Run and confirm it fails.** `npx vitest run src/ui/screens/ladder.test.ts src/ui/drillLaunch.test.ts`. Expected: the review and stale tests FAIL (the step is always `card: 'rung'`, or `current === null` leaves no step), and `reviewLaunchSettings` is not exported.

- [ ] **Step 3: Implement** `dueForReview`, `stalestSkill`, the step choice and `reviewLaunchSettings` as specified.

- [ ] **Step 4: Run.** `npx vitest run src/ui/screens/ladder.test.ts src/ui/screens/nextStep.test.ts src/ui/drillLaunch.test.ts && npx tsc -b`. Expected: PASS.

- [ ] **Step 5: Mutation-check:**
  - (a) `REVIEW_DUE_MIN = 19`: the 19/20 test fails.
  - (b) drop `box >= 1`: the box-0 test fails.
  - (c) allow review at `current >= 0`: the rung 1/2 test fails.
  - (d) drop the active-id filter: the index test fails (21 due, wrong title).
  - (e) pick the newest instead of the oldest: the stale test fails.
  - (f) drop `max(0, …)`: the clock test fails.

- [ ] **Step 6: Commit.**
```bash
git add src/ui/screens/ladderRules.ts src/ui/screens/nextStep.ts src/ui/screens/ladder.test.ts src/ui/drillLaunch.ts src/ui/drillLaunch.test.ts
git commit -m "B2: Review N due from the SR schedule (20+), then rotate to the stalest skill once the ladder is done"
```

### Task 5: B2 on Home, seven compact rows and one gold Start

**Files:**
- Create: `src/ui/screens/LadderCard.tsx` (exports only the component; no lint warning)
- Modify: `src/ui/screens/Home.tsx` (card above `.readiness`; `openStep(target)`)
- Modify: `src/ui/screens/nextStep.css` (ladder rows)
- Create: `e2e/ladder.spec.ts`
- Modify: `e2e/next-step.spec.ts`. The `'once all three categories meet the goal…'` test now asserts `[data-rung="basic"]` has `data-state="done"` and that `.next-step-progress` has count 0 (the goal-met line is replaced by the ✓ row). The final W13 test seeds `stateAt(8)`-equivalent stats (deck, tc, bets, session) and expects `data-card="stale"`, or `data-step="play"` with a session row dropped (pick one).
- Modify: `e2e/layout-guard.spec.ts` (hit targets: `.ladder-row` and `.next-step-btn` ≥ 44px)

**Interfaces:**
- Consumes: `ladder`, `Ladder`, `NextStep`, `StartTarget` (Task 3/4), `launchSettings`, `reviewLaunchSettings`, `setDrillLaunch` (drillLaunch.ts), `loadFlashSr`, `loadQuizSr` (drills/gradeAnswer.ts).
- Produces:
  - `LadderCard({ ladder, onStart }: { ladder: Ladder; onStart: (t: StartTarget, reviewCells?: string[]) => void })`.
  - DOM contract the e2e relies on:
    - `section.next-step[aria-label="Next step"][data-step={step.kind}][data-card={step.card}]`
    - `button.next-step-btn.u-btn.u-btn-primary[data-launch={step.kind}]` with text `Start`
    - `ol.ladder > li > button.ladder-row[data-rung={id}][data-state=done|current|locked]`, plus `aria-current="step"` on the current row. Accessible name: `${n}. ${label}` plus `, done` or `, current` or `, not yet`. The row shows its `progress` only when current.
    - When `current === 0`, the existing `ul.next-step-progress` with `[data-hand]` rows (s02) appears under the why. The `basic-goal-met` line is removed.
- Home `openStep(t, reviewCells)`:
  - `play` navigates to `'table'`.
  - Otherwise the next settings are `reviewCells ? reviewLaunchSettings(settings, reviewCells) : launchSettings(t.kind, t.scope, settings)`. Save them and lift them if they changed. Then `setDrillLaunch(t.kind)` and `onNavigate('drills')`.
  - Rows call `openStep(row.start)`. Start calls `openStep(step, step.reviewCells)`.
  - Home passes `ctx = { sweepDone, rules, flashSr: loadFlashSr(), quizSr: loadQuizSr(), now: Date.now() }`.
- CSS: `.ladder-row { min-height: 44px; display: grid; grid-template-columns: 1.75rem 1fr; }`. Use one secondary style (no `u-btn-primary`). Done rows show ✓ in `--good`, the current row is accented, locked rows are dimmed (`--ink-dim`) but stay enabled. The progress line spans column 2, at a 12px minimum and AA contrast.

- [ ] **Step 1: Write `e2e/ladder.spec.ts`** (failing):

```ts
import { test, expect, type Page } from '@playwright/test';
import { generateAllCells } from '../src/drills/flashcards'; // e2e already imports from src (helpers.ts)

test.use({ viewport: { width: 375, height: 812 } });

const CELLS = generateAllCells().map((c) => c.id);
const D = '2026-10-16T10:00:00.000Z';
const STRONG = { 'hard-16-v-10': { right: 30, wrong: 0, lastAt: D }, 'soft-18-v-9': { right: 30, wrong: 0, lastAt: D }, 'pair-8-v-A': { right: 30, wrong: 0, lastAt: D } };
const IDS = ['ins', '16v10', '15v10', 'TTv5', 'TTv6', '10v10', '12v3', '12v2', '11vA', '9v2', '10vA', '9v7', '16v9', '13v2', '12v4', '12v5', '12v6', '13v3', '14v10', '15v9', '15vA'];
const many = <T>(n: number, row: T) => Array.from({ length: n }, () => row);
const RUNG_STATS: Record<number, Record<string, unknown>> = {
  1: {},
  2: { cellStats: STRONG },
  3: { cellStats: STRONG, masterySweepsCompleted: 1 },
};
RUNG_STATS[4] = { ...RUNG_STATS[3], countDrill: { history: many(5, { date: D, cards: 52, intervalMs: 700, correct: true }) } };
RUNG_STATS[5] = { ...RUNG_STATS[4], deckEstimation: { history: many(10, { date: D, actualDecks: 3, guess: 3, errorDecks: 0, correct: true }) }, trueCount: { history: many(10, { date: D, runningCount: 6, decksRemaining: 3, guess: 2, correctTc: 2, correct: true }) } };
RUNG_STATS[6] = { ...RUNG_STATS[5], perIndex: Object.fromEntries(IDS.map((id) => [id, { right: 10, wrong: 0 }])) };
RUNG_STATS[7] = { ...RUNG_STATS[6], betSizing: { history: many(10, { date: D, rc: 6, decksRemaining: 3, tc: 2, taken: 4, correct: 4, ok: true }) } };
RUNG_STATS[8] = { ...RUNG_STATS[7], sessions: [{ date: D, rounds: 45, graded: 40, correct: 38, bankrollDelta: 0 }] };

async function seed(page: Page, stats: Record<string, unknown>, flashSrDue = 0) {
  await page.addInitScript(([s, ids]) => {
    localStorage.setItem('bjtrainer.stats.v1', JSON.stringify({ version: 1, ...s }));
    if (ids.length > 0) {
      const past = Date.now() - 86_400_000;
      localStorage.setItem('bjtrainer.flashsr.v1', JSON.stringify(Object.fromEntries(ids.map((id) => [id, { box: 2, dueAt: past, lastSeenAt: past - 86_400_000, lapses: 0, reviews: 3 }]))));
    }
  }, [stats, CELLS.slice(0, flashSrDue)] as const);
}
const card = (page: Page) => page.getByRole('region', { name: 'Next step' });
const startBtn = (page: Page) => card(page).getByRole('button', { name: 'Start', exact: true });

const LANDS: [number, string, string, (p: Page) => Promise<void>][] = [
  [1, 'basic', 'flash', async (p) => { await expect(p.locator('.drill-heading')).toHaveText('Flashcards'); }],
  [2, 'repair', 'mastery', async (p) => { await expect(p.getByTestId('mastery-progress')).toBeVisible(); }],
  [3, 'count', 'count', async (p) => { await expect(p.locator('.drill-heading')).toHaveText('Count drill'); }],
  [4, 'tc', 'deckest', async (p) => { await expect(p.locator('.drill-heading')).toHaveText('Deck estimation'); }],
  [5, 'deviations', 'quiz', async (p) => { await expect(p.locator('.drill-heading')).toHaveText('Deviation quiz'); }],
  // Before merge the drill does not exist on this branch: assert the launch key and the route only.
  [6, 'betramp', 'betsizing', async (p) => { await expect(p.locator('.tab-bar [aria-current="page"]')).toContainText('Drills'); }],
  [7, 'play', 'play', async (p) => { await expect(p.locator('.table-screen')).toBeVisible(); }],
];

for (const [r, id, kind, lands] of LANDS) {
  test(`rung ${r} (${id}): Home lands on it and Start opens ${kind}`, async ({ page }) => {
    await seed(page, RUNG_STATS[r]!);
    await page.goto('/?e2e=1');
    await expect(card(page)).toHaveAttribute('data-card', 'rung');
    await expect(page.locator('.ladder-row')).toHaveCount(7);
    await expect(page.locator(`.ladder-row[data-rung="${id}"]`)).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('.ladder-row[data-state="done"]')).toHaveCount(r - 1);
    await expect(startBtn(page)).toHaveAttribute('data-launch', kind);
    await expect(startBtn(page)).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.home-screen .u-btn-primary')).toHaveCount(1);
    await startBtn(page).click();
    await lands(page);
  });
}

test('a locked row is still tappable and opens its own drill', async ({ page }) => {
  await page.goto('/?e2e=1');
  await expect(page.locator('.ladder-row[data-rung="count"]')).toHaveAttribute('data-state', 'locked');
  await page.locator('.ladder-row[data-rung="count"]').click();
  await expect(page.locator('.drill-heading')).toHaveText('Count drill');
});

test('Review N due comes first and opens Flashcards on exactly the due cells', async ({ page }) => {
  await seed(page, RUNG_STATS[4]!, 24);
  await page.goto('/?e2e=1');
  await expect(card(page)).toHaveAttribute('data-card', 'review');
  await expect(card(page)).toContainText('Review 24 due');
  await expect(page.locator('.ladder-row[data-rung="tc"]')).toHaveAttribute('aria-current', 'step');
  await startBtn(page).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');
  const drill = await page.evaluate(() => JSON.parse(localStorage.getItem('bjtrainer.settings.v1') ?? '{}').drill);
  expect(drill.deck).toBe('custom');
  expect(Object.keys(drill.custom.tiers)).toHaveLength(24);
  expect(new Set(Object.values(drill.custom.tiers))).toEqual(new Set(['focus']));
});

test('with every rung done, the card rotates to the stalest skill', async ({ page }) => {
  const old = '2026-09-01T10:00:00.000Z';
  const s = structuredClone(RUNG_STATS[8]!) as { deckEstimation: { history: { date: string }[] } };
  s.deckEstimation.history.forEach((r) => (r.date = old));
  await seed(page, s);
  await page.addInitScript((ids) => {
    const soon = Date.now() + 5 * 86_400_000, seen = Date.now() - 86_400_000;
    localStorage.setItem('bjtrainer.quizsr.v1', JSON.stringify(Object.fromEntries(ids.map((id) => [id, { box: 3, dueAt: soon, lastSeenAt: seen, lapses: 0, reviews: 4 }]))));
  }, IDS);
  await page.goto('/?e2e=1');
  await expect(card(page)).toHaveAttribute('data-card', 'stale');
  await expect(card(page)).toContainText('Keep it fresh: Deck estimation');
  await expect(startBtn(page)).toHaveAttribute('data-launch', 'deckest');
});
```

- [ ] **Step 2: Run and confirm it fails.** `E2E_PORT=4740 npx playwright test e2e/ladder.spec.ts --project=chromium --reporter=line`. Expected: FAIL, because there are no `.ladder-row` elements or `data-card`/`data-launch` attributes yet.

- [ ] **Step 3: Implement** `LadderCard.tsx`, the Home wiring and the CSS per **Interfaces**. Move the card above `.readiness`. Keep the Play-a-shoe secondary hidden when `step.kind === 'play'` (W13).

- [ ] **Step 4: Run.** `E2E_PORT=4740 npx playwright test e2e/ladder.spec.ts e2e/next-step.spec.ts e2e/layout-guard.spec.ts e2e/home-build.spec.ts e2e/smoke.spec.ts --project=chromium --reporter=line && npx tsc -b && npm run lint`. Expected: PASS, with lint at 13 warnings.

- [ ] **Step 5: Mutation-check:**
  - (a) Home ignores `reviewCells` (always calls `launchSettings`): the review test fails (deck `chart`).
  - (b) rows call `openStep(step)` instead of `row.start`: the locked-row test fails.
  - (c) the card is placed after `.readiness`: the `toBeInViewport` check at rung 7 fails. If it still passes, extend the assertion to check that the Start bottom is above the tab-bar top.

- [ ] **Step 6: Visual check.** Take headless 375×812 screenshots of Home at rung 1, rung 4 and review, in midnight-felt and bone-ink, via a `shot()` call guarded by `B1_SHOTS`. Open them and check that the rows read compact, there is exactly one gold button, and done/current/locked are distinct without relying on hue.

- [ ] **Step 7: Commit.**
```bash
git add src/ui/screens/LadderCard.tsx src/ui/screens/Home.tsx src/ui/screens/nextStep.css e2e/ladder.spec.ts e2e/next-step.spec.ts e2e/layout-guard.spec.ts
git commit -m "B2: Home shows the seven-rung ladder with one gold Start; rows open their own drill"
```

### Task 6: Wave A leftovers, the bet ramp never shows "TC ≥ −99", and "Edit profile and bet ramp" opens the ramp

**Files:**
- Create: `src/ui/spreadRows.ts`, `src/ui/spreadRows.test.ts`, `src/ui/profileLaunch.ts`, `src/ui/profileLaunch.test.ts`, `src/ui/screens/profileRamp.css`, `e2e/profile-ramp.spec.ts`
- Modify: `src/ui/screens/ProfileEditor.tsx` (initial mode, the ramp rows at 548-566, CVCX preview col 682, ramp anchor, launched exit)
- Modify: `src/ui/components/TabSettingsButton.tsx:165-176` (that one button only)
- Modify: `e2e/tab-settings.spec.ts:179-187`. Retarget it to `'Edit profile and bet ramp'`, or delete it in favour of `profile-ramp.spec.ts`.

**Interfaces:**
- Produces (`spreadRows.ts`):
```ts
export const SPREAD_FLOOR_TC = -20;   // a row at or below this is the "any count" floor (DEFAULT_SPREAD's −99 sentinel)
export const SPREAD_MIN_TC = -10;     // the TC stepper never goes below this
export function isFloorRow(row: SpreadRow): boolean;
export function spreadTcText(row: SpreadRow): string;   // floor → 'Any count'; else plainNumber(row.minTc) ('−2', '0', '3')
export function stepMinTc(row: SpreadRow, delta: 1 | -1): number; // clamp to >= SPREAD_MIN_TC; a floor row is returned unchanged
```
- Produces (`profileLaunch.ts`):
```ts
export interface ProfileLaunch { section: 'ramp'; returnTo: Screen }
export function setProfileLaunch(l: ProfileLaunch): void;
export function takeProfileLaunch(): ProfileLaunch | null; // cleared as read
```
- ProfileEditor:
  - `const [launch] = useState(takeProfileLaunch)`. When it is set, the initial mode is `{ kind: 'edit', draft: structuredClone(getActiveProfile()), isNew: false }`.
  - `ProfileEditForm` gets `openRamp: boolean`. The ramp `CollapsibleSection` gets `defaultOpen={openRamp}`.
  - On mount, `openRamp` scrolls `.profile-ramp-anchor` into view: the wrapper around the ramp section, or around the "Vary bets with the count" toggle row when `betSpreadOn` is false (`data-testid="profile-ramp"` / `"profile-ramp-toggle"`).
  - When launched, Save and Cancel set `mode` to list and `exitTo` to `launch.returnTo`. A `useEffect([exitTo])` calls `onNavigate(exitTo)`. It runs after the form unmounts, so the leave guard is already cleared and no confirm appears.
  - Floor rows render `<div className="spread-field"><span className="spread-field-label">Any count</span></div>` with no TC stepper. Other rows show `TC ≥` and `spreadTcText(row)`, stepped with `stepMinTc`. The CVCX preview col shows `isFloorRow ? 'Any' : plainNumber`.
- `profileRamp.css`: `.profile-ramp-anchor { scroll-margin-top: calc(var(--safe-top, 0px) + var(--topbar-h) + 8px); }`
- TabSettingsButton Play sheet button: text `Edit profile and bet ramp`. onClick runs `finish(); setProfileLaunch({ section: 'ramp', returnTo: 'table' }); ctx.navigate('profiles');`. Update its comment.

- [ ] **Step 1: Write the failing tests.** `src/ui/spreadRows.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isFloorRow, spreadTcText, stepMinTc } from './spreadRows';

describe('bet ramp rows (Wave A leftover)', () => {
  it('the −99 sentinel is the any-count floor and is never printed as a number', () => {
    expect(isFloorRow({ minTc: -99, units: 1 })).toBe(true);
    expect(isFloorRow({ minTc: -20, units: 1 })).toBe(true);
    expect(isFloorRow({ minTc: -19, units: 1 })).toBe(false);
    expect(spreadTcText({ minTc: -99, units: 1 })).toBe('Any count');
  });
  it('real minus sign on negative counts', () => {
    expect(spreadTcText({ minTc: -2, units: 1 })).toBe('−2');
    expect(spreadTcText({ minTc: 0, units: 1 })).toBe('0');
  });
  it('the stepper stops at −10 and leaves the floor alone', () => {
    expect(stepMinTc({ minTc: -10, units: 1 }, -1)).toBe(-10);
    expect(stepMinTc({ minTc: 0, units: 1 }, 1)).toBe(1);
    expect(stepMinTc({ minTc: -99, units: 1 }, 1)).toBe(-99);
  });
});
```

`src/ui/profileLaunch.test.ts`:

```ts
import { expect, it } from 'vitest';
import { setProfileLaunch, takeProfileLaunch } from './profileLaunch';
it('is handed across one navigation and cleared as read', () => {
  expect(takeProfileLaunch()).toBeNull();
  setProfileLaunch({ section: 'ramp', returnTo: 'table' });
  expect(takeProfileLaunch()).toEqual({ section: 'ramp', returnTo: 'table' });
  expect(takeProfileLaunch()).toBeNull();
});
```

`e2e/profile-ramp.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';
import { withProfile } from './helpers';

test.use({ viewport: { width: 375, height: 812 } });
const ramp = (page: Page) => page.getByTestId('profile-ramp');

async function openFromPlayGear(page: Page) {
  await page.goto('/?seed=2&e2e=1');
  await page.locator('.tab-bar').getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Play settings' }).click();
  await page.getByRole('dialog', { name: 'Play settings' }).getByRole('button', { name: 'Edit profile and bet ramp', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Edit profile');
}

test('the ramp editor never shows the −99 sentinel, and negative counts use a real minus', async ({ page }) => {
  await withProfile(page, { betSpreadOn: true, spread: [{ minTc: -99, units: 1 }, { minTc: -1, units: 2 }, { minTc: 2, units: 4 }] });
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(ramp(page)).not.toContainText('99');
  await expect(ramp(page).locator('.spread-row').first()).toContainText('Any count');
  await expect(ramp(page).locator('.spread-row').nth(1).locator('.stepper-value').first()).toHaveText('−1');
});

test('Edit profile and bet ramp opens the active profile at its ramp, and Save returns to Play', async ({ page }) => {
  await withProfile(page, { betSpreadOn: true });
  page.on('dialog', (d) => { throw new Error(`unexpected dialog: ${d.message()}`); });
  await openFromPlayGear(page);
  await expect(ramp(page)).toBeInViewport();
  const bar = await page.locator('.settings-topbar').boundingBox();
  expect((await ramp(page).boundingBox())!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height - 1);
  await ramp(page).locator('.spread-row').last().getByRole('button', { name: '+', exact: true }).last().click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.table-screen')).toBeVisible();
});

test('with the spread off, it lands on the Vary bets toggle (Review Focus 4)', async ({ page }) => {
  await withProfile(page, { betSpreadOn: false });
  await openFromPlayGear(page);
  await expect(page.getByTestId('profile-ramp-toggle')).toBeInViewport();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.table-screen')).toBeVisible();
});
```

- [ ] **Step 2: Run and confirm failures.** Run `npx vitest run src/ui/spreadRows.test.ts src/ui/profileLaunch.test.ts` and expect module-not-found. Run `E2E_PORT=4740 npx playwright test e2e/profile-ramp.spec.ts --project=chromium --reporter=line` and expect FAIL (the `'99'` text, the missing button).

- [ ] **Step 3: Implement** per **Interfaces**.

- [ ] **Step 4: Run.** `npx vitest run src/ui/spreadRows.test.ts src/ui/profileLaunch.test.ts && E2E_PORT=4740 npx playwright test e2e/profile-ramp.spec.ts e2e/profiles.spec.ts e2e/profile-editor-guard.spec.ts e2e/tab-settings.spec.ts e2e/cycle1.spec.ts --project=chromium --reporter=line && npx tsc -b`. Expected: PASS. `profiles.spec.ts`'s ramp test still passes, because the floor row keeps `.spread-field` nth(0), so Units stays nth(1).

- [ ] **Step 5: Mutation-check:**
  - (a) `SPREAD_FLOOR_TC = -100`: the sentinel unit test and the e2e `'99'` test fail.
  - (b) the launched Save navigates synchronously instead of via `exitTo`: the dialog handler throws.
  - (c) drop `scroll-margin-top`: the ramp-under-bar assertion fails.

- [ ] **Step 6: Commit.**
```bash
git add src/ui/spreadRows.ts src/ui/spreadRows.test.ts src/ui/profileLaunch.ts src/ui/profileLaunch.test.ts src/ui/screens/profileRamp.css src/ui/screens/ProfileEditor.tsx src/ui/components/TabSettingsButton.tsx e2e/profile-ramp.spec.ts e2e/tab-settings.spec.ts
git commit -m "Profile editor: the ramp floor reads 'Any count', real minus; 'Edit profile and bet ramp' opens the ramp and returns to Play"
```

### Task 7: Wave A leftovers, real minus in the peek readout and Stats rows

**Files:**
- Modify: `src/ui/peekFlag.ts:21-25` (`signedFixed` uses `MINUS` from `../drills/signed` and is exported)
- Modify: `src/ui/peekFlag.test.ts:47-51` (expected strings now use U+2212)
- Modify: `src/ui/screens/Stats.tsx:1520` and `:1561`. Drift becomes `` `${signedFixed(fatigue.drift * 100, 0)}%` `` and Pace drift becomes `` `${signedFixed(pace.driftMs / 1000, 1)}s` ``. Positive values keep `+`, zero stays unsigned (`0.0s` and `0%`, as today).
- Modify: `e2e/game.spec.ts:479`. In the peek regex, `[+-]` becomes `[+−]` in both places.
- Create: `e2e/stats-real-minus.spec.ts`

**Interfaces:**
- Produces: `export function signedFixed(n: number, digits: number): string` in `src/ui/peekFlag.ts` ('+1.4', '−2.8', '0.0'; rounded before the sign is chosen).

- [ ] **Step 1: Write the failing tests.** Update `peekFlag.test.ts` (`'RC −7 · TC −2.8'`, `'RC −1 · TC −0.2'`) and add:

```ts
import { signedFixed } from './peekFlag';
it('signedFixed: real minus, plus on positives, zero unsigned after rounding', () => {
  expect(signedFixed(-2.75, 1)).toBe('−2.8');
  expect(signedFixed(2, 1)).toBe('+2.0');
  expect(signedFixed(-0.04, 1)).toBe('0.0');
  expect(signedFixed(-50, 0)).toBe('−50');
});
```

`e2e/stats-real-minus.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { withStats, statsTab } from './helpers';

const MIN = 60_000;
const fatigue = (page: import('@playwright/test').Page) => page.locator('.stats-section', { hasText: 'Fatigue' });

test('Pace drift that speeds up reads with a real minus', async ({ page }) => {
  const base = Date.now() - 86_400_000;
  const row = (i: number, ms: number) => ({ category: 'hard', elapsedMs: ms, date: new Date(base + i * MIN).toISOString() });
  await withStats(page, { latencyHistory: [row(0, 3000), row(1, 3000), row(2, 3000), row(3, 1000), row(4, 1000), row(5, 1000)] });
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Progress');
  await expect(fatigue(page).locator('.mistake-row', { hasText: 'Pace drift' })).toContainText('−2.0s');
});

test('accuracy Drift that falls reads with a real minus', async ({ page }) => {
  const T0 = Date.parse('2026-07-31T10:00:00.000Z');
  const history = Array.from({ length: 8 }, (_, i) => ({ date: new Date(T0 + i * MIN).toISOString(), cards: 20, intervalMs: 800, correct: i < 4 }));
  await withStats(page, { countDrill: { history } });
  await page.goto('/?e2e=1');
  await page.locator('.home-stats-link').click();
  await statsTab(page, 'Progress');
  const drift = fatigue(page).locator('.mistake-row').filter({ hasText: /^Drift/ });
  await expect(drift).toContainText('−100%');
  await expect(drift).not.toContainText('-100%');
});
```

- [ ] **Step 2: Run and confirm failures.** `npx vitest run src/ui/peekFlag.test.ts && E2E_PORT=4740 npx playwright test e2e/stats-real-minus.spec.ts --project=chromium --reporter=line`. Expected: FAIL (ASCII hyphen; `signedFixed` not exported).

- [ ] **Step 3: Implement** as described.

- [ ] **Step 4: Run.** `npx vitest run src/ui/peekFlag.test.ts && E2E_PORT=4740 npx playwright test e2e/stats-real-minus.spec.ts e2e/latency-drift.spec.ts e2e/settings-stats.spec.ts e2e/game.spec.ts e2e/peek-and-dealer.spec.ts --project=chromium --reporter=line`. Expected: PASS.

- [ ] **Step 5: Mutation-check:**
  - (a) `signedFixed` back to `'-'`: both units fail.
  - (b) revert either Stats call site: the matching e2e fails.

- [ ] **Step 6: Commit.**
```bash
git add src/ui/peekFlag.ts src/ui/peekFlag.test.ts src/ui/screens/Stats.tsx e2e/stats-real-minus.spec.ts e2e/game.spec.ts
git commit -m "Real minus (U+2212) in the peek readout and Stats drift rows"
```

### Task 8: Gate run

**Files:** none (fix forward in the owning task's files if a gate fails, then re-run from the top).

- [ ] **Step 1:** `npx tsc -b`. Expected: no output, exit 0.
- [ ] **Step 2:** `npx vitest run`. Expected: all files pass, including `ladder.test.ts`, `nextStep.test.ts`, `drillLaunch.test.ts`, `spreadRows.test.ts`, `profileLaunch.test.ts`, `peekFlag.test.ts` and `fluencyGate.test.ts`.
- [ ] **Step 3:** `npm run lint`. Expected: `Found 13 warnings` and 0 errors.
- [ ] **Step 4:** `npm run build`, then check what ships:
```bash
grep -l -- "--mute-seat" dist/assets/*.css
grep -o -- "--mute-h:0px\|--mute-h:0" dist/assets/*.css | head -1
grep -l "Keep it fresh" dist/assets/*.js
grep -l "Review " dist/assets/*.js
grep -l "Edit profile and bet ramp" dist/assets/*.js
grep -l "Any count" dist/assets/*.js
test ! -e src/ui/stickyTopbars.css && echo "stickyTopbars gone"
```
Expected: every line prints something. The minifier may write `0px` as `0`, which the second pattern covers.
- [ ] **Step 5:** Targeted e2e on port 4740:
```bash
E2E_PORT=4740 npx playwright test e2e/layout-guard.spec.ts e2e/safe-area.spec.ts e2e/mute.spec.ts e2e/charts.spec.ts e2e/charts-return.spec.ts e2e/chart-note.spec.ts e2e/ladder.spec.ts e2e/next-step.spec.ts e2e/home-build.spec.ts e2e/profile-ramp.spec.ts e2e/profiles.spec.ts e2e/profile-editor-guard.spec.ts e2e/tab-settings.spec.ts e2e/cycle1.spec.ts e2e/stats-real-minus.spec.ts e2e/latency-drift.spec.ts e2e/settings-stats.spec.ts e2e/stats-wave-a.spec.ts e2e/collapsible-sections.spec.ts e2e/game.spec.ts e2e/peek-and-dealer.spec.ts e2e/table-seats.spec.ts e2e/topbar-profile-name.spec.ts e2e/drill-layout.spec.ts e2e/drills.spec.ts e2e/custom-drill-editor.spec.ts e2e/count-numpad-width.spec.ts e2e/gutters.spec.ts e2e/field-test-layout.spec.ts e2e/error-boundary.spec.ts e2e/smoke.spec.ts e2e/themes.spec.ts --project=chromium --reporter=line
```
Expected: all pass. A failure that appears only under load is "late versus absent": read `error-context.md` and do not raise the timeout.
- [ ] **Step 6:** Read the B1 and ladder screenshots one last time. Then report the branch head SHA to the controller. Do not merge.

---

## Cross-lane requests

- **D (Charts.tsx, charts specs):** H changes only the top-bar back-button element in `Charts.tsx`. It renders only when `onBack` is given, with text `Back` and `aria-label={backText}`. H also edits `e2e/charts.spec.ts` (the line-38 Back to Home, the line-282 bottom check, and the `'#24: the disc is not moved…'` test) and `e2e/charts-return.spec.ts` (three assertions). Please do not restyle `.charts-back-btn`/`.charts-heading` white-space or shrink `.charts-topbar` below 56px.
- **N (new drill views):** use `.drill-topbar` + `.drill-back-btn` like every existing drill view, so the seat, sticky and inset rules in `muteSeat.css` apply. The `DrillMode` line `| 'betsizing'` is identical on both branches. H's rung 6 reads `stats.betSizing.history[].ok` and `.date` through a local cast in `ladderRules.ts`; the controller drops the cast after merge.
- **P (Play):** H's `muteSeat.css` makes `.table-screen > .topbar` sticky and gives its `.tab-gear` a `margin-right` seat (row 1 col 3). Keep the gear in that grid cell. H also edits `e2e/game.spec.ts:479` (peek regex accepts U+2212) and only the Play sheet's "Profiles" button in `TabSettingsButton.tsx`.
- **Controller (after merge):** if P's contract-4 Custom writer matches `reviewLaunchSettings` (Focus = exactly the given cells, no Auto), point Review at it and drop the duplicate.
