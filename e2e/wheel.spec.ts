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

/**
 * Answer mode, stated rather than inherited.
 *
 * Every test here except the push-to-talk pair is about what the two buttons
 * do when they ANSWER, and they used to get that from DEFAULT_SETTINGS. The
 * default is now 'talk' (store/types.ts), so a test that does not name its
 * mode is testing whichever one shipped last -- which is how seventeen of
 * these began opening a microphone instead of answering a drill.
 */
async function inAnswerMode(page: Page, patch: Record<string, unknown> = {}): Promise<void> {
  const drill = { ...((patch.drill as Record<string, unknown>) ?? {}), wheelMode: 'answer' };
  await withSettings(page, { ...patch, drill });
}

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
  await inAnswerMode(page, { audio: { enabled: true, verbosity: 'full' } });
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
  await inAnswerMode(page, { audio: { enabled: true, verbosity: 'full' } });
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
  await inAnswerMode(page, { audio: { enabled: true, verbosity: 'full' } });
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
  await inAnswerMode(page, { audio: { enabled: true, verbosity: 'full' } });
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
  await inAnswerMode(page, {
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
  await inAnswerMode(page, {
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
  await inAnswerMode(page, { audio: { enabled: true }, drill: { wheelMode: 'answer' } });
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
  await inAnswerMode(page, {
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
  await inAnswerMode(page, {
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

/* ---------------------------------------------------------------------- */
/* F4: the deviation quiz, on the wheel                                    */
/* ---------------------------------------------------------------------- */

async function openQuiz(page: Page, index = '16v10'): Promise<void> {
  await inAnswerMode(page, {
    audio: { enabled: true, verbosity: 'results', answerPauseMs: 15000 },
    drill: { quizIndex: index },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation Quiz', exact: true }).click();
  await expect(page.locator('.quiz-tc')).toBeVisible();
}

/**
 * The quiz had the eyes-free toggle, narrated the hand, and then offered
 * nothing but the glass to answer on -- no wheel, no microphone. A quiz
 * answer is a five-way choice and the wheel has two buttons, so what it runs
 * is the self-check the flashcards and the count drills already use: say the
 * right play, then ask whether you had it.
 */
test('the quiz reveals the play and asks whether you had it', async ({ page }) => {
  await openQuiz(page);
  await expect(page.getByTestId('quiz-selfcheck')).toHaveCount(0);

  await press(page, 'forward');
  const banner = page.getByTestId('quiz-selfcheck');
  await expect(banner).toBeVisible();
  await expect(banner.locator('strong')).toHaveText(/Hit|Stand|Double|Split|Surrender/);
  expect((await spoken(page)).join(' | ')).toContain('Did you have it?');
});

test('on a quiz self-check, forward is "I had it" and back is "I missed it"', async ({ page }) => {
  await openQuiz(page);
  await press(page, 'forward'); // reveal
  await press(page, 'forward'); // I had it
  await expect(page.locator('.message-strip .result-correct')).toBeVisible();

  await openQuiz(page);
  await press(page, 'forward');
  await press(page, 'back'); // I missed it
  await expect(page.locator('.message-strip .result-correct')).toHaveCount(0);
  // The app has its own words for an admitted miss, and they are not the
  // words for a wrong play -- no play was made.
  await expect(page.locator('.message-strip')).toContainText(/Admitted miss|Said you missed it/);
});

/**
 * ...and a self-report is recorded as one. Graded through `classifyAction`
 * it would enter Stats and the review deck as a play the learner never made
 * -- which is why the quiz could not offer the self-check until the grader
 * learned the two markers.
 */
test('a quiz self-report is recorded as a self-report, not as a play', async ({ page }) => {
  await openQuiz(page);
  await press(page, 'forward');
  await press(page, 'back'); // I missed it
  await expect(page.locator('.message-strip')).toContainText(/Admitted miss|Said you missed it/);

  const mistakes = await page.evaluate(() => {
    const raw = window.localStorage.getItem('bjtrainer.stats.v1');
    if (!raw) return null;
    return (JSON.parse(raw) as { mistakes?: Record<string, number> }).mistakes ?? null;
  });
  expect(mistakes, 'nothing was written to Stats at all').not.toBeNull();
  expect(mistakes!['self-report'], `mistake tallies were ${JSON.stringify(mistakes)}`).toBe(1);
  // ...and NOT as one of the five plays gone wrong.
  expect(mistakes!['basic-error'] ?? 0).toBe(0);
});

/**
 * ...and the mixed session, which is what an operator actually runs for
 * twenty minutes in the car: it alternates the two drills, so the wheel has
 * to work on both kinds of item.
 */
test('the mixed session takes a self-check on either kind of item', async ({ page }) => {
  test.setTimeout(45_000);
  await inAnswerMode(page, {
    audio: { enabled: true, verbosity: 'results', answerPauseMs: 15000 },
    drill: { quizIndex: '16v10' },
  });
  // PINNED, because it never was. The assertion below needs BOTH item kinds
  // to turn up, and the interleave seed is `randomSeed()` off a live
  // `Math.random()` -- so this test was an unseeded coin flip asserting that
  // eight flips were not all the same, which fails 2*(1/2)^8 = 1 run in 128.
  // It duly failed on 2026-09-29 with `seen` = {quiz}. The comment below used
  // to call the flip "seeded" and there was no seed anywhere in the file.
  // `drills.spec.ts` already pins it the same way for the same schedule:
  // floor(0.42*1e9) = 420000000, whose pickMixedType sequence is
  // quiz,quiz,quiz,flash,flash,flash (locked in mixedSession.test.ts), so
  // both kinds are reached by item four.
  await page.addInitScript(() => {
    Math.random = () => 0.42;
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Mixed', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Mixed');

  const seen = new Set<string>();
  for (let i = 0; i < 8 && seen.size < 2; i += 1) {
    const kind = (await page.locator('.quiz-tc').count()) > 0 ? 'quiz' : 'flash';
    await press(page, 'forward'); // reveal
    await expect(page.getByTestId('mixed-selfcheck')).toBeVisible();
    await press(page, 'forward'); // I had it
    await expect(page.locator('.message-strip .result-correct')).toBeVisible();
    seen.add(kind);
    await press(page, 'forward'); // next item
    await expect(page.locator('.message-strip .result-correct')).toHaveCount(0);
  }
  // With the seed pinned above this is deterministic: quiz at item one,
  // flash at item four. A run that saw only one kind has not tested the
  // dispatch -- and now that can only mean the schedule itself moved.
  expect([...seen].sort(), 'only one kind of item ever appeared').toEqual(['flash', 'quiz']);
});
