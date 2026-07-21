import { test, expect, type Page } from '@playwright/test';
import { shot, withSettings, withProfile, resolveInsurance, playRoundByAdvice } from './helpers';

/**
 * Cycle-3 Task 10: `window.__speechLog` e2e coverage for the audio system.
 * `?e2e=1` switches `speak()`/`chime()` (src/audio/speech.ts) into a
 * log-only mode: speech pushes the raw narrated text, chimes push
 * `chime:<kind>`, into ONE ordered array. Every case here asserts on that
 * log's order and key phrases rather than full-array equality (brittle --
 * see the plan's Task 10 note).
 */

declare global {
  interface Window {
    __speechLog?: string[];
  }
}

/** narrateCard's exact format, e.g. "queen of hearts" -- never matches the
 * differently-shaped "Dealer shows ten." (narrateDealerUp) line. */
const CARD_RE =
  /^(ace|two|three|four|five|six|seven|eight|nine|ten|jack|queen|king) of (spades|hearts|diamonds|clubs)$/;
/** narrateBotAction's exact format, e.g. "Player one hits, ten of clubs." / "Player one stands." */
const BOT_ACTION_RE = /^Player (one|two|three|four|five) (hits|stands|doubles|splits|surrenders)/;
/** narrateHandResult's exact format, e.g. "Win, plus two." / "Hand one: Lose, minus one." */
const RESULT_RE = /^(Hand (one|two|three|four|five): )?(Win|Lose|Push|Blackjack!|Surrender)/;

async function readSpeechLog(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__speechLog ?? []);
}

/** Polls `window.__speechLog` until some entry matches `re`, or times out.
 * Needed because Phase-A card/bot-action narration is paced by the same
 * setTimeout-driven reveal effect that paces the on-screen message strip
 * (src/ui/useGame.ts) -- even at dealSpeedMs 0 it's still an async tick. */
async function waitForSpeechLogMatch(page: Page, re: RegExp, timeoutMs = 10_000): Promise<void> {
  await page.waitForFunction(
    (source) => {
      const log = (window as unknown as { __speechLog?: string[] }).__speechLog;
      if (!log) return false;
      const regex = new RegExp(source);
      return log.some((l) => regex.test(l));
    },
    re.source,
    { timeout: timeoutMs },
  );
}

interface DealOpts {
  verbosity: 'off' | 'results' | 'full';
  seats?: { playerHands: number; bots: number; botMistakePct: number; playerPosition: number };
}

/**
 * Enables audio at the given verbosity, deals seeds 1..30 until one reaches
 * a live player decision (skipping any dealer/player-natural short circuit
 * -- same retry pattern as table-seats.spec.ts), and returns whether one
 * was found. `dealSpeedMs: 0` keeps the bot-narration pacing effect fast
 * (still async -- see waitForSpeechLogMatch) without disabling it.
 */
async function dealToDecision(page: Page, opts: DealOpts): Promise<boolean> {
  await withSettings(page, { dealSpeedMs: 0, audio: { enabled: true, verbosity: opts.verbosity } });
  await withProfile(page, {
    name: 'Audio E2E Profile',
    seats: opts.seats ?? { playerHands: 1, bots: 0, botMistakePct: 0, playerPosition: 0 },
  });

  for (let seed = 1; seed <= 30; seed++) {
    await page.goto(`/?seed=${seed}&e2e=1`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await resolveInsurance(page, false);
    const bar = page.locator('.action-bar[data-advice]');
    if (await bar.isVisible().catch(() => false)) return true;
  }
  return false;
}

/* ---------------------------------------------------------------- */
/* Screenshot: Settings Audio section                                */
/* ---------------------------------------------------------------- */

test('settings: the Audio section renders with enabled controls', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, verbosity: 'full' } });
  await withProfile(page, { name: 'Audio Settings Profile' });

  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Settings');

  const audioHeading = page.locator('.settings-section-title', { hasText: 'Audio' });
  await audioHeading.scrollIntoViewIfNeeded();
  await shot(page, '55-settings-audio-section');

  await expect(page.getByRole('button', { name: 'Test audio', exact: true })).toBeEnabled();
});

/* ---------------------------------------------------------------- */
/* Case 1/2: Table narration at 'full' vs 'results'                  */
/* ---------------------------------------------------------------- */

test('verbosity full: dealt cards and a bot action line precede the result', async ({ page }) => {
  test.setTimeout(60_000);
  const dealt = await dealToDecision(page, {
    verbosity: 'full',
    seats: { playerHands: 1, bots: 1, botMistakePct: 0, playerPosition: 0 },
  });
  expect(dealt, 'expected at least one of seeds 1..30 to reach a live player decision').toBe(true);
  await expect(page.locator('.bot-seat')).toHaveCount(1);

  await playRoundByAdvice(page);

  // Bot-action narration is paced (async); the result line is spoken
  // synchronously inside act() the instant the round settles, so it's
  // already present -- only the bot line needs a poll.
  await waitForSpeechLogMatch(page, BOT_ACTION_RE);

  const log = await readSpeechLog(page);
  const cardIndex = log.findIndex((l) => CARD_RE.test(l));
  const botIndex = log.findIndex((l) => BOT_ACTION_RE.test(l));
  const resultIndex = log.findIndex((l) => RESULT_RE.test(l));

  expect(cardIndex, `expected a dealt-card entry in ${JSON.stringify(log)}`).toBeGreaterThanOrEqual(0);
  expect(botIndex, `expected a bot-action entry in ${JSON.stringify(log)}`).toBeGreaterThanOrEqual(0);
  expect(resultIndex, `expected a result entry in ${JSON.stringify(log)}`).toBeGreaterThanOrEqual(0);
  expect(cardIndex).toBeLessThan(resultIndex);
});

test("verbosity results: the result line is present but individual card names are not", async ({ page }) => {
  test.setTimeout(60_000);
  const dealt = await dealToDecision(page, {
    verbosity: 'results',
    seats: { playerHands: 1, bots: 1, botMistakePct: 0, playerPosition: 0 },
  });
  expect(dealt, 'expected at least one of seeds 1..30 to reach a live player decision').toBe(true);

  await playRoundByAdvice(page);
  await waitForSpeechLogMatch(page, RESULT_RE);

  const log = await readSpeechLog(page);
  expect(log.some((l) => RESULT_RE.test(l)), `expected a result entry in ${JSON.stringify(log)}`).toBe(true);
  expect(log.some((l) => CARD_RE.test(l)), `expected NO card-name entries in ${JSON.stringify(log)}`).toBe(false);
});

/* ---------------------------------------------------------------- */
/* Case 3: Training correction                                       */
/* ---------------------------------------------------------------- */

test('training correction: a wrong play speaks "Wrong. ..." and chimes bad', async ({ page }) => {
  test.setTimeout(60_000);
  const dealt = await dealToDecision(page, { verbosity: 'results' });
  expect(dealt, 'expected at least one of seeds 1..30 to reach a live player decision').toBe(true);

  const bar = page.locator('.action-bar[data-advice]');
  const advice = await bar.getAttribute('data-advice');
  expect(advice).toBeTruthy();

  // Hit and stand are always legal on a fresh two-card hand, so whichever
  // one isn't the advice is guaranteed both legal AND wrong -- forcing a
  // training-mode miss deterministically regardless of what the advice is.
  const wrongLabel = advice === 'hit' ? 'Stand' : 'Hit';
  await bar.getByRole('button', { name: wrongLabel, exact: true }).click();

  await waitForSpeechLogMatch(page, /^Wrong\. /);
  const log = await readSpeechLog(page);
  expect(log.some((l) => l.startsWith('Wrong. ')), `expected a "Wrong. " entry in ${JSON.stringify(log)}`).toBe(
    true,
  );
  expect(log).toContain('chime:bad');
});

/* ---------------------------------------------------------------- */
/* Case 4: Eyes-free count drill                                     */
/* ---------------------------------------------------------------- */

test('eyes-free count drill: cards, then the count prompt, then the spoken answer', async ({ page }) => {
  test.setTimeout(30_000);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'results', answerPauseMs: 2000 },
    drill: { countLengthCards: 13, countGroup: 1, countManual: true },
  });
  await withProfile(page, { name: 'Audio Count Drill Profile' });

  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();

  await page.getByLabel('Eyes-free audio').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  const tapZone = page.locator('.manual-tap-zone');
  await expect(tapZone).toBeVisible();
  await shot(page, '56-eyesfree-count-drill-running');

  // countLengthCards:13, countGroup:1 -> 13 groups; the 13th tap (once
  // shownIndex reaches the last card) advances past flashing into the
  // spoken self-check rather than revealing another card.
  for (let i = 0; i < 13; i++) {
    await tapZone.click();
  }

  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 10_000 });

  const log = await readSpeechLog(page);
  const promptIndex = log.indexOf("What's the running count?");
  expect(promptIndex, `expected the count prompt in ${JSON.stringify(log)}`).toBeGreaterThanOrEqual(0);

  const firstCardIndex = log.findIndex((l) => CARD_RE.test(l));
  expect(firstCardIndex, `expected card narration in ${JSON.stringify(log)}`).toBeGreaterThanOrEqual(0);
  expect(firstCardIndex).toBeLessThan(promptIndex);

  const answerIndex = log.findIndex((l, i) => i > promptIndex && /^The count is .+\.$/.test(l));
  expect(answerIndex, `expected the spoken count answer in ${JSON.stringify(log)}`).toBeGreaterThanOrEqual(0);
});

/* ---------------------------------------------------------------- */
/* Case 5: Eyes-free flashcards                                      */
/* ---------------------------------------------------------------- */

test('eyes-free flashcards: prompt, coordinate tap, spoken echo + verdict + chime', async ({ page }) => {
  test.setTimeout(30_000);
  await withSettings(page, { audio: { enabled: true, verbosity: 'results' } });
  await withProfile(page, { name: 'Audio Flashcards Profile' });

  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();

  await page.getByLabel('Eyes-free audio').check();
  await waitForSpeechLogMatch(page, /^You have /);

  const zonePad = page.locator('.zone-pad');
  await expect(zonePad).toBeAttached();
  await shot(page, '57-zonepad-overlay-flashcards');

  // Top-left quadrant of the 390x844 viewport, well clear of the center
  // circle (radius 0.22 * min(390,844) ~= 86px around (195, 422)) -- lands
  // on 'hit' (src/audio/zones.ts).
  await page.mouse.click(60, 100);

  await waitForSpeechLogMatch(page, /^Hit/);
  const log = await readSpeechLog(page);
  const echoIndex = log.findIndex((l) => l.startsWith('Hit'));
  expect(echoIndex, `expected the "Hit..." echo in ${JSON.stringify(log)}`).toBeGreaterThanOrEqual(0);

  const verdictIndex = log.findIndex((l, i) => i > echoIndex && (l === 'Correct.' || l.startsWith('Wrong. ')));
  expect(verdictIndex, `expected a verdict line in ${JSON.stringify(log)}`).toBeGreaterThanOrEqual(0);

  const chimeIndex = log.findIndex((l, i) => i > verdictIndex && (l === 'chime:good' || l === 'chime:bad'));
  expect(chimeIndex, `expected a chime after the verdict in ${JSON.stringify(log)}`).toBeGreaterThanOrEqual(0);
});

/* ---------------------------------------------------------------- */
/* Case 6: Insurance zone variant                                    */
/* ---------------------------------------------------------------- */

test('eyes-free deviation quiz: insurance two-zone prompt, left-half tap logs Take', async ({ page }) => {
  test.setTimeout(30_000);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'results' },
    drill: { quizIndex: 'ins' }, // forces every drawn item to the insurance deviation
  });
  await withProfile(page, { name: 'Audio Quiz Insurance Profile' });

  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation Quiz', exact: true }).click();
  await expect(page.locator('.quiz-insurance-prompt')).toBeVisible();

  await page.getByLabel('Eyes-free audio').check();
  await waitForSpeechLogMatch(page, /Insurance offered\./);

  const zonePad = page.locator('.zone-pad');
  await expect(zonePad).toBeAttached();
  await shot(page, '58-zonepad-insurance-variant');

  const preTapLog = await readSpeechLog(page);
  const promptEntry = preTapLog.find((l) => l.includes('Insurance offered.'));
  expect(promptEntry, `expected the insurance prompt in ${JSON.stringify(preTapLog)}`).toBeTruthy();
  expect(promptEntry).toContain('Dealer shows ace.');
  expect(promptEntry).toContain('True count');

  // Left half of the viewport -- insurance mode has no center circle, so
  // this always lands on 'take' (src/audio/zones.ts).
  await page.mouse.click(60, 422);

  await waitForSpeechLogMatch(page, /^Take/);
  const log = await readSpeechLog(page);
  expect(log.some((l) => l.startsWith('Take')), `expected a "Take..." echo in ${JSON.stringify(log)}`).toBe(true);
});

/* ---------------------------------------------------------------- */
/* Case 7: Audio off (default) -- the parity guard                   */
/* ---------------------------------------------------------------- */

test('audio off (default): a full round leaves __speechLog empty or undefined', async ({ page }) => {
  test.setTimeout(60_000);
  await withSettings(page, { dealSpeedMs: 0 }); // audio untouched -> DEFAULT_AUDIO.enabled === false
  await withProfile(page, { name: 'Audio Off Profile' });

  let dealt = false;
  for (let seed = 1; seed <= 30 && !dealt; seed++) {
    await page.goto(`/?seed=${seed}&e2e=1`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await resolveInsurance(page, false);
    const bar = page.locator('.action-bar[data-advice]');
    if (await bar.isVisible().catch(() => false)) dealt = true;
  }
  expect(dealt, 'expected at least one of seeds 1..30 to reach a live player decision').toBe(true);

  await playRoundByAdvice(page);

  // A brief settle so any (unexpected) async narration effect would have
  // had time to push into the log before we assert its absence.
  await page.waitForTimeout(500);

  const log = await page.evaluate(() => window.__speechLog);
  expect(log === undefined || log.length === 0, `expected no speech log entries, got ${JSON.stringify(log)}`).toBe(
    true,
  );
});
