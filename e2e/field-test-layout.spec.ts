import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * The field-test screen's geometry, on every step.
 *
 * These exist because the fix for one geometry defect caused a worse one. The
 * answer stack used to travel 145px across the 22 steps against a 60px button
 * pitch, so a blind tap could land a whole button away from where the same tap
 * landed on the previous step -- and `answer()` stamps and advances with no
 * undo. The fix pinned everything above the answers into one 190px box.
 *
 * It worked. It also clipped that box's own contents: measured at 390x844 the
 * head overflowed 54-149px on ALL 22 steps, the evidence panel had zero visible
 * pixels on all 22, and "Measure the cabin" sat 58.7px past the clip on the one
 * step that needs it. The evidence panel is where the wheel arrival line, the
 * played-from path and the recogniser transcript appear -- so on the five wheel
 * steps the press could never show and "The press never showed on screen"
 * became the only honest tap, and on `mic-heard` the transcript could never
 * show and "It never heard me" became the only honest tap. Both are the bug
 * signature the protocol exists to detect. The instrument was manufacturing its
 * own positive result, on every run, invisibly.
 *
 * So: the answer stack must still not move, AND every control and the evidence
 * region must be on screen and hittable at its own centre, on every step.
 */

/**
 * Heights a phone actually reports, not heights a phone is sold as.
 *
 * This file used to pin `390x844` alone — the iPhone 14/15 DEVICE size, which
 * is the one height no web page ever sees: Safari's own chrome sits outside the
 * visual viewport, and a standalone PWA gives the status bar and the home
 * indicator to the safe-area insets. It is also, by luck, the one height at
 * which this column has slack to spare, so every assertion here passed while
 * the real thing clipped. Measured afterwards at 375x667: six answer buttons
 * ran 31px past the bottom and took Back and Skip with them, 17 of their 48px
 * left on screen, on the two controls pressed on every single step.
 *
 * 320x568 (iPhone 5 / SE 1) is deliberately NOT here. Six 44px answers, the
 * 44px floor for something aimed at without looking, plus the topbar, the
 * instruction, the evidence line, the repeat control and the nav row do not fit
 * in 568px, and the honest options are a button under 44px or a stack that
 * scrolls. Both are worse than not claiming support: 16 of the 23 steps have an
 * unreachable answer there, and the protocol would record the operator's
 * silence as a finding.
 */
const VIEWPORTS = [
  { name: 'iPhone 14/15 as a PWA', width: 390, height: 763 },
  { name: 'iPhone 14/15 in a Safari tab', width: 390, height: 700 },
  { name: 'iPhone SE 2/3, iPhone 8', width: 375, height: 667 },
  { name: 'narrowest Android supported', width: 360, height: 740 },
] as const;

async function openTest(page: Page, condition: string): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByTestId('fieldtest-open').click();
  await expect(page.getByTestId('fieldtest-screen')).toBeVisible();
  if ((await page.getByTestId('fieldtest-finish').count()) > 0) {
    const finish = page.getByTestId('fieldtest-finish');
    await finish.click();
    await finish.click();
    await page.getByTestId('fieldtest-open').click();
  }
  await page.getByRole('button', { name: condition, exact: true }).click();
  const start = page.getByTestId('fieldtest-start');
  await start.click();
  // Start-over arms before it discards, so a resumable run needs two taps.
  if ((await page.getByTestId('fieldtest-title').count()) === 0) await start.click();
  await expect(page.getByTestId('fieldtest-title')).toBeVisible();
}

/**
 * Is the element the thing a finger lands on at its own centre?
 *
 * `toBeVisible()` is not enough and was not enough: an element clipped by an
 * ancestor's `overflow` still reports visible, still has a sane bounding box,
 * and is still completely unreachable. Only hit-testing the centre point
 * catches that, which is why every assertion here goes through this.
 */
async function hitsSelf(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && (hit === el || el.contains(hit) || hit.contains(el));
  }, testId);
}

async function boxOf(page: Page, testId: string) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height };
  }, testId);
}

for (const vp of VIEWPORTS) {
  test.describe(`field test geometry at ${vp.width}x${vp.height} (${vp.name})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await withSettings(page, {});
    });

    /**
     * The gate an interrupted run lands on is reached from a screen thousands
     * of pixels tall, and nothing in the app reset the scroll position between
     * them. Measured before the fix: Resume sat under the sticky topbar at
     * 390x844 and entirely off-screen at 390x700 and 360x740, leaving "Start
     * over from step 1" — the button that discards the run — as the first
     * control a driver could hit.
     */
    test('resume is where a thumb can reach it after a mid-drive interruption', async ({
      page,
    }) => {
      await openTest(page, 'Car, parked');
      // Somewhere into the run, so there is something to come back to.
      for (let i = 0; i < 3; i += 1) await page.getByTestId('fieldtest-skip').click();
      await page.getByTestId('fieldtest-pause').click();

      // ...and back in from Settings, scrolled the way a real one is: the
      // field-test row is near the bottom of a very tall screen.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.getByTestId('fieldtest-open').click();
      await expect(page.getByTestId('fieldtest-resume')).toBeVisible();

      expect(
        await hitsSelf(page, 'fieldtest-resume'),
        'Resume is not what a finger landing on it would hit',
      ).toBe(true);
      const resume = await boxOf(page, 'fieldtest-resume');
      expect(resume, 'Resume is not on the gate at all').not.toBeNull();
      expect(resume!.top, 'Resume starts above the top of the screen').toBeGreaterThanOrEqual(0);
      expect(
        resume!.bottom,
        'Resume ends below the bottom of the screen',
      ).toBeLessThanOrEqual(vp.height);
    });

    test('the evidence panel is on screen and hittable on every step', async ({ page }) => {
      await openTest(page, 'Car, parked');
      const misses: string[] = [];
      for (let i = 0; ; i += 1) {
        const step = await page.getByTestId('fieldtest-title').innerText();
        if (!(await hitsSelf(page, 'fieldtest-evidence'))) misses.push(step);
        const skip = page.getByTestId('fieldtest-skip');
        if (await skip.isDisabled()) break;
        await skip.click();
        expect(i).toBeLessThan(40);
      }
      expect(misses, `evidence panel unreachable on: ${misses.join(', ')}`).toEqual([]);
    });

    test('the repeat control is hittable and does not move between steps', async ({ page }) => {
      await openTest(page, 'Car, parked');
      const tops = new Map<string, number>();
      const misses: string[] = [];
      for (let i = 0; ; i += 1) {
        const step = await page.getByTestId('fieldtest-title').innerText();
        if (!(await hitsSelf(page, 'fieldtest-again'))) misses.push(step);
        const box = await boxOf(page, 'fieldtest-again');
        if (box) tops.set(step, box.top);
        const skip = page.getByTestId('fieldtest-skip');
        if (await skip.isDisabled()) break;
        await skip.click();
        expect(i).toBeLessThan(40);
      }
      expect(misses, `repeat control unreachable on: ${misses.join(', ')}`).toEqual([]);

      const values = [...tops.values()];
      const spread = Math.max(...values) - Math.min(...values);
      expect(spread, `repeat control moved ${spread}px across the run`).toBeLessThanOrEqual(2);
    });

    /**
     * THE BOTTOM EDGE, and the nav row below it.
     *
     * This measured the TOP of the stack, which the stack is no longer anchored
     * by: it hangs from the bottom now, so a step with three answers leaves the
     * gap above them rather than below. The top therefore moves by one button
     * pitch per missing answer BY DESIGN, and a test on it fails exactly when
     * the layout is right.
     *
     * What has to hold still is where the thumb arrives: the bottom of the
     * stack, the escape hatch that sits there on every step, and Back and Skip
     * underneath.
     */
    test('the bottom of the answer stack and the nav row do not move', async ({ page }) => {
      await openTest(page, 'Car, parked');
      const rows: { step: string; bottom: number; nav: number; missed: number | null }[] = [];
      for (let i = 0; ; i += 1) {
        const stack = await boxOf(page, 'fieldtest-answers');
        const nav = await page.evaluate(() => {
          const el = document.querySelector('.fieldtest-nav');
          return el ? el.getBoundingClientRect().top : null;
        });
        // "Missed it" means the same thing on every step that offers it, is
        // last, and is the one a merging driver reaches for without looking.
        const missed = await page.evaluate(() => {
          const b = [...document.querySelectorAll('[data-testid="fieldtest-answers"] button')].find(
            (el) => (el as HTMLElement).innerText.trim().startsWith('Missed it'),
          );
          return b ? b.getBoundingClientRect().bottom : null;
        });
        rows.push({
          step: await page.getByTestId('fieldtest-title').innerText(),
          bottom: Math.round(stack!.bottom),
          nav: Math.round(nav!),
          missed: missed === null ? null : Math.round(missed),
        });
        const skip = page.getByTestId('fieldtest-skip');
        if (await skip.isDisabled()) break;
        await skip.click();
        expect(i).toBeLessThan(40);
      }

      const spread = (ns: number[]) => Math.max(...ns) - Math.min(...ns);
      const stackSpread = spread(rows.map((r) => r.bottom));
      expect(
        stackSpread,
        `the bottom of the stack moved ${stackSpread}px: ${JSON.stringify(
          rows.map((r) => [r.step, r.bottom]),
        )}`,
      ).toBeLessThanOrEqual(2);

      const navSpread = spread(rows.map((r) => r.nav));
      expect(
        navSpread,
        `the nav row moved ${navSpread}px: ${JSON.stringify(rows.map((r) => [r.step, r.nav]))}`,
      ).toBeLessThanOrEqual(2);

      const missed = rows.filter((r) => r.missed !== null);
      expect(missed.length, 'no step offered the escape hatch').toBeGreaterThan(15);
      const missedSpread = spread(missed.map((r) => r.missed!));
      expect(
        missedSpread,
        `"Missed it" moved ${missedSpread}px: ${JSON.stringify(
          missed.map((r) => [r.step, r.missed]),
        )}`,
      ).toBeLessThanOrEqual(2);
    });

    /**
     * Nothing may be off the bottom of the screen, which `toBeVisible` and a
     * bounding box both report as fine.
     *
     * The regression this catches: the answer stack could not shrink, so on a
     * 667px screen the six-answer steps pushed the nav row's own bottom to
     * 698px. Back and Skip were 17px tall to a finger and the suite was green.
     */
    test('every control is inside the viewport', async ({ page }) => {
      await openTest(page, 'Car, parked');
      const past: string[] = [];
      for (let i = 0; ; i += 1) {
        const step = await page.getByTestId('fieldtest-title').innerText();
        const over = await page.evaluate((h) => {
          const out: string[] = [];
          const check = (el: Element | null, what: string) => {
            if (!el) return;
            const r = el.getBoundingClientRect();
            if (r.bottom > h + 1 || r.top < -1) out.push(`${what} ${Math.round(r.top)}..${Math.round(r.bottom)}`);
          };
          check(document.querySelector('.fieldtest-nav'), 'nav');
          check(document.querySelector('[data-testid="fieldtest-answers"]'), 'answers');
          check(document.querySelector('[data-testid="fieldtest-evidence"]'), 'evidence');
          check(document.querySelector('[data-testid="fieldtest-again"]'), 'repeat');
          for (const b of document.querySelectorAll('[data-testid="fieldtest-answers"] button')) {
            check(b, `answer "${(b as HTMLElement).innerText.trim().slice(0, 18)}"`);
          }
          return out;
        }, vp.height);
        if (over.length > 0) past.push(`${step}: ${over.join('; ')}`);
        const skip = page.getByTestId('fieldtest-skip');
        if (await skip.isDisabled()) break;
        await skip.click();
        expect(i).toBeLessThan(40);
      }
      expect(past, `off the bottom of a ${vp.height}px screen:\n${past.join('\n')}`).toEqual([]);
    });

    /**
     * Apple's floor for something aimed at without looking. The answer stack
     * shrinks from 52px toward it when the column is tight; it must not go
     * under, because below that the operator's tap lands on the answer above.
     */
    test('no answer is smaller than a finger', async ({ page }) => {
      await openTest(page, 'Car, parked');
      const small: string[] = [];
      for (let i = 0; ; i += 1) {
        const step = await page.getByTestId('fieldtest-title').innerText();
        const under = await page.evaluate(() =>
          [...document.querySelectorAll('[data-testid="fieldtest-answers"] button')]
            .map((b) => ({ label: (b as HTMLElement).innerText.trim().slice(0, 18), h: b.getBoundingClientRect().height }))
            .filter((x) => x.h < 43.5)
            .map((x) => `${x.label} ${Math.round(x.h)}px`),
        );
        if (under.length > 0) small.push(`${step}: ${under.join(', ')}`);
        const skip = page.getByTestId('fieldtest-skip');
        if (await skip.isDisabled()) break;
        await skip.click();
        expect(i).toBeLessThan(40);
      }
      expect(small, `answers under 44px:\n${small.join('\n')}`).toEqual([]);
    });

    test('the ambient step can actually be measured', async ({ page }) => {
      await openTest(page, 'Car, parked');
      for (let i = 0; i < 40; i += 1) {
        if ((await page.getByTestId('fieldtest-measure').count()) > 0) break;
        const skip = page.getByTestId('fieldtest-skip');
        if (await skip.isDisabled()) break;
        await skip.click();
      }
      await expect(page.getByTestId('fieldtest-measure')).toBeVisible();
      expect(
        await hitsSelf(page, 'fieldtest-measure'),
        'the one control the ambient step needs was not hittable at its own centre',
      ).toBe(true);
    });

    test('no answer button overflows the bottom of the screen', async ({ page }) => {
      await openTest(page, 'Car, parked');
      const overflows: string[] = [];
      for (let i = 0; ; i += 1) {
        const step = await page.getByTestId('fieldtest-title').innerText();
        const clipped = await page.evaluate(() => {
          const stack = document.querySelector('[data-testid="fieldtest-answers"]');
          if (!stack) return false;
          return stack.scrollHeight - stack.clientHeight > 1;
        });
        if (clipped) overflows.push(step);
        const skip = page.getByTestId('fieldtest-skip');
        if (await skip.isDisabled()) break;
        await skip.click();
        expect(i).toBeLessThan(40);
      }
      expect(overflows, `answer stack scrolled on: ${overflows.join(', ')}`).toEqual([]);
    });

    test('a disabled answer is visibly distinct from a live one', async ({ page }) => {
      await openTest(page, 'Car, parked');
      const answer = page.getByTestId('fieldtest-answers').locator('button').first();
      const styleOf = () =>
        answer.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { opacity: cs.opacity, cursor: cs.cursor, disabled: (el as HTMLButtonElement).disabled };
        });

      // Step 1 speaks, so the stack opens disabled; it enables when the line ends.
      const live = await expect
        .poll(async () => (await styleOf()).disabled, { timeout: 15_000 })
        .toBe(false)
        .then(() => styleOf());

      const dead = await answer.evaluate((el) => {
        (el as HTMLButtonElement).disabled = true;
        const cs = getComputedStyle(el);
        return { opacity: cs.opacity, cursor: cs.cursor };
      });

      expect(
        dead.opacity !== live.opacity || dead.cursor !== live.cursor,
        'a disabled answer renders identically to a live one',
      ).toBe(true);
    });  });
}
