import { test, expect, type Page } from '@playwright/test';
import {
  answerAndReadStrip,
  playRoundByAdvice,
  resolveInsurance,
  waitForMic,
  withProfile,
  withSettings,
  shownHandRightPlay,
} from './helpers';

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
  // Scoped to pairs, so the very first hand is one. Dealing until a pair
  // happened to turn up made this a coin flip under load ("never dealt a
  // pair in 40 tries").
  await withSettings(page, { drill: { scopes: ['pairs'], flashCategory: 'pairs' } });
  await intoFlashcards(page);

  // Read the prompt the app itself renders, so the test cannot disagree with
  // the screen about what the hand is.
  await expect(page.locator('body')).toContainText(/pair of/i);
  await expect(
    page.getByRole('button', { name: 'Split', exact: true }),
    'Split is dead on a pair hand',
  ).toBeEnabled();
  await page.screenshot({ path: 'e2e/screenshots/drill-pair.png' });
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

/*
 * A SUB-PIXEL IS NOT A CUT-OFF BUTTON, and treating it as one made this test
 * permanently red for 0.97 of a pixel.
 *
 * At the 635px height the drill screen's six rows measured 603.96875px inside a
 * 603px box. Three of them (the topbar, the inline controls, the action bar)
 * take their height from `line-height: normal` on button text, so their heights
 * are font-metric fractions -- 68.1875, 219.59375, 68.1875 -- and no author can
 * make six such rows sum to a whole number on every platform. `scrollHeight` is
 * an integer and rounds the total UP, so 603.96875 is reported as 604 and the
 * page is declared to need scrolling.
 *
 * The tolerance is therefore exactly one pixel and no more: anything a reader
 * could actually see cut off -- a row that does not fit, a button pushed under
 * the fold -- is a whole pixel or many, and still fails.
 */
const SUBPIXEL = 1;

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
      // The fractional truth behind `scrollHeight`, so a real overflow is still
      // told apart from a rounded one.
      contentBottom: Math.max(
        ...[...document.querySelectorAll<HTMLElement>('body *')].map((el) =>
          el.getBoundingClientRect().bottom,
        ),
      ),
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
  expect(m.contentBottom, 'the page should not need scrolling').toBeLessThan(
    m.innerHeight + SUBPIXEL,
  );
  expect(m.dealer.top).toBeGreaterThanOrEqual(0);
  expect(m.dealer.bottom).toBeLessThan(m.innerHeight + SUBPIXEL);
  expect(m.hand.bottom).toBeLessThan(m.innerHeight + SUBPIXEL);
  expect(m.buttons.length).toBeGreaterThan(0);
  for (const b of m.buttons) {
    expect(b.bottom, `${b.label} below the fold`).toBeLessThan(m.innerHeight + SUBPIXEL);
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
  await expect(page.getByText('Follow each hand with a look-alike')).toBeHidden();

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
  // An insurance item has no hand to measure; answer it until one has cards.
  // C-R12: there is NO Next button to press here. B1's fast advance draws the
  // next item inside the answer handler (Drills.tsx `advanceWithResult`), so
  // the old `click Next` waited 30s for a button that never renders -- and
  // failed exactly when the first item drawn happened to be insurance (2 in
  // 20 under load), which is why it read as a flake rather than a fault.
  await expect(async () => {
    if ((await page.locator('.hand-cards').count()) > 0) return;
    await page.getByRole('button', { name: 'Decline insurance', exact: true }).click({ timeout: 2_000 });
    await expect(page.locator('.hand-cards')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
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
  // Hard hands only: a soft hand or a pair has no surrender in a drill
  // (#11), so the circle is not drawn for them.
  await withSettings(page, { drill: { flashCategory: 'hard' } });
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

/**
 * D2: A LIVE SPLIT MUST NOT WEAR THE DISABLED GROUND. Split was painted
 * var(--bg) always, which is exactly what `.zone-pad-quad-disabled` paints,
 * so on the one hand where Split mattered (a pair) a glance read it as off.
 * Only the class may decide the ground: live = the other live zones' ground,
 * disabled = the disabled ground.
 */
test('ZonePad: a live Split is drawn like the live zones, a dead one like a disabled zone', async ({ page }) => {
  const grounds = async () =>
    page.evaluate(() => {
      const bg = (sel: string) => getComputedStyle(document.querySelector(sel)!).backgroundColor;
      return { split: bg('.zone-pad-quad-split'), hit: bg('.zone-pad-quad-hit') };
    });
  const open = async () => {
    await page.setViewportSize(PHONE);
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
    await page.getByLabel('Eyes-free audio').check();
    await expect(page.locator('.zone-pad-quadrants')).toBeVisible();
  };

  // A pair: Split is live.
  await withSettings(page, { drill: { scopes: ['pairs'], flashCategory: 'pairs' } });
  await open();
  await expect(page.locator('.zone-pad-quad-split')).not.toHaveClass(/zone-pad-quad-disabled/);
  const live = await grounds();
  expect(live.split, 'a live Split has a different ground from Hit').toBe(live.hit);

  // A hard hand: Split is dead, and only now does it take the disabled ground.
  await withSettings(page, { drill: { scopes: ['hard'], flashCategory: 'hard' } });
  await open();
  await expect(page.locator('.zone-pad-quad-split')).toHaveClass(/zone-pad-quad-disabled/);
  const dead = await grounds();
  expect(dead.split, 'a disabled Split looks the same as a live one').not.toBe(dead.hit);
  expect(live.split, 'a live Split wears the disabled ground').not.toBe(dead.split);
});

/* ---------------------------------------------------------------------- */
/* Screen-level layout at 375x812: the primary action is on screen, always. */
/* ---------------------------------------------------------------------- */

/** The element's box must sit wholly inside the 375x812 viewport, no scrolling. */
async function expectInViewport(page: Page, selector: string, what: string): Promise<void> {
  const el = page.locator(selector).first();
  await expect(el, `${what} is not rendered`).toBeVisible();
  const box = await el.boundingBox();
  expect(box, `${what} has no box`).not.toBeNull();
  expect(box!.y, `${what} starts above the screen`).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `${what} ends at y=${box!.y + box!.height}, below the ${PHONE.height}px fold`).toBeLessThanOrEqual(
    PHONE.height,
  );
  expect(box!.x + box!.width, `${what} runs off the right edge`).toBeLessThanOrEqual(PHONE.width);
}

/** A shared primary: full width less the 16px gutters, 56px tall, and pinned. */
async function expectPrimaryBar(page: Page, what: string): Promise<void> {
  await expectInViewport(page, '.drill-primary-bar .drill-primary-btn', what);
  const box = (await page.locator('.drill-primary-bar .drill-primary-btn').first().boundingBox())!;
  expect(box.width, `${what} is not full width`).toBeGreaterThanOrEqual(PHONE.width - 40);
  expect(box.height, `${what} is under 56px`).toBeGreaterThanOrEqual(55);
}

test('Count drill setup: Start is pinned and full width, Length and Eyes-free show, the rest is under Options', async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await expect(page.locator('.count-setup')).toBeVisible();

  await expectPrimaryBar(page, 'Start');
  await expectInViewport(page, '.count-setup >> text=Length', 'Length');
  await expectInViewport(page, 'label:has-text("Eyes-free audio")', 'Eyes-free audio');
  // Closed, and the other settings are not on screen.
  await expect(page.locator('.count-setup .drill-options')).not.toHaveAttribute('open', '');
  await expect(page.getByText('Time per card')).toBeHidden();
  await expect(page.getByText('Pace pressure')).toBeHidden();

  const dims = await page.evaluate(() => ({
    scrollH: document.documentElement.scrollHeight,
    clientH: document.documentElement.clientHeight,
  }));
  expect(dims.scrollH, 'Count setup scrolls').toBeLessThanOrEqual(dims.clientH + 1);

  // Opening Options keeps Start on screen even though the form is now tall.
  await page.locator('.count-setup .drill-options > summary').click();
  await expect(page.getByText('Time per card')).toBeVisible();
  await expectInViewport(page, '.drill-primary-bar .drill-primary-btn', 'Start with Options open');
  await page.screenshot({ path: 'e2e/screenshots/count-setup-375.png' });
});

test('Count drill result: one obvious primary, New run, on screen; the top bar Back is the only exit', async ({ page }) => {
  await withSettings(page, { drill: { countIntervalMs: 300, countLengthCards: 4, countGroup: 1 } });
  await page.setViewportSize(PHONE);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.numpad')).toBeVisible({ timeout: 10_000 });
  await page.locator('.numpad-btn', { hasText: /^3$/ }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator('.drill-result')).toBeVisible();

  await expectPrimaryBar(page, 'New run');
  await expect(page.locator('.drill-primary-bar .drill-primary-btn')).toHaveText('New run');
  // Wave E E5: the "Back to Drills" secondary duplicated the top bar's Back.
  await expect(page.locator('.drill-primary-bar .drill-secondary-btn')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /back/i })).toHaveCount(1);
  await expectInViewport(page, '.drill-topbar .drill-back-btn', 'Back');
  await page.screenshot({ path: 'e2e/screenshots/count-result-375.png' });
});

test('Deck estimation and True count: Start is the same pinned primary', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/?e2e=1');
  for (const name of ['Deck estimation', 'True count drill']) {
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name, exact: true }).click();
    await expectPrimaryBar(page, `${name} Start`);
    await page.locator('.drill-back-btn').first().click();
  }
});

test('Test kit menu: the kit buttons come first, "Still unanswered" is a collapsed disclosure below them', async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto('/?e2e=1');
  await page.getByTestId('testkit-open').click();
  await expect(page.getByTestId('testkit-screen')).toBeVisible();

  await expectInViewport(page, '.testkit-kit >> nth=0', 'the first kit button');
  await expectInViewport(page, '.testkit-kit >> nth=1', 'the second kit button');
  const kitBottom = (await page.locator('.testkit-kit').last().boundingBox())!;
  const summary = (await page.locator('.testkit-unanswered > summary').boundingBox())!;
  expect(summary.y, 'the unanswered list sits above the kit buttons').toBeGreaterThan(kitBottom.y);
  await expect(page.locator('.testkit-unanswered')).not.toHaveAttribute('open', '');
  await expect(page.getByTestId('testkit-open-questions')).toBeHidden();
  await page.locator('.testkit-unanswered > summary').click();
  await expect(page.getByTestId('testkit-open-questions').locator('li')).toHaveCount(5);
});

test('Table End takes two taps, reverts after 3s, and always shows the session report', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const end = page.locator('.end-btn');
  await expect(end).toHaveText('End');

  await end.click();
  await expect(end).toHaveText('Tap again to end');
  await expect(page.locator('.report-screen')).toHaveCount(0);
  // Disarms by itself.
  await expect(end).toHaveText('End', { timeout: 5000 });
  await expect(page.locator('.report-screen')).toHaveCount(0);

  // Training mode is the default: the report shows anyway -- once a round
  // has been played (F22: End at round 0 goes Home, with nothing to report).
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await resolveInsurance(page, false);
  await playRoundByAdvice(page);
  await end.click();
  await end.click();
  await expect(page.locator('.report-screen')).toBeVisible();
  await expectInViewport(page, '.report-done-btn', 'the report button');
});

test('Home: top-aligned, the profile name on one line, Test kit is a small link under the build line', async ({ page }) => {
  await withProfile(page, { name: 'Default (6D H17 DAS, 3:2 payout, late surrender)' });
  await page.setViewportSize(PHONE);
  await page.goto('/?e2e=1');
  const title = (await page.locator('.home-title').boundingBox())!;
  expect(title.y, 'the content is still vertically centred').toBeLessThan(120);

  // Wave I: one line, ellipsised, so the head stays one row (layout-320.spec).
  // The clip is visual: the text and the tooltip keep the whole name.
  const chip = page.locator('.home-profile-chip');
  await expect(chip).toHaveText('Default (6D H17 DAS, 3:2 payout, late surrender)');
  await expect(chip).toHaveAttribute('title', /late surrender/);
  const name = chip.locator('.home-profile-chip-name');
  expect(await name.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis');
  const nameBox = (await name.boundingBox())!;
  expect(nameBox.height, 'the profile name wraps').toBeLessThan(30);

  // B2: the ladder sits first and Start is the fold's job (ladder.spec);
  // Play a shoe and Test kit are a scroll below it.
  await expectInViewport(page, '.next-step-btn', 'Start');
  await page.getByTestId('testkit-open').scrollIntoViewIfNeeded();
  await expectInViewport(page, '.home-play-btn', 'Play a shoe');
  await expectInViewport(page, '[data-testid="testkit-open"]', 'the Test kit link');
  const link = (await page.getByTestId('testkit-open').boundingBox())!;
  const build = (await page.locator('.home-build').boundingBox())!;
  expect(link.y, 'Test kit is not under the build line').toBeGreaterThanOrEqual(build.y + build.height - 1);
  expect(link.width, 'Test kit is still a full-width button').toBeLessThan(200);
  await page.screenshot({ path: 'e2e/screenshots/home-375.png' });
  await page.getByTestId('testkit-open').click();
  await expect(page.getByTestId('testkit-screen')).toBeVisible();
});

test('Deviation quiz: after a wrong answer the miss strip and the answer buttons both fit the phone', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();

  let sawMistake = false;
  for (let i = 0; i < 12 && !sawMistake; i++) {
    const btn = (await page.locator('.quiz-insurance-prompt').isVisible().catch(() => false))
      ? page.getByRole('button', { name: 'Take insurance', exact: true })
      : page.locator('.action-bar button.action-btn:not([disabled])', { hasText: 'Double' });
    if ((await answerAndReadStrip(page, btn)) === 'miss') sawMistake = true;
  }
  expect(sawMistake, 'never got a wrong answer in twelve tries').toBe(true);

  // B1: no Next button; the next item's answers and the miss both fit.
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
  await expectInViewport(page, '.action-bar', 'the answer buttons');
  await expectInViewport(page, '[data-testid="result-strip"]', 'the miss strip');
  const geo = await page.evaluate(() => ({
    strip: document.querySelector('[data-testid="result-strip"]')!.getBoundingClientRect().right,
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(geo.strip, 'the strip runs off the screen').toBeLessThanOrEqual(geo.width + 0.5);
  expect(geo.scroll, 'sideways scroll').toBeLessThanOrEqual(geo.width);
  await page.screenshot({ path: 'e2e/screenshots/quiz-feedback-375.png' });
});

test('Flashcards feedback says it in words: no raw cell id, no "Box n/5"', async ({ page }) => {
  await intoFlashcards(page);
  await answerAndReadStrip(page, page.getByRole('button', { name: 'Stand', exact: true }));
  const strip = page.locator('[data-testid="result-strip"]');
  await expect(strip).toContainText(/\d|A/);
  const body = await page.evaluate(() => document.body.innerText);
  expect(body).not.toMatch(/(hard|soft|pair)-\w+-v-\w+/);
  expect(body).not.toMatch(/Box \d\/5/);
  await expectInViewport(page, '.action-bar', 'the answer buttons');
});

/**
 * D5: AT 320x568 A MISS IS READ, NOT HIDDEN. The strip renders below the
 * newly dealt hand and the sticky answer bar covered all but its header, so
 * "Right play" was never seen without a scroll. The strip now lifts itself
 * out from under the bar.
 */
test('D5: at 320x568 the miss strip\'s right play clears the sticky answer bar', async ({ page }) => {
  await withSettings(page, { drill: { scopes: ['hard'], flashCategory: 'hard' } });
  await page.setViewportSize({ width: 320, height: 568 });
  // An iPhone SE's status bar, as the installed app sees it.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = ':root{--safe-top:20px !important}';
      document.head.appendChild(s);
    });
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');
  const right = await shownHandRightPlay(page);
  const wrong = right === 'Hit' ? 'Stand' : 'Hit';
  await page.locator('.action-bar').getByRole('button', { name: wrong, exact: true }).click();
  const expected = page.locator('[data-testid="result-strip"][data-tone="miss"]').getByTestId('hand-result-expected');
  await expect(expected).toBeVisible();
  // The case under test must still arise: laid out unscrolled, the line is
  // under the bar. Otherwise this would pass with no reveal at all.
  const natural = await page.evaluate(() => {
    const e = document.querySelector('[data-testid="hand-result-expected"]')!.getBoundingClientRect();
    const bar = document.querySelector('.drill-screen .action-bar')!.getBoundingClientRect();
    return { bottom: e.bottom + window.scrollY, barTop: bar.top };
  });
  expect(natural.bottom, 'the miss strip fits without scrolling; this layout no longer tests D5').toBeGreaterThan(natural.barTop);
  await expect
    .poll(async () => {
      const e = (await expected.boundingBox())!;
      const bar = (await page.locator('.drill-screen .action-bar').boundingBox())!;
      return e.y + e.height <= bar.y;
    }, { message: '"Right play" is under the sticky answer bar' })
    .toBe(true);
  await page.screenshot({ path: 'e2e/screenshots/d5-miss-320.png' });
});

/**
 * D6: THE STRIP SAYS IT IS ABOUT THE LAST HAND. It sits under a newly dealt
 * hand (in Mixed, under a different true count), and nothing said which hand
 * it described. A muted "Last hand" leads the verdict, on the verdict's own
 * line so the height budget at 375x812 is unchanged.
 */
test('D6: right or wrong, the result strip is labelled as the last hand, on the verdict line', async ({ page }) => {
  await withSettings(page, { drill: { scopes: ['hard'], flashCategory: 'hard' } });
  await page.setViewportSize(PHONE);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  const bar = page.locator('.action-bar');
  const sameLine = async (tone: 'ok' | 'miss', verdict: string) => {
    const strip = page.locator(`[data-testid="result-strip"][data-tone="${tone}"]`);
    const eyebrow = strip.getByTestId('last-hand-eyebrow');
    await expect(eyebrow).toHaveText(/last hand/i);
    const a = (await eyebrow.boundingBox())!;
    const b = (await strip.locator(verdict).boundingBox())!;
    expect(a.y + a.height, 'the eyebrow is on a line of its own').toBeGreaterThan(b.y);
    expect(a.y).toBeLessThan(b.y + b.height);
  };

  await bar.getByRole('button', { name: await shownHandRightPlay(page), exact: true }).click();
  await sameLine('ok', '.result-correct');

  const right = await shownHandRightPlay(page);
  await bar.getByRole('button', { name: right === 'Hit' ? 'Stand' : 'Hit', exact: true }).click();
  await sameLine('miss', '.result-wrong');
});

/**
 * D7: DECK ESTIMATION'S ANSWERS ARE ON SCREEN. A fixed 260px tray pushed the
 * last two rows below the fold at 320x568, and at 375x812 the last row sat
 * in the home-indicator band (34px) because the grid ignored --safe-bottom.
 */
for (const size of [
  { width: 375, height: 812, top: 47, bottom: 34 },
  { width: 320, height: 568, top: 20, bottom: 0 },
]) {
  test(`D7: at ${size.width}x${size.height} every Deck estimation answer is above the home indicator`, async ({ page }) => {
    await withProfile(page, { rules: { decks: 6 } });
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.addInitScript(([t, b]) => {
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = `:root{--safe-top:${t}px !important;--safe-bottom:${b}px !important}`;
        document.head.appendChild(s);
      });
    }, [size.top, size.bottom]);
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: 'Deck estimation', exact: true }).click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.locator('.deck-guess-btn').first()).toBeVisible();
    const lastBottom = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.deck-guess-btn')];
      return Math.max(...btns.map((b) => b.getBoundingClientRect().bottom));
    });
    expect(lastBottom, 'an answer is below the fold or in the home-indicator band').toBeLessThanOrEqual(
      size.height - size.bottom,
    );
  });
}

/**
 * D10: THE DRILL ANSWER LABELS ARE AS LEGIBLE AS PLAY'S. They were 10.9px at
 * 375 while Play's identical bar was raised to 13.5px for glanceability.
 * At 320 the old size stays, so "Surrender" is not cut to "Surren…".
 */
for (const width of [375, 320] as const) {
  test(`D10: at ${width} the drill answer labels are ${width === 375 ? '13px or more' : 'whole'}`, async ({ page }) => {
    await withSettings(page, { drill: { scopes: ['hard'], flashCategory: 'hard' } });
    await page.setViewportSize({ width, height: width === 375 ? 812 : 568 });
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: 'Drills', exact: true }).click();
    await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
    const btns = page.locator('.drill-screen > .action-bar > .action-btn');
    await expect(btns.first()).toBeVisible();
    const got = await btns.evaluateAll((els) =>
      els.map((b) => ({
        text: b.textContent,
        px: parseFloat(getComputedStyle(b).fontSize),
        spill: b.scrollWidth > b.clientWidth + 1,
      })),
    );
    expect(got.map((g) => g.text)).toContain('Surrender');
    if (width === 375) for (const g of got) expect(g.px, `${g.text} label`).toBeGreaterThanOrEqual(13);
    expect(got.filter((g) => g.spill).map((g) => g.text), 'a label is cut').toEqual([]);
  });
}
