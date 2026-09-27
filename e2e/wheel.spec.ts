import { test, expect, type Page } from '@playwright/test';
import { withSettings } from './helpers';

/**
 * The steering wheel, end to end.
 *
 * This is the input method that has to work with nobody looking at the screen,
 * and it is the one that cannot be exercised by clicking: a press arrives
 * through `navigator.mediaSession`, which only the car can send. Hence
 * `window.__wheelPress` (App.tsx), a seam present only under `?e2e=1`.
 *
 * What is being proven is the thing the 2026-09-16 report asked for: two
 * buttons, "next or prev", entering a running or true count with the
 * microphone shut -- because an open microphone flips the car to its
 * hands-free route and the wheel stops reaching the app at all.
 */

const READBACK_MS = 900;
const COMMIT_MS = 3000;

/**
 * Deliver presses in ONE round trip.
 *
 * Not a shortcut: a press per `page.evaluate` puts a browser round trip
 * between each one, and against a dev server under load those gaps have
 * exceeded the three-second commit window -- the entry submits half a count
 * and the remaining presses land on the result screen. That is a property of
 * the harness, not of the app (the same sequence through a built bundle
 * accumulates correctly either way), and a test that fails on it is measuring
 * Playwright. Spacing that MATTERS is tested explicitly below, with waits
 * chosen against the two delays rather than left to chance.
 */
async function press(page: Page, command: 'forward' | 'back', times = 1): Promise<void> {
  const handled = await page.evaluate(
    ({ c, n }) => {
      const results: boolean[] = [];
      for (let i = 0; i < n; i++) results.push(window.__wheelPress?.(c) ?? false);
      return results;
    },
    { c: command, n: times },
  );
  // Vacuity guard, and the one that matters most: a press that reached no
  // screen is silently a no-op, which is exactly what a broken wheel looks
  // like. Every test below would pass on an unclaimed wheel without this.
  expect(handled).toEqual(Array.from({ length: times }, () => true));
}

function spoken(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__speechLog ?? []);
}

async function openTrueCountDrill(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'True Count Drill', exact: true }).click();
}

test('forward starts the drill', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, verbosity: 'full' } });
  await openTrueCountDrill(page);

  await press(page, 'forward');
  await expect(page.getByText('Enter the true count')).toBeVisible();
});

/**
 * Back means "say it again" everywhere the drill is not waiting for a number.
 * While it IS waiting for one, back is minus one -- the number is what the
 * buttons are for at that moment, and there is no third button to hold both
 * meanings at once.
 */
test('back says the result again once the question is answered', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, verbosity: 'full' } });
  await openTrueCountDrill(page);
  await press(page, 'forward'); // Start
  // One press, then silence: the proposal submits itself, which is how every
  // wheel answer is confirmed.
  await press(page, 'forward');
  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 8000 });

  await page.evaluate(() => {
    window.__speechLog = [];
  });
  await press(page, 'back');
  await expect
    .poll(async () => (await spoken(page)).some((l) => l.includes('True count')))
    .toBe(true);
});

test('the two buttons walk a true count and quiet submits it', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, verbosity: 'full' } });
  await openTrueCountDrill(page);
  await press(page, 'forward'); // Start

  // Four up, one back: the proposal is walked, not typed, and a correction is
  // just more pressing.
  await press(page, 'forward', 4);
  await press(page, 'back');

  // Nothing is submitted that has not been said first -- silence stands in for
  // the "yes" the voice path gets.
  await expect
    .poll(async () => await spoken(page), { timeout: 4000 })
    .toContain('plus 3. Correct?');
  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 6000 });
  await expect(page.locator('.result-detail')).toContainText('+3');
});

test('a press during the correction window pushes the submission back', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, verbosity: 'full' } });
  await openTrueCountDrill(page);
  await press(page, 'forward');

  await press(page, 'forward', 2);
  // Long enough to have been read back, nowhere near long enough to submit.
  await page.waitForTimeout(READBACK_MS + 300);
  await expect(page.locator('.drill-result')).toHaveCount(0);

  await press(page, 'forward');
  await page.waitForTimeout(COMMIT_MS - 800);
  // Still open: the third press restarted the clock rather than arriving after
  // an answer had already been graded.
  await expect(page.locator('.drill-result')).toHaveCount(0);

  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 6000 });
  await expect(page.locator('.result-detail')).toContainText('+3');
});

/**
 * "Did you have it?" is two outcomes, and the wheel has exactly two buttons.
 * This is the shape every eyes-free drill ends on, so getting the directions
 * the wrong way round would quietly record the opposite of what happened.
 */
test('on a self-check, forward is "I had it" and back is "I missed it"', async ({ page }) => {
  test.setTimeout(30_000);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'results', answerPauseMs: 300 },
  });
  await openTrueCountDrill(page);

  await page.getByLabel('Eyes-free audio').check();
  await press(page, 'forward'); // Start

  await expect(page.getByRole('button', { name: 'I missed it' })).toBeVisible({ timeout: 10_000 });
  await press(page, 'back');
  await expect(page.locator('.drill-result .result-wrong')).toBeVisible();
});

test('the count drill takes a running count from the wheel too', async ({ page }) => {
  test.setTimeout(30_000);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full' },
    drill: { countLengthCards: 4, countIntervalMs: 50, countGroup: 1 },
  });

  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await press(page, 'forward'); // Start

  await expect(page.getByText('Enter the running count')).toBeVisible({ timeout: 10_000 });
  await press(page, 'back', 2);

  await expect
    .poll(async () => await spoken(page), { timeout: 4000 })
    .toContain('minus 2. Correct?');
  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 6000 });
});

/* ---------------------------------------------------------------------- */
/* Push to talk                                                            */
/* ---------------------------------------------------------------------- */

/**
 * The other thing two buttons can do: open the microphone instead of
 * answering. It is a MODE, because there is no third gesture -- a fast double
 * press cannot mean "talk" when two quick forwards already mean "plus two".
 */
test('in talk mode, forward opens the microphone and closes it again', async ({ page }) => {
  await withSettings(page, {
    audio: { enabled: true },
    drill: { wheelMode: 'talk' },
  });
  await openTrueCountDrill(page);

  await press(page, 'forward');
  // The window is open and the drill did NOT advance -- that is the whole
  // difference between the two modes, and the failure worth catching is a
  // press that does both.
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  // The diagnostic log buffers for a second before it writes, so this polls
  // rather than reads once.
  await expect
    .poll(
      async () =>
        await page.evaluate(() =>
          (
            JSON.parse(
              localStorage.getItem('bjtrainer.diagnostics.v1') ?? '[]',
            ) as { event: string }[]
          ).some((e) => e.event === 'ptt-open'),
        ),
      { timeout: 4000 },
    )
    .toBe(true);
});

test('in answer mode, forward answers and never opens the microphone', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true }, drill: { wheelMode: 'answer' } });
  await openTrueCountDrill(page);

  await press(page, 'forward');
  await expect(page.getByText('Enter the true count')).toBeVisible();
  // Waited past the log's flush delay, so this is an absence rather than a
  // race: the test above proves the same read SEES the event when it happens.
  await page.waitForTimeout(1500);
  const opened = await page.evaluate(() =>
    (JSON.parse(localStorage.getItem('bjtrainer.diagnostics.v1') ?? '[]') as { event: string }[])
      .some((e) => e.event === 'ptt-open'),
  );
  expect(opened).toBe(false);
});

/* ---------------------------------------------------------------------- */
/* F2: the one phase that asks a question and refused to hear the answer   */
/* ---------------------------------------------------------------------- */

/** The arithmetic on screen, evaluated -- "-3 - (-6)" and friends. */
function solve(prompt: string): number {
  const m = /^\s*(-?\d+)\s*([+\-\u00d7])\s*\(?(-?\d+)\)?\s*$/.exec(prompt);
  if (!m) throw new Error(`unparsed distraction prompt: ${JSON.stringify(prompt)}`);
  const a = Number(m[1]);
  const b = Number(m[3]);
  return m[2] === '+' ? a + b : m[2] === '-' ? a - b : a * b;
}

/**
 * A distraction pauses the stream and waits. Until this, the wheel's switch
 * sent the phase to its default case -- forward meant "yes", which nothing
 * was asking -- and the microphone path refused the transcript outright, so
 * the ONLY way to answer was the NumPad. In the car that means: pick the
 * phone up mid-run, or lose the run.
 */
test('a distraction is answered with the same two buttons the count is', async ({ page }) => {
  test.setTimeout(45_000);
  await page.addInitScript(() => {
    Math.random = () => 0.42;
  });
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full' },
    drill: {
      countIntervalMs: 200,
      countLengthCards: 4,
      countGroup: 1,
      distractionFreq: 'relentless',
    },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(page.locator('.distraction-area')).toBeVisible({ timeout: 15_000 });
  const prompt = await page.locator('.distraction-prompt').innerText();
  const answer = solve(prompt);

  // One press first, on its own: the readback is the proof that the press
  // was taken as a NUMBER rather than swallowed by the phase.
  await page.evaluate(() => {
    window.__speechLog = [];
  });
  await press(page, 'forward');
  await expect
    .poll(async () => (await spoken(page)).join(' | '), { timeout: 4000 })
    .toMatch(/plus 1\./);

  // Then walk the rest of the way and let the quiet commit it, exactly as a
  // running count is entered.
  if (answer >= 1) await press(page, 'forward', answer - 1);
  else await press(page, 'back', 1 - answer);

  // The drill MOVED ON. Not "the distraction area went away": relentless
  // fires again almost immediately, so at any given instant one is usually
  // on screen. What cannot happen on the broken build is the question
  // CHANGING -- nothing there could answer the first one.
  await expect
    .poll(
      async () => {
        const open = await page.locator('.distraction-area').count();
        if (open === 0) return true;
        return (await page.locator('.distraction-prompt').innerText()) !== prompt;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});

/**
 * ...and the answer has to be GRADED, not merely accepted.
 *
 * The first version of this test answered one distraction deliberately wrong
 * and asserted the row said so -- which a commit hardcoded to `0` passes
 * just as well, because 0 is wrong too. So the run answers EVERY distraction
 * correctly except one, and the recorded rows have to match that pattern:
 * any constant, any "dismiss on a press", and any inverted grade fails it.
 *
 * It also runs an entire distraction session on the wheel and nothing else,
 * which is the claim the drill makes.
 */
test('the wheel answer to a distraction is the answer that gets graded', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    Math.random = () => 0.42;
  });
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full' },
    drill: {
      countIntervalMs: 200,
      countLengthCards: 8,
      countGroup: 1,
      distractionFreq: 'relentless',
    },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  /** Walk the entry to `target` from nothing, then let the quiet commit it. */
  async function enter(target: number) {
    if (target >= 1) await press(page, 'forward', target);
    else if (target <= -1) await press(page, 'back', -target);
    else {
      // Zero is still a proposal, and it has to be reached by pressing.
      await press(page, 'forward');
      await press(page, 'back');
    }
  }

  // Which distraction gets the wrong answer. The SECOND, so the pattern has
  // a correct row on either side of it where the run is long enough.
  const SABOTAGE = 1;
  const intended: boolean[] = [];

  for (let guard = 0; guard < 24; guard += 1) {
    if (await page.locator('.drill-result').isVisible().catch(() => false)) break;

    if (await page.locator('.distraction-area').isVisible().catch(() => false)) {
      const answer = solve(await page.locator('.distraction-prompt').innerText());
      const sabotage = intended.length === SABOTAGE;
      await enter(sabotage ? answer + 1 : answer);
      intended.push(!sabotage);
      await page.waitForTimeout(COMMIT_MS + 600);
      continue;
    }

    if (await page.locator('.numpad').isVisible().catch(() => false)) {
      await enter(3); // the final running count; its correctness is not the subject
      await page.waitForTimeout(COMMIT_MS + 600);
      continue;
    }

    await page.waitForTimeout(400); // flashing
  }

  await expect(page.locator('.drill-result'), 'the run never finished on the wheel alone').toBeVisible({
    timeout: 20_000,
  });

  const rows = await page.evaluate(() => {
    const raw = window.localStorage.getItem('bjtrainer.stats.v1');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      distraction?: { history?: { answerCorrect: boolean }[] };
    };
    return parsed.distraction?.history ?? [];
  });
  expect(
    intended.length,
    'fewer than two distractions fired, so the pattern proves nothing',
  ).toBeGreaterThanOrEqual(2);
  expect(rows.map((r) => r.answerCorrect), 'the grades do not match the answers given').toEqual(
    intended,
  );
});
