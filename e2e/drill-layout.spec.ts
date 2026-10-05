import { test, expect, type Page } from '@playwright/test';
import { waitForMic, withProfile } from './helpers';

/**
 * The flashcards screen on the phone it is actually used on.
 *
 * Three reported faults, all of them things a green unit suite cannot see:
 * Split greyed out on a pair, the Surrender button overlapping its
 * neighbours, and the page being taller than the device. `drillLegalActions`
 * is unit-tested and correct for a pair, and `ActionBar` disables purely on
 * `legal.includes` -- so if Split is still dead on screen the fault is
 * between them, and only rendering it shows that.
 *
 * 375x812 because that is the iPhone 13 mini this app exists for. The default
 * project viewport is 390x844, which is a different phone and would hide an
 * overflow of up to 32px.
 *
 * Further down: the same screen with Voice answers on (the reported layout,
 * where the action bar loaded below the fold), and the eyes-free ZonePad,
 * whose Surrender circle used to sit on the quadrant labels.
 */
const PHONE = { width: 375, height: 812 };

async function intoFlashcards(page: Page): Promise<void> {
  await page.setViewportSize(PHONE);
  await page.goto('/?e2e=1');
  // BOTH steps. The first lands on the drills MENU, which has no action bar
  // at all -- so the overlap check passed against an empty list and the
  // height check measured the menu rather than the drill. A spec that cannot
  // reach the screen it is named for reports on the wrong one in silence.
  await page.getByRole('button', { name: 'Drills' }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.action-bar')).toBeVisible();
}

test('Split is offered when the hand is a pair', async ({ page }) => {
  await intoFlashcards(page);

  // Deal until a pair turns up, reading the prompt the app itself renders so
  // the test cannot disagree with the screen about what the hand is.
  let sawPair = false;
  for (let i = 0; i < 40 && !sawPair; i++) {
    const body = await page.evaluate(() => document.body.innerText);
    if (/pair of/i.test(body)) {
      sawPair = true;
      const split = page.getByRole('button', { name: 'Split', exact: true });
      if ((await split.count()) > 0) {
        await expect(split, 'Split is dead on a pair hand').toBeEnabled();
      }
      await page.screenshot({ path: 'e2e/screenshots/drill-pair.png' });
      break;
    }
    // A flashcard offers Next only once it has been answered, so answer the
    // non-pair first. Stand is always legal; the grade is not the subject.
    if ((await page.getByRole('button', { name: /Next|Deal/ }).count()) === 0) {
      await page.getByRole('button', { name: 'Stand', exact: true }).click();
    }
    const next = page.getByRole('button', { name: /Next|Deal/ });
    if ((await next.count()) === 0) break;
    await next.first().click();
  }
  expect(sawPair, 'never dealt a pair in 40 tries, so nothing was tested').toBe(true);
});

test('the action bar fits the phone without overlapping itself', async ({ page }) => {
  await intoFlashcards(page);

  // Measured from the rendered boxes rather than from a screenshot, so the
  // failure names which pair of buttons collided instead of leaving me to
  // eyeball it.
  const overlaps = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.action-bar .action-btn')] as HTMLElement[];
    const out: string[] = [];
    for (let i = 0; i < btns.length; i++) {
      for (let j = i + 1; j < btns.length; j++) {
        const a = btns[i]!.getBoundingClientRect();
        const b = btns[j]!.getBoundingClientRect();
        const hit = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        if (hit) out.push(`${btns[i]!.textContent} over ${btns[j]!.textContent}`);
      }
    }
    return out;
  });
  const count = await page.locator('.action-bar .action-btn').count();
  expect(count, 'no action buttons found, so nothing was tested').toBeGreaterThan(0);
  expect(overlaps, 'action buttons overlap each other').toEqual([]);

  // And the labels must not spill out of their own buttons, which is the
  // shape "Surrender overlaps the other words" actually takes.
  const spills = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.action-bar .action-btn')] as HTMLElement[];
    return btns
      .filter((b) => b.scrollWidth > b.clientWidth + 1)
      .map((b) => `${b.textContent}: ${b.scrollWidth}px of text in ${b.clientWidth}px`);
  });
  expect(spills, 'a button label is wider than its button').toEqual([]);
});

test('the drill screen fits the phone without scrolling', async ({ page }) => {
  await intoFlashcards(page);

  const page_ = await page.evaluate(() => ({
    scrollH: document.documentElement.scrollHeight,
    clientH: document.documentElement.clientHeight,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));

  await page.screenshot({ path: 'e2e/screenshots/drill-height.png', fullPage: false });

  // Eyes-free is the point of this screen: if it is taller than the phone the
  // operator has to scroll to reach a control they are not looking at.
  expect(
    page_.scrollH,
    `drill screen is ${page_.scrollH}px tall on a ${page_.clientH}px phone`,
  ).toBeLessThanOrEqual(page_.clientH + 1);
  expect(page_.scrollW, 'the page scrolls sideways').toBeLessThanOrEqual(page_.clientW + 1);
});

/* ---------------------------------------------------------------------- */
/* With Voice answers on: the reported screen.                             */
/* ---------------------------------------------------------------------- */

/**
 * The report was Flashcards with Voice answers on: the Hit/Stand/Double/
 * Split/Surrender bar loaded below the fold, so every answer started with a
 * scroll -- and the scroll pushed the top controls under the status bar.
 * Five stacked checkboxes and a three-line listening panel were the cause.
 * The answer modes now share one row, set-once options sit in a closed
 * "Options" disclosure, and the listening strip is one line.
 */
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
          // Safari fires audiostart right after start; without it the app waits out AUDIOSTART_GRACE_MS.
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

/** Everything that has to be on screen to answer, measured without scrolling. */
async function expectAnswerableWithoutScrolling(page: Page): Promise<void> {
  const m = await page.evaluate(() => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    };
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.action-bar .action-btn')];
    return {
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      dealer: box(document.querySelector('.dealer-area > *')!),
      hand: box(document.querySelector('.hand-cards')!),
      buttons: buttons.map((b) => ({
        label: b.textContent ?? '',
        ...box(b),
        truncated: b.scrollWidth > b.clientWidth,
      })),
    };
  });

  expect(m.scrollY).toBe(0);
  expect(m.scrollHeight, 'the page should not need scrolling').toBeLessThanOrEqual(m.innerHeight);
  expect(m.dealer.top).toBeGreaterThanOrEqual(0);
  expect(m.dealer.bottom).toBeLessThanOrEqual(m.innerHeight);
  expect(m.hand.bottom).toBeLessThanOrEqual(m.innerHeight);
  expect(m.buttons.length).toBeGreaterThan(0);
  for (const b of m.buttons) {
    expect(b.bottom, `${b.label} below the fold`).toBeLessThanOrEqual(m.innerHeight);
    expect(b.truncated, `${b.label} is cut off`).toBe(false);
  }
}

test('Flashcards with voice on: dealer card, hand and answers fit one screen', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await withFakeEngine(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  await waitForMic(page);

  // A stray word on the listening line, as in the report ("At" -> not a
  // command), must not grow the strip past one line.
  await page.evaluate(() => {
    const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
    rec?.onresult?.({ results: [[{ transcript: 'at' }]] });
  });
  await expect(page.locator('.voice-status-heard')).toContainText('not a command');
  const strip = await page.locator('.voice-status').boundingBox();
  expect(strip!.height, 'listening strip should be one line').toBeLessThan(40);

  // Set-once options start folded away.
  await expect(page.locator('details.drill-options')).not.toHaveAttribute('open', /.*/);
  await expect(page.getByText('Show common hands more often')).toBeHidden();

  await expectAnswerableWithoutScrolling(page);
  await expect(page.getByRole('button', { name: 'Surrender', exact: true })).toBeVisible();

  // 812 is the whole screen; Safari with its toolbars showing leaves roughly
  // 635 of it. Headless Chromium has no browser chrome, so this is the honest
  // stand-in for what the phone actually shows.
  await page.setViewportSize({ width: PHONE.width, height: 635 });
  await expectAnswerableWithoutScrolling(page);
});

test('Deviation quiz with voice on fits one screen', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await withFakeEngine(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  await waitForMic(page);
  // An insurance item has no hand to measure; draw until one has cards.
  for (let i = 0; i < 20 && (await page.locator('.hand-cards').count()) === 0; i++) {
    await page.getByRole('button', { name: 'Decline insurance', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await expectAnswerableWithoutScrolling(page);
});

/* ---------------------------------------------------------------------- */
/* The eyes-free ZonePad.                                                   */
/* ---------------------------------------------------------------------- */

type Box = { left: number; top: number; right: number; bottom: number };

/** Does the circle (as drawn: its box's inscribed circle) touch the rectangle? */
function circleHitsRect(circle: Box, r: Box): boolean {
  const cx = (circle.left + circle.right) / 2;
  const cy = (circle.top + circle.bottom) / 2;
  const radius = (circle.right - circle.left) / 2;
  const nx = Math.max(r.left, Math.min(cx, r.right));
  const ny = Math.max(r.top, Math.min(cy, r.bottom));
  return (nx - cx) ** 2 + (ny - cy) ** 2 < radius ** 2;
}

async function zoneBoxes(page: Page) {
  return page.evaluate(() => {
    const rect = (el: Element) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    };
    const circle = document.querySelector('.zone-pad-circle');
    return {
      circle: circle ? rect(circle) : null,
      labels: [...document.querySelectorAll('.zone-pad-label')].map((el) => ({
        text: el.textContent ?? '',
        ...rect(el),
      })),
    };
  });
}

test('ZonePad: the Surrender circle never covers a quadrant label', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.getByLabel('Eyes-free audio').check();
  await expect(page.locator('.zone-pad-quadrants')).toBeVisible();

  const { circle, labels } = await zoneBoxes(page);
  expect(labels.map((l) => l.text)).toEqual(['Hit', 'Stand', 'Double', 'Split']);
  // The default profile has late surrender, so the circle is drawn.
  expect(circle, 'no Surrender circle, so nothing was tested').not.toBeNull();
  for (const label of labels) {
    // Both the strict box test the report describes and the true geometry.
    const boxesOverlap =
      circle!.left < label.right &&
      label.left < circle!.right &&
      circle!.top < label.bottom &&
      label.top < circle!.bottom;
    expect(boxesOverlap, `Surrender's box overlaps "${label.text}"`).toBe(false);
    expect(circleHitsRect(circle!, label), `Surrender covers "${label.text}"`).toBe(false);
  }
  await page.screenshot({ path: 'e2e/screenshots/zonepad-375.png' });
});

test('ZonePad: illegal plays are disabled, and Surrender is gone without it', async ({ page }) => {
  // A table with no late surrender: the circle has nothing to offer.
  await withProfile(page, { rules: { ls: false } });
  await page.setViewportSize(PHONE);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.getByLabel('Eyes-free audio').check();
  await expect(page.locator('.zone-pad-quadrants')).toBeVisible();

  // Split is legal exactly when the hand is a pair; the pad must agree with
  // the hand the app itself describes.
  const isPair = /pair of/i.test(await page.evaluate(() => document.body.innerText));
  const split = page.locator('.zone-pad-quad-split');
  if (isPair) {
    await expect(split).not.toHaveClass(/zone-pad-quad-disabled/);
  } else {
    await expect(split).toHaveClass(/zone-pad-quad-disabled/);
    await expect(split).toHaveAttribute('aria-disabled', 'true');
  }
  for (const zone of ['hit', 'stand', 'double']) {
    await expect(page.locator(`.zone-pad-quad-${zone}`)).not.toHaveClass(/zone-pad-quad-disabled/);
  }
  await expect(page.locator('.zone-pad-circle')).toHaveCount(0);
});
