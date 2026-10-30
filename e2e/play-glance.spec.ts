import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile, resolveInsurance, playRoundByAdvice, shot, openCountOptions, pastCountLeadIn } from './helpers';

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

/** A multi-hand banner: the play-order label, then the full solo grammar. */
const HAND_BANNER = new RegExp(`^Hand [1-9]: ${BANNER.source.slice(1)}`);

// Two hands, so the "Hand N:" label makes a banner too long for one line at
// 375px: a banner that cannot wrap runs into the strip's padding and fails
// here. The bound is the strip's content box, not the viewport -- an unwrapped
// two-hand banner is ~375px wide, so it sits exactly on the screen edges.
for (const theme of THEMES) {
  test(`B5/W5: the banners sit inside the message strip at 375px in ${theme}`, async ({ page }) => {
    await withSettings(page, { countCheckEvery: 0, dealSpeedMs: 0, theme });
    await withProfile(page, { seats: { ...SOLO, playerHands: 2 } });
    await dealPlayerTurn(page);
    await playRoundByAdvice(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const banners = page.locator('.round-banner');
    await expect(banners.first()).toBeVisible();
    const n = await banners.count();
    expect(n).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < n; i++) await expect(banners.nth(i)).toHaveText(HAND_BANNER);
    const strip = await page.locator('.message-strip').evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { left: r.left + parseFloat(cs.paddingLeft), right: r.right - parseFloat(cs.paddingRight) };
    });
    const parts = await boxes(page, '.round-banner, .round-banner-head, .round-banner-totals');
    expect(parts.length).toBe(n * 3);
    for (const b of parts) {
      expect(b.x).toBeGreaterThanOrEqual(strip.left - 0.5);
      expect(b.right).toBeLessThanOrEqual(strip.right + 0.5);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await shot(page, `b5-banner-${theme}`);
  });
}

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
  // Read once: at 400ms a card the deal ends by itself in a second or two, and
  // the control goes with it, so a retrying count(0) passes on a dead button.
  // The click is a discrete event; React has committed by the time it returns.
  expect(await ff.count(), 'Skip did not dismiss itself').toBe(0);
});

for (const [group, min] of [[1, 96], [3, 70]] as const) {
  test(`B5/W4: the Count drill flashes big cards (group of ${group})`, async ({ page }) => {
    await withSettings(page, { drill: { countLengthCards: 6, countGroup: group, countManual: true } });
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: 'Count drill', exact: true }).click();
    await openCountOptions(page);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await pastCountLeadIn(page);
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
    // The 220ms fly-in would catch the cards half-faded; shoot them at rest.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await withSettings(page, { theme, countCheckEvery: 0, dealSpeedMs: 0 });
    await withProfile(page, { seats: { ...SOLO, playerHands: 2 } });
    await dealPlayerTurn(page);
    await shot(page, `b5-felt-${theme}`);
    await playRoundByAdvice(page);
    await shot(page, `b5-banner-${theme}`);
  });
}

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
/**
 * Worst-case contrast of an element's text against every background it can
 * sit on, for EVERY element the selector matches.
 *
 * B2 #32: translucent layers are COMPOSITED down to the first opaque ground
 * (a colour, or a gradient whose stops are all opaque -- each stop is a
 * candidate ground). It used to skip any background with alpha <= 0.9 and
 * measure against the opaque card underneath, so a grey rgb(0 0 0 / 22%) box
 * on Bone-ink's cream, and a gold tint under gold text, passed while failing.
 */
async function worstContrast(page: Page, sel: string): Promise<number> {
  const got = await page.locator(sel).evaluateAll((els) => {
    // Any computed colour as sRGB 0-255 plus alpha. Chrome serialises
    // color-mix() results as color(srgb ...) or oklab(...), not rgb().
    const rgba = (v: string): number[] => {
      const n = (v.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
      const a = n.length > 3 ? n[3]! : 1;
      if (v.startsWith('color(srgb')) return [n[0]! * 255, n[1]! * 255, n[2]! * 255, a];
      if (v.startsWith('oklab(')) {
        const [L, A, B] = [n[0]!, n[1]!, n[2]!];
        const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
        const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
        const s2 = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
        const lin = [
          4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s2,
          -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s2,
          -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s2,
        ];
        const enc = (x: number) => 255 * Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
        return [...lin.map(enc), a];
      }
      return [n[0]!, n[1]!, n[2]!, a];
    };
    const over = (top: number[], under: number[]) => { const a = top[3]!; return [0, 1, 2].map((i) => top[i]! * a + under[i]! * (1 - a)).concat(1); };
    return els.map((el) => {
      // Layers from the element outwards; each is a list of alternative colours.
      const layers: number[][][] = [];
      let base: number[][] | null = null;
      for (let e: Element | null = el; e && !base; e = e.parentElement) {
        const cs = getComputedStyle(e);
        const bg = rgba(cs.backgroundColor);
        const stops = (cs.backgroundImage.match(/(?:rgba?|color|oklab|oklch|lab|lch)\([^)]*\)/g) ?? []).map(rgba);
        // backgroundImage paints over backgroundColor on the same element.
        const own: number[][][] = [];
        if (stops.length > 0) own.push(stops);
        if (bg[3]! > 0) own.push([bg]);
        for (const layer of own) {
          if (layer.every((c) => c[3]! >= 0.999)) { base = layer; break; }
          layers.push(layer);
        }
      }
      let grounds = base ?? [[255, 255, 255, 1]];
      for (const layer of layers.reverse()) grounds = grounds.flatMap((g) => layer.map((c) => over(c, g)));
      const fg = rgba(getComputedStyle(el).color);
      return { text: (el as HTMLElement).innerText.trim(), fgs: grounds.map((g) => over(fg, g)), grounds };
    });
  });
  expect(got.length, `vacuity guard: ${sel} matched nothing`).toBeGreaterThan(0);
  let worst = Infinity;
  for (const g of got) {
    g.grounds.forEach((ground, i) => {
      const [a, b] = [lum(g.fgs[i]!), lum(ground)].sort((x, y) => y - x);
      worst = Math.min(worst, (a! + 0.05) / (b! + 0.05));
    });
  }
  return worst;
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

/**
 * D9: AT 320 THE CLASS CHIP STAYS INSIDE THE CARD. The table card forced the
 * head onto one line, so "BASIC STRATEGY ERROR" ran past the card's right
 * edge and was clipped by the screen. It wraps below the verdict instead.
 */
test('D9: at 320 the wrong-play class chip stays inside the card', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await withSettings(page, { feedbackMode: 'training', countCheckEvery: 0, dealSpeedMs: 0 });
  await withProfile(page, { seats: SOLO, gradeDeviations: false });
  await dealPlayerTurn(page);
  await makeWrongPlay(page);
  const sheet = page.locator('.wrong-play-sheet');
  await expect(sheet.locator('.mistake-class')).toBeVisible();
  // The TEXT, not the box: the nowrap label painted past a box that fit.
  const { inkRight, cardRight } = await page.evaluate(() => {
    const chip = document.querySelector('.wrong-play-sheet .mistake-class')!;
    const range = document.createRange();
    range.selectNodeContents(chip);
    const card = document.querySelector('.wrong-play-sheet .mistake-card')!.getBoundingClientRect();
    return { inkRight: range.getBoundingClientRect().right, cardRight: card.right };
  });
  expect(inkRight, 'the class chip runs past the card').toBeLessThanOrEqual(cardRight);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: 'e2e/screenshots/d9-wrong-play-320.png' });
});

for (const theme of THEMES) {
  test(`B5/W6: ${theme}: the wrong-play card passes AA`, async ({ page }) => {
    await withSettings(page, { theme, feedbackMode: 'training', countCheckEvery: 0, dealSpeedMs: 0 });
    await withProfile(page, { seats: SOLO });
    await dealPlayerTurn(page);
    await makeWrongPlay(page);
    for (const sel of ['.mistake-verdict', '.mistake-class', '.mistake-play-role', '.mistake-play-value', '.mistake-cell', '.mistake-tc', '.mistake-table-link', '.overlay-continue-btn']) {
      const ratio = await worstContrast(page, `.wrong-play-sheet ${sel}`);
      expect(ratio, `${theme} ${sel} ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
    await shot(page, `b5-wrong-play-${theme}`);
  });
}
