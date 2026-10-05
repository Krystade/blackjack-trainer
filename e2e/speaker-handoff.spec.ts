import { test, expect, type Page } from '@playwright/test';
import { withSettings, withProfile } from './helpers';

/**
 * Taking the microphone down so the sound comes out of the loud speaker.
 *
 * THE PROBLEM. On iOS, opening the microphone moves all output to the earpiece
 * at the top of the phone, and in a moving car that is inaudible. It is
 * WebKit bug 218012, open since 2020: Safari sets the audio session to allow
 * Bluetooth and mix with others when capture starts, and never
 * `defaultToSpeaker`. Chrome and Firefox on iOS are the same engine, which
 * Jack confirmed from the road, so there is no browser to switch to.
 *
 * WHAT DID NOT WORK. `navigator.audioSession.type = 'playback'` exists and the
 * app sets it, and the 2026-10-04 drive proved it is not enough:
 *
 *   route audio-session was=auto wanted=playback got=playback ok=true
 *   route session-at-mic-open  type=playback
 *   route session-at-mic-close type=playback
 *
 * -- the declared category held all the way through, and the sound was on the
 * earpiece anyway. The category a PAGE DECLARES and the category the session
 * is IN are different things once something is capturing.
 *
 * WHAT THIS TESTS. The only workaround reported to work is an ORDER, not a
 * flag: stop capturing, THEN declare playback, THEN make the sound. "Switch"
 * mode used to flip the declared label and leave the recogniser running, so
 * the session never left record mode -- it could not have worked, and the log
 * shows it did not.
 *
 * THE CASE THAT MATTERS MOST IS THE CHIME. Reopening the recogniser costs
 * about 1.2 seconds (`confirmedInMs=1233` on the drive). Paying that for a
 * 120ms beep would make the microphone useless, so a chime must NOT trigger
 * the handoff -- and a fix that closed the mic on every sound would pass every
 * other test here.
 */

const KEY = 'bjtrainer.diagnostics.v1';

async function withCountingEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__micLog = [] as string[];
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      lang = '';
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error?: string }) => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      constructor() {
        (window as unknown as { __rec: FakeRecognition }).__rec = this;
      }
      start(): void {
        (w.__micLog as string[]).push('start');
        setTimeout(() => this.onstart?.(), 0);
      }
      stop(): void {
        (w.__micLog as string[]).push('stop');
        setTimeout(() => this.onend?.(), 0);
      }
      abort(): void {
        (w.__micLog as string[]).push('abort');
        this.onend?.();
      }
    }
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });
}

async function micLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __micLog?: string[] }).__micLog ?? []);
}

async function handoffs(page: Page): Promise<string[]> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { entries?: Record<string, unknown>[] };
    const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
    return entries
      .filter((e) => e.event === 'handoff')
      .map((e) => String((e.detail as Record<string, unknown>).to ?? ''));
  } catch {
    return [];
  }
}

async function handoffDetails(page: Page): Promise<Record<string, unknown>[]> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { entries?: Record<string, unknown>[] };
    const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
    return entries
      .filter((e) => e.event === 'handoff')
      .map((e) => e.detail as Record<string, unknown>);
  } catch {
    return [];
  }
}

async function chimesHeard(page: Page): Promise<string[]> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { entries?: Record<string, unknown>[] };
    const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
    return (
      entries
        .filter((e) => e.event === 'chime')
        .map((e) => String((e.detail as Record<string, unknown>).kind ?? ''))
        // `ready` is the one chime that deliberately does not deafen the
        // microphone at all (see speech.ts), so it is not evidence here.
        .filter((kind) => kind !== 'ready')
    );
  } catch {
    return [];
  }
}

async function say(page: Page, transcript: string): Promise<void> {
  await page.evaluate((text) => {
    const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
    rec?.onresult?.({ results: [[{ transcript: text }]] });
  }, transcript);
}

async function spoken(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);
}

async function listenInCountDrill(page: Page, outputRoute: string): Promise<void> {
  await withCountingEngine(page);
  await withProfile(page);
  await withSettings(page, {
    audio: { enabled: true, verbosity: 'full', answerPauseMs: 0, outputRoute },
    drill: { countIntervalMs: 0, countManual: false, countLengthCards: 6 },
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Count drill', exact: true }).click();
  await page.locator('label', { hasText: 'Eyes-free audio' }).locator('input').check();
  await page.locator('label', { hasText: 'Voice answers' }).locator('input').check();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
}

test('on Switch, the app closes the microphone before it speaks and reopens it after', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await listenInCountDrill(page, 'switch');

  // Wait for the app to actually say something -- the handoff hangs off a
  // spoken line, so without one there is nothing to observe.
  await expect.poll(async () => (await spoken(page)).length, { timeout: 30_000 }).toBeGreaterThan(0);

  await expect
    .poll(async () => (await handoffs(page)).join(','), { timeout: 30_000, intervals: [250] })
    .toContain('speaker');

  // And the recogniser really went down, rather than the app merely logging
  // that it had. This is the line the whole fix is: an earlier build flipped
  // the declared audio-session label and left capture running, which is why
  // the drive log showed playback throughout and the earpiece anyway.
  const log = await micLog(page);
  expect(log).toContain('start');
  expect(log.filter((e) => e === 'stop' || e === 'abort').length).toBeGreaterThan(0);

  // Then it comes back, or the drill is deaf from the first prompt onward.
  await expect
    .poll(async () => (await handoffs(page)).join(','), { timeout: 30_000, intervals: [250] })
    .toContain('microphone');
  await expect
    .poll(async () => (await micLog(page)).filter((e) => e === 'start').length, {
      timeout: 30_000,
      intervals: [250],
    })
    .toBeGreaterThan(1);
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
});

test('on Speaker, nothing touches the microphone', async ({ page }) => {
  test.setTimeout(90_000);
  await listenInCountDrill(page, 'playback');
  await expect.poll(async () => (await spoken(page)).length, { timeout: 30_000 }).toBeGreaterThan(0);

  // The default. It declares the category and accepts the earpiece rather than
  // paying 1.2 seconds of deafness per line, so there must be no handoff at
  // all -- and that is a real setting Jack may be driving on.
  await page.waitForTimeout(2000);
  expect(await handoffs(page)).toEqual([]);
});

test('on Auto, nothing touches the microphone either', async ({ page }) => {
  test.setTimeout(90_000);
  await listenInCountDrill(page, 'auto');
  await expect.poll(async () => (await spoken(page)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(2000);
  expect(await handoffs(page)).toEqual([]);
});

test('every handoff was paid for by WORDS, never by a chime', async ({ page }) => {
  test.setTimeout(90_000);
  /*
   * THE DISCRIMINATING CASE. A chime is 120ms of tone; reopening the
   * recogniser costs about 1.2 seconds (`confirmedInMs=1233` on the drive).
   * Paying that for a beep would make the microphone useless, and a fix that
   * closed it for every sound would pass every other test in this file.
   *
   * Counting handoffs cannot show this -- the app speaks on its own schedule,
   * so a count that grew during the test proves nothing about what caused it.
   * What is checkable is the CAUSE: `beginSpeechHandoff` is given words or
   * nothing, and the log carries what it was given. A chime-triggered handoff
   * would appear here with no `said`.
   */
  await listenInCountDrill(page, 'switch');
  await expect.poll(async () => (await spoken(page)).length, { timeout: 30_000 }).toBeGreaterThan(0);

  /*
   * MAKE A CHIME HAPPEN, and prove it did.
   *
   * The first version of this test waited four seconds and hoped. No chime
   * fired in that window, so it asserted nothing: making a chime close the
   * microphone left it green. Feeding the recogniser a word that is not in the
   * vocabulary cues the "I did not understand you" tone, which is a real chime
   * on the real path, and the log records every one.
   */
  await expect
    .poll(
      async () => {
        await say(page, 'wibble');
        return (await chimesHeard(page)).length;
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  const claims = await handoffDetails(page);
  const toSpeaker = claims.filter((c) => c.to === 'speaker');
  expect(toSpeaker.length, 'nothing handed the speaker over, so nothing was tested').toBeGreaterThan(
    0,
  );
  const wordless = toSpeaker.filter(
    (c) => typeof c.said !== 'string' || c.said.trim() === '',
  );
  expect(wordless, 'a sound with no words took the microphone down').toEqual([]);
});

test('the microphone always comes back, and says why', async ({ page }) => {
  test.setTimeout(90_000);
  // Every close is a debt. An unpaid one leaves the drill deaf for the rest of
  // the session, which sounds exactly like the app being broken -- and this
  // caught precisely that: the first version of the fix closed the microphone
  // and never reopened it.
  await listenInCountDrill(page, 'switch');
  await expect.poll(async () => (await spoken(page)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  // Wait for a close to have been PAID, not merely made: the bug this caught
  // produced closes forever and not one open.
  await expect
    .poll(async () => (await handoffs(page)).filter((t) => t === 'microphone').length, {
      timeout: 30_000,
      intervals: [250],
    })
    .toBeGreaterThan(0);
  await page.waitForTimeout(3000);

  const claims = await handoffDetails(page);
  const opens = claims.filter((c) => c.to === 'microphone');
  const closes = claims.filter((c) => c.to === 'speaker');
  // At most one outstanding: the one for the line being spoken right now.
  expect(closes.length - opens.length).toBeLessThanOrEqual(1);
  // And it says which trigger paid it, so a drive log can show whether the
  // backstop is carrying the feature or merely standing behind it.
  for (const o of opens) {
    expect(['speech-ended', 'deadline']).toContain(String(o.why));
  }
  /*
   * THE PRIMARY PATH MUST BE THE ONE DOING IT.
   *
   * There are two triggers and either one alone is enough, which is the
   * point -- but it also means a broken ending would be invisible: the
   * backstop would quietly cover for it and every assertion above would still
   * pass, while on the phone every spoken line cost an extra two seconds of
   * deafness. So the ending has to be seen working.
   */
  expect(
    opens.map((o) => String(o.why)),
    'the deadline backstop is carrying this, so the real ending is broken',
  ).toContain('speech-ended');
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
});
