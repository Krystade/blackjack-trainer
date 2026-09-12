import { test, expect, type Page, type Response as PWResponse } from '@playwright/test';
import {
  withSettings,
  withProfile,
  answerSelfReportIfPresent,
  resolveInsurance,
} from './helpers';

/**
 * T0 gap 1 (the headline gap, docs/research/2026-07-26-test-coverage-matrix.md
 * "SPEC -- Clip-playback harness"): a NON-`?e2e=1` harness for real clip
 * playback. Every other e2e spec navigates with `?e2e=1`, which makes
 * `isE2eAudioMode()` true and short-circuits `speak()`/`speakAsync()` into
 * `window.__speechLog` BEFORE the clips.ts gate (src/audio/speech.ts) -- so
 * `playClipsAsync` (real mp3 fetch + HTMLAudio playback) has never once run
 * under Playwright. This spec runs WITHOUT `?e2e=1` in the `chromium-audio`
 * Playwright project (playwright.config.ts), which launches Chromium with
 * `--autoplay-policy=no-user-gesture-required` so audio can play headless.
 *
 * Headless Chromium can't "hear," so the harness asserts on the maximal
 * reachable signal instead of audible sound: real network fetches of the
 * clip assets, the eyes-free drill loop actually completing (a stuck clip
 * promise would hang the loop and time out), and a clean console (catches
 * decode/MIME/`playbackRate` exceptions).
 */

/**
 * Guard two of two against this harness being audible, independent of the
 * project's `--mute-audio` launch flag (playwright.config.ts): every media
 * element reports itself muted and ignores attempts to unmute.
 *
 * Nothing in src/ reads `.muted` -- volume is set through `volume` and, above
 * 100%, through a Web Audio gain node -- so this changes no value the spec
 * asserts on, and playback still progresses and still fires `ended`.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
      configurable: true,
      get: () => true,
      set: () => {},
    });
  });
});

const MP3_RE = /\/clips\/af_bella\/.*\.mp3(\?.*)?$/;
const INDEX_RE = /\/clips\/index\.json(\?.*)?$/;
const MANIFEST_RE = /\/clips\/af_bella\/manifest\.json(\?.*)?$/;

interface ClipHarness {
  mp3Responses: PWResponse[];
  indexResponses: PWResponse[];
  manifestResponses: PWResponse[];
  consoleErrors: string[];
  pageErrors: string[];
}

/** `<audio>` elements issue HTTP Range requests, so a real successfully-served
 * mp3 can legitimately come back `206 Partial Content` rather than `200` --
 * this is correct server/browser behavior, not a failure. Both mean "the
 * asset was actually served"; only a 404/5xx indicates a real miss. */
function expectServedOk(res: PWResponse): void {
  expect([200, 206], `expected 200 or 206 for ${res.url()}, got ${res.status()}`).toContain(res.status());
}

/** Attaches response/console/pageerror listeners. Must be called BEFORE
 * page.goto() -- listeners attached after navigation would miss requests
 * fired during the initial load. */
function attachClipHarness(page: Page): ClipHarness {
  const harness: ClipHarness = {
    mp3Responses: [],
    indexResponses: [],
    manifestResponses: [],
    consoleErrors: [],
    pageErrors: [],
  };

  page.on('response', (res) => {
    const url = res.url();
    if (MP3_RE.test(url)) harness.mp3Responses.push(res);
    else if (INDEX_RE.test(url)) harness.indexResponses.push(res);
    else if (MANIFEST_RE.test(url)) harness.manifestResponses.push(res);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') harness.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    harness.pageErrors.push(err.message);
  });

  return harness;
}

/**
 * Settings.tsx is the ONLY place in the app that calls `loadClipIndex()`
 * (its Audio-section effect populates the clip-voice picker); clips.ts's own
 * internal calls to it are short-circuited away whenever `clipVoice` is
 * pinned (`currentClipVoice ||` in `playClipsAsync`/`resolveVoiceIdSync`
 * never reaches the fallback branch once a real voice id is set). Since this
 * harness pins `clipVoice: 'af_bella'` for deterministic filenames (matrix
 * spec step 1), a real user reaches that same state by visiting Settings and
 * toggling "Use recorded voice" -- so a brief Settings visit here is both
 * how `index.json` actually gets fetched AND a realistic path to this state,
 * not a workaround.
 */
async function warmSettingsForClipIndex(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Settings');
  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
}

/** Navigates to Drills -> Count Drill, enables eyes-free audio, and starts a
 * short auto (non-manual) run -- the same shape as audio.spec.ts's Case 4b,
 * except real clip playback runs here because there's no `?e2e=1`. */
async function startEyesFreeCountDrill(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count Drill', exact: true }).click();
  await page.getByLabel('Eyes-free audio').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
}

async function seedClipDrillSettings(page: Page, audioPatch: Record<string, unknown> = {}): Promise<void> {
  await withSettings(page, {
    audio: {
      enabled: true,
      useClips: true,
      verbosity: 'full',
      cardDetail: 'full',
      clipVoice: 'af_bella',
      answerPauseMs: 500,
      ...audioPatch,
    },
    drill: { countManual: false, countLengthCards: 5, countGroup: 1, countIntervalMs: 0 },
  });
}

/* ------------------------------------------------------------------------ */
/* Main harness: real clip fetch + playback + clean completion              */
/* ------------------------------------------------------------------------ */

test('clip playback (no ?e2e=1): eyes-free count drill fetches real clips and completes cleanly', async ({
  page,
}) => {
  test.setTimeout(30_000);
  await seedClipDrillSettings(page);
  await withProfile(page, { name: 'Clip Playback E2E Profile' });

  const harness = attachClipHarness(page);

  await warmSettingsForClipIndex(page);
  await startEyesFreeCountDrill(page);

  // The no-hang guarantee: if a clip promise never resolves, the eyes-free
  // auto loop (CountDrillView's speech-driven effect) stalls forever and
  // this times out.
  await answerSelfReportIfPresent(page);
  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 20_000 });

  const distinctMp3Urls = new Set(harness.mp3Responses.map((r) => r.url()));
  expect(
    distinctMp3Urls.size,
    `expected >=5 distinct mp3 fetches, got ${JSON.stringify([...distinctMp3Urls])}`,
  ).toBeGreaterThanOrEqual(5);
  for (const res of harness.mp3Responses) {
    expectServedOk(res);
  }

  expect(harness.indexResponses.length, 'expected index.json fetched exactly once (memoized)').toBe(1);
  expect(harness.indexResponses[0]?.status()).toBe(200);
  expect(harness.manifestResponses.length, 'expected af_bella manifest.json fetched exactly once (memoized)').toBe(
    1,
  );
  expect(harness.manifestResponses[0]?.status()).toBe(200);

  expect(harness.consoleErrors, `expected zero console errors, got ${JSON.stringify(harness.consoleErrors)}`).toEqual(
    [],
  );
  expect(harness.pageErrors, `expected zero page errors, got ${JSON.stringify(harness.pageErrors)}`).toEqual([]);
});

/* ------------------------------------------------------------------------ */
/* Fallback variant: unresolvable clip voice -> live-TTS fallback           */
/* ------------------------------------------------------------------------ */

test('clip playback fallback: a bogus clip voice still completes the drill via live TTS', async ({ page }) => {
  test.setTimeout(30_000);
  // Bogus clipVoice -> `/clips/<bogus>/manifest.json` 404s -> loadVoiceManifest
  // resolves `{}` -> segmentForClips never matches -> every speak()/speakAsync()
  // call falls back to live speechSynthesis. Proves the cascade-miss path
  // doesn't hang or throw even when NOTHING resolves to a clip.
  await seedClipDrillSettings(page, { clipVoice: 'not-a-real-voice-id' });
  await withProfile(page, { name: 'Clip Playback Fallback Profile' });

  const harness = attachClipHarness(page);

  await page.goto('/');
  await startEyesFreeCountDrill(page);

  await answerSelfReportIfPresent(page);
  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 20_000 });

  expect(
    harness.mp3Responses.length,
    `expected no mp3 fetches for a bogus voice, got ${JSON.stringify(harness.mp3Responses.map((r) => r.url()))}`,
  ).toBe(0);
  expect(harness.consoleErrors, `expected zero console errors, got ${JSON.stringify(harness.consoleErrors)}`).toEqual(
    [],
  );
  expect(harness.pageErrors, `expected zero page errors, got ${JSON.stringify(harness.pageErrors)}`).toEqual([]);
});

/* ------------------------------------------------------------------------ */
/* Rate variant: fast playbackRate doesn't break the clip chain             */
/* ------------------------------------------------------------------------ */

test('clip playback at rate=2.0 still fetches clips and completes cleanly', async ({ page }) => {
  test.setTimeout(30_000);
  await seedClipDrillSettings(page, { rate: 2.0 });
  await withProfile(page, { name: 'Clip Playback Rate2 Profile' });

  const harness = attachClipHarness(page);

  await warmSettingsForClipIndex(page);
  await startEyesFreeCountDrill(page);

  await answerSelfReportIfPresent(page);
  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 20_000 });

  const distinctMp3Urls = new Set(harness.mp3Responses.map((r) => r.url()));
  expect(
    distinctMp3Urls.size,
    `expected clips to still be fetched at rate 2.0, got ${JSON.stringify([...distinctMp3Urls])}`,
  ).toBeGreaterThanOrEqual(5);
  for (const res of harness.mp3Responses) {
    expectServedOk(res);
  }

  expect(harness.consoleErrors, `expected zero console errors, got ${JSON.stringify(harness.consoleErrors)}`).toEqual(
    [],
  );
  expect(harness.pageErrors, `expected zero page errors, got ${JSON.stringify(harness.pageErrors)}`).toEqual([]);
});

/* ------------------------------------------------------------------------ */
/* Volume boost: the >100% path actually routes, and the normal path doesn't */
/* ------------------------------------------------------------------------ */

/**
 * Instrument the two things that matter about amplification.
 *
 * `HTMLMediaElement.volume` THROWS IndexSizeError above 1, so every value
 * handed to the element is recorded -- a regression there does not look like
 * a wrong loudness, it looks like an exception that kills the utterance.
 * `createMediaElementSource` calls are counted because routing through Web
 * Audio is the risky path: once an element is in the graph, a suspended
 * context makes it SILENT rather than quiet.
 */
async function instrumentAudioRouting(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __mesCalls: number; __elVolumes: number[]; __gains: number[] };
    w.__mesCalls = 0;
    w.__elVolumes = [];
    w.__gains = [];

    const proto = HTMLMediaElement.prototype as unknown as object;
    const desc = Object.getOwnPropertyDescriptor(proto, 'volume')!;
    Object.defineProperty(proto, 'volume', {
      ...desc,
      set(this: HTMLMediaElement, v: number) {
        w.__elVolumes.push(v);
        desc.set!.call(this, v);
      },
    });

    const Ctx = (window as unknown as { AudioContext: typeof AudioContext }).AudioContext;
    const origMes = Ctx.prototype.createMediaElementSource;
    Ctx.prototype.createMediaElementSource = function (el: HTMLMediaElement) {
      w.__mesCalls += 1;
      return origMes.call(this, el);
    };
    const origGain = Ctx.prototype.createGain;
    Ctx.prototype.createGain = function () {
      const g = origGain.call(this);
      const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(g.gain), 'value')!;
      Object.defineProperty(g.gain, 'value', {
        configurable: true,
        get() { return d.get!.call(this); },
        set(v: number) { w.__gains.push(v); d.set!.call(this, v); },
      });
      return g;
    };
  });
}

test('volume 200%: clips route through a gain node, and the element stays at 1', async ({ page }) => {
  test.setTimeout(30_000);
  await instrumentAudioRouting(page);
  await seedClipDrillSettings(page, { volume: 2 });
  await withProfile(page, { name: 'Clip Volume E2E Profile' });
  const harness = attachClipHarness(page);

  await warmSettingsForClipIndex(page);
  await startEyesFreeCountDrill(page);
  await answerSelfReportIfPresent(page);
  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 20_000 });

  const seen = await page.evaluate(() => ({
    mes: (window as unknown as { __mesCalls: number }).__mesCalls,
    elVolumes: (window as unknown as { __elVolumes: number[] }).__elVolumes,
    gains: (window as unknown as { __gains: number[] }).__gains,
  }));

  // The boost is actually engaged...
  expect(seen.mes, 'expected clips to be routed through Web Audio at 200%').toBeGreaterThan(0);
  expect(seen.gains, 'expected a gain of 2 to be applied').toContain(2);
  // ...and the element was never given a value that would throw.
  expect(Math.max(...seen.elVolumes)).toBeLessThanOrEqual(1);
  expect(harness.pageErrors).toEqual([]);
});

/**
 * The safety property, and the reason the boost is opt-in rather than always
 * on: at normal volumes nothing may touch Web Audio at all, so ordinary
 * playback cannot be silenced by a suspended context.
 */
test('volume 100%: clips never touch Web Audio', async ({ page }) => {
  test.setTimeout(30_000);
  await instrumentAudioRouting(page);
  await seedClipDrillSettings(page, { volume: 1 });
  await withProfile(page, { name: 'Clip Volume E2E Profile' });
  const harness = attachClipHarness(page);

  await warmSettingsForClipIndex(page);
  await startEyesFreeCountDrill(page);
  await answerSelfReportIfPresent(page);
  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 20_000 });

  const seen = await page.evaluate(() => ({
    mes: (window as unknown as { __mesCalls: number }).__mesCalls,
    elVolumes: (window as unknown as { __elVolumes: number[] }).__elVolumes,
  }));

  expect(seen.mes, 'ordinary playback must not be routed through Web Audio').toBe(0);
  // Proof this test could have failed: clips really did play.
  expect(seen.elVolumes.length).toBeGreaterThan(0);
  expect(harness.pageErrors).toEqual([]);
});

/* ------------------------------------------------------------------------ */
/* The table: bot turns and corrections, the two surfaces clipped 2026-09-10 */
/* ------------------------------------------------------------------------ */

/**
 * Records every utterance that MISSED the clip cascade, and speaks none of them.
 *
 * speech.ts tries clips first and only reaches `speechSynthesis` when
 * segmentation returns null, so this list is exactly the set of things that
 * fell back to live TTS -- the only direct instrument for the property the
 * clip work turns on. Segmentation is all-or-nothing: one uncovered sentence
 * sends the WHOLE utterance live, so "no live speech matching X" is a much
 * stronger claim than "some clip was fetched".
 *
 * It also fires `end` so sequencing still works (speakAsync awaits it), and
 * never calls through -- the platform speech engine is outside Chromium and
 * outside `--mute-audio`, so stubbing it is the only way a fallback can be
 * exercised without being heard.
 */
async function recordLiveSpeech(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __liveSpeech: string[] };
    w.__liveSpeech = [];
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.speak = (utterance: SpeechSynthesisUtterance) => {
      w.__liveSpeech.push(utterance.text);
      setTimeout(() => utterance.dispatchEvent(new Event('end')), 0);
    };
  });
}

function liveSpeech(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __liveSpeech: string[] }).__liveSpeech ?? []);
}

const BOT_CLIP_RE = /\/player-(one|two|three|four|five)-(hits|stands|doubles|splits|surrenders)\.mp3/;
/** Matches a bot line whether it ends there or runs on into a comma clause --
 * the comma form is what this used to be, and the whole point is that no bot
 * line reaches live TTS in EITHER shape. */
const BOT_LINE_RE = /^Player (one|two|three|four|five) (hits|stands|doubles|splits|surrenders)[.,]/;
/** A card as a SENTENCE ("Ten of clubs.") -- the `-item` suffix is the
 * comma-list form, which is a different recording and a different clip. */
const CARD_SENTENCE_CLIP_RE = /\/(ace|two|three|four|five|six|seven|eight|nine|ten|jack|queen|king)-of-(spades|hearts|diamonds|clubs)\.mp3/;

test('a bot turn plays from clips, both halves of it', async ({ page }) => {
  test.setTimeout(120_000);
  // One withSettings call, not two: each writes the whole settings blob from
  // an init script, so a second would silently drop the first's audio patch.
  await withSettings(page, {
    dealSpeedMs: 0,
    audio: {
      enabled: true,
      useClips: true,
      verbosity: 'full',
      cardDetail: 'full',
      clipVoice: 'af_bella',
      answerPauseMs: 500,
    },
  });
  await withProfile(page, {
    name: 'Clip Bot Turn Profile',
    seats: { playerHands: 1, bots: 1, botMistakePct: 0, playerPosition: 0 },
  });
  await recordLiveSpeech(page);

  const harness = attachClipHarness(page);

  // `data-advice` is an ?e2e=1-only affordance (Table.tsx guards it with
  // isE2E), and this project deliberately runs without it -- so this plays by
  // standing rather than by advice. Standing is always legal on a fresh hand
  // and always ends the player's turn, which is all this needs: the bots act
  // after the player does, and their turns are what is under test.
  const stand = page.getByRole('button', { name: 'Stand', exact: true });
  let dealt = false;
  for (let seed = 1; seed <= 12 && !dealt; seed += 1) {
    await page.goto(`/?seed=${seed}`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await resolveInsurance(page, false);
    // Dealing here is paced and animated (no ?e2e=1 to make it instant), so
    // the action bar arrives a beat after Deal rather than synchronously.
    dealt = await stand
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);
  }
  expect(dealt, 'expected one of seeds 1..12 to reach a live player decision').toBe(true);

  // One click per player hand; the bar goes away once the round leaves the
  // player phase.
  for (let i = 0; i < 4; i += 1) {
    if (!(await stand.isVisible().catch(() => false))) break;
    if (!(await stand.isEnabled().catch(() => false))) break;
    await stand.click();
    await page.waitForTimeout(200);
  }

  await expect
    .poll(() => harness.mp3Responses.filter((r) => BOT_CLIP_RE.test(r.url())).length, {
      timeout: 20_000,
      message: 'expected a bot-turn clip to be fetched',
    })
    .toBeGreaterThan(0);

  // The card half arrives only once the first clip has finished playing (the
  // chain is sequential), so this polls rather than snapshotting.
  await expect
    .poll(() => harness.mp3Responses.filter((r) => CARD_SENTENCE_CLIP_RE.test(r.url())).length, {
      timeout: 20_000,
      message: 'expected the card half of a bot turn as a sentence clip',
    })
    .toBeGreaterThan(0);

  for (const res of harness.mp3Responses) expectServedOk(res);

  // The point of splitting narrateBotAction into two sentences: before it, a
  // bot turn was one comma clause that no clip could cover, so every one of
  // them went live.
  const live = await liveSpeech(page);
  expect(
    live.filter((l) => BOT_LINE_RE.test(l)),
    `expected no bot turn to fall back to live TTS, got ${JSON.stringify(live)}`,
  ).toEqual([]);

  expect(harness.pageErrors, `expected zero page errors, got ${JSON.stringify(harness.pageErrors)}`).toEqual([]);
});

test('a correction plays from clips, whole', async ({ page }) => {
  test.setTimeout(60_000);
  await seedClipDrillSettings(page, { verbosity: 'full' });
  await withProfile(page, { name: 'Clip Correction Profile' });
  await recordLiveSpeech(page);

  const harness = attachClipHarness(page);

  await page.goto('/');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');

  // Answer until one is graded wrong -- always the first action button, which
  // is wrong often enough to land inside a dozen cards.
  const showTable = page.getByRole('button', { name: 'Show me the table' });
  for (let i = 0; i < 16; i += 1) {
    if (await showTable.isVisible().catch(() => false)) break;
    await page.locator('.action-bar button').first().click();
    await page.waitForTimeout(150);
    if (await showTable.isVisible().catch(() => false)) break;
    const next = page.getByRole('button', { name: 'Next', exact: true });
    if (await next.isVisible().catch(() => false)) await next.click();
  }
  await expect(showTable).toBeVisible();

  await expect
    .poll(() => harness.mp3Responses.filter((r) => /\/wrong\.mp3/.test(r.url())).length, {
      timeout: 20_000,
      message: 'expected the "Wrong." clip to be fetched',
    })
    .toBeGreaterThan(0);

  // ...and the rest of the same utterance. A correction that resolves only its
  // first word does not exist: the cascade is all-or-nothing, so reaching the
  // clip at all means every sentence in it resolved.
  const live = await liveSpeech(page);
  expect(
    live.filter((l) => l.startsWith('Wrong.')),
    `expected the correction to play from clips, not live TTS, got ${JSON.stringify(live)}`,
  ).toEqual([]);

  for (const res of harness.mp3Responses) expectServedOk(res);
  expect(harness.pageErrors, `expected zero page errors, got ${JSON.stringify(harness.pageErrors)}`).toEqual([]);
});

/* ------------------------------------------------------------------------ */
/* The steering wheel: the only control that works with the mic off          */
/* ------------------------------------------------------------------------ */

/**
 * Captures the Media Session handlers the app registers, so a test can press a
 * button the way a car does.
 *
 * This is the closest a browser can get to the real thing: Playwright cannot
 * make a head unit send `nexttrack`, but the handler the car would invoke is
 * the same function, reached through the same registration. Everything below
 * the capture -- registration timing, the routing in wheelCommands, the drill's
 * own `yes` -- is the real code.
 */
async function captureWheelButtons(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __wheel: Record<string, () => void> };
    w.__wheel = {};
    const ms = (navigator as unknown as { mediaSession?: { setActionHandler: (a: string, h: () => void) => void } })
      .mediaSession;
    if (!ms) return;
    const original = ms.setActionHandler.bind(ms);
    ms.setActionHandler = (action: string, handler: () => void) => {
      w.__wheel[action] = handler;
      try {
        original(action, handler);
      } catch {
        /* a browser may refuse an individual action; the app handles that */
      }
    };
  });
}

function pressWheel(page: Page, action: string): Promise<boolean> {
  return page.evaluate((a) => {
    const w = window as unknown as { __wheel: Record<string, () => void> };
    const handler = w.__wheel?.[a];
    if (!handler) return false;
    handler();
    return true;
  }, action);
}

test('the wheel runs the count drill with the microphone off', async ({ page }) => {
  test.setTimeout(60_000);
  await seedClipDrillSettings(page);
  await withProfile(page, { name: 'Clip Wheel Profile' });
  await captureWheelButtons(page);

  await page.goto('/');
  await startEyesFreeCountDrill(page);

  // Registration happens on the first clip played, not at startup, so the
  // buttons only exist once the drill has spoken -- which is also the only
  // state in which a driver could press one.
  await answerSelfReportIfPresent(page);
  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 20_000 });
  expect(await pressWheel(page, 'nexttrack'), 'expected the app to have claimed skip-forward').toBe(true);

  // "yes" on the result screen asks the next question. No microphone was ever
  // opened here -- which is the entire point, since an open one would have
  // taken the wheel away.
  await expect(page.locator('.drill-result')).toBeHidden({ timeout: 20_000 });

  // ...and skip-back is a repeat, not an advance: it must not start anything.
  await answerSelfReportIfPresent(page);
  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 20_000 });
  expect(await pressWheel(page, 'previoustrack')).toBe(true);
  await page.waitForTimeout(1000);
  await expect(page.locator('.drill-result')).toBeVisible();
});

/**
 * The loop from the 2026-09-11 drive, at the level the car actually caused it.
 *
 * A head unit sends `play` by itself whenever it thinks playback stopped, which
 * is every time a clip ends. While `play` meant "repeat", that spoke a clip,
 * which ended, which brought another `play`.
 */
test('play, which the car sends on its own, does not start or repeat anything', async ({ page }) => {
  test.setTimeout(60_000);
  await seedClipDrillSettings(page);
  await withProfile(page, { name: 'Clip Play Loop Profile' });
  await captureWheelButtons(page);

  await page.goto('/');
  await startEyesFreeCountDrill(page);
  await answerSelfReportIfPresent(page);
  await expect(page.locator('.drill-result')).toBeVisible({ timeout: 20_000 });

  const harness = attachClipHarness(page);

  // Wait for the result utterance to finish before measuring: its own clips are
  // still arriving when the result screen appears, and counting those would
  // blame the car for the app's own speech.
  let settled = -1;
  while (settled !== harness.mp3Responses.length) {
    settled = harness.mp3Responses.length;
    await page.waitForTimeout(1000);
  }

  for (let i = 0; i < 5; i += 1) {
    expect(await pressWheel(page, 'play')).toBe(true);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(1500);

  // Nothing said, and nothing started.
  expect(
    harness.mp3Responses.slice(settled).map((r) => r.url()),
    'expected five unattended resumes to speak nothing at all',
  ).toEqual([]);
  await expect(page.locator('.drill-result')).toBeVisible();
});
