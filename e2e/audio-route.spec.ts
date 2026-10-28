import { test, expect, type Page } from '@playwright/test';
import { openSettingsScreen, readStoredDiagnostics, withSettings } from './helpers';

/**
 * Wave U: the Audio route setting, its one-tap test, the plan a voice drill
 * applies, and the Route kits -- answered by voice through a fake engine.
 *
 * The phone is faked where a page can see it and no further: the device list
 * (the labels Jack's phone reported on 2026-10-06), `navigator.audioSession`,
 * and a getUserMedia that records which deviceId it was asked for. Where the
 * sound came out is the one thing no test here can know, which is why every
 * answer is Jack's.
 */
const PHONE = { width: 375, height: 812 };

async function withFakePhone(page: Page, devices: Array<{ kind: string; label: string; deviceId: string }>): Promise<void> {
  await page.addInitScript((list) => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      maxAlternatives = 1;
      lang = '';
      onstart: (() => void) | null = null;
      onaudiostart: (() => void) | null = null;
      onspeechstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error?: string }) => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      live = false;
      constructor() {
        (window as unknown as { __rec: FakeRecognition }).__rec = this;
        ((window as unknown as { __recs?: FakeRecognition[] }).__recs ??= []).push(this);
      }
      start(): void {
        this.live = true;
        ((window as unknown as { __order?: string[] }).__order ??= []).push('start');
        // A test can slow the engine down, to stop or leave mid-open.
        const delay = (window as unknown as { __audioStartDelay?: number }).__audioStartDelay ?? 0;
        setTimeout(() => {
          this.onstart?.();
          this.onaudiostart?.();
        }, delay);
      }
      stop(): void {
        if (this.live) ((window as unknown as { __order?: string[] }).__order ??= []).push('stop');
        this.live = false;
        this.onerror?.({ error: 'aborted' });
        this.onend?.();
      }
      abort(): void {
        if (this.live) ((window as unknown as { __order?: string[] }).__order ??= []).push('stop');
        this.live = false;
        this.onerror?.({ error: 'aborted' });
        this.onend?.();
      }
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;

    const session = { type: 'auto' };
    (w as { __session?: unknown }).__session = session;
    Object.defineProperty(navigator, 'audioSession', { value: session, configurable: true });
    const asked: string[] = [];
    (w as { __asked?: unknown }).__asked = asked;
    const md = navigator.mediaDevices as unknown as Record<string, unknown>;
    md.enumerateDevices = async () => list;
    md.getUserMedia = async (c: { audio?: { deviceId?: { exact?: string } } | boolean }) => {
      const id = typeof c.audio === 'object' ? (c.audio.deviceId?.exact ?? 'default') : 'default';
      asked.push(id);
      ((w as { __order?: string[] }).__order ??= []).push(`gum:${id}`);
      const label = list.find((d) => d.deviceId === id)?.label ?? 'iPhone Microphone';
      const stops = ((w as { __stops?: string[] }).__stops ??= []);
      const live = ((w as { __live?: Record<string, number> }).__live ??= {});
      live[id] = (live[id] ?? 0) + 1;
      let ended = false;
      const track = {
        kind: 'audio',
        label,
        readyState: 'live',
        muted: false,
        addEventListener() {},
        stop() {
          if (ended) return;
          ended = true;
          track.readyState = 'ended';
          stops.push(id);
          live[id] -= 1;
        },
        getSettings: () => ({ deviceId: id, sampleRate: 8000 }),
      };
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    };
  }, devices);
}

const CAR = [
  { kind: 'audioinput', label: 'TOYOTA Corolla', deviceId: 'mic-car' },
  { kind: 'audioinput', label: 'iPhone Microphone', deviceId: 'mic-phone' },
];

/** Recognisers started and never stopped: an open microphone nobody may own. */
async function liveRecognisers(page: Page): Promise<number> {
  return page.evaluate(() => ((window as unknown as { __recs?: Array<{ live: boolean }> }).__recs ?? []).filter((r) => r.live).length);
}

async function slowEngine(page: Page, ms: number): Promise<void> {
  await page.addInitScript((d) => {
    (window as unknown as { __audioStartDelay: number }).__audioStartDelay = d;
  }, ms);
}

/**
 * What ran just before the held input's getUserMedia: 'start' when the
 * recogniser was started first (the drill's order), 'stop' when the hold was
 * taken with the recogniser closed.
 */
async function beforeHold(page: Page, id: string): Promise<string | undefined> {
  return page.evaluate((d) => {
    const order = (window as unknown as { __order?: string[] }).__order ?? [];
    const at = order.indexOf(`gum:${d}`);
    return at > 0 ? order[at - 1] : undefined;
  }, id);
}

/** Say something into the fake engine as a FINAL result, the way openMic reads it. */
async function say(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
    const result = Object.assign([{ transcript: t, confidence: 0.9 }], { isFinal: true });
    rec?.onresult?.({ resultIndex: 0, results: [result] });
  }, text);
}

/** Keep answering until `done` shows: the answer window opens only after the question has played. */
async function answerByVoice(page: Page, text: string, done: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await say(page, text);
    if (await done()) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`"${text}" was never taken as an answer`);
}

async function events(page: Page): Promise<Array<{ event: string; detail?: Record<string, unknown> }>> {
  const raw = await readStoredDiagnostics(page);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { entries?: unknown[] } | unknown[];
  const list = (Array.isArray(parsed) ? parsed : (parsed.entries ?? [])) as Array<{ event: string; detail?: Record<string, unknown> }>;
  return list;
}

async function openInTheCar(page: Page): Promise<void> {
  await openSettingsScreen(page);
  // ?e2e=1 opens every Settings section (CollapsibleSection), so no click.
  await expect(page.getByTestId('audio-route')).toBeVisible();
}

test('Settings names the connected car, and the route choice changes the plan', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await withFakePhone(page, CAR);
  await page.goto('/?e2e=1');
  await openInTheCar(page);

  const detected = page.getByTestId('audio-route-detected');
  await expect(detected).toContainText('Car — TOYOTA Corolla.');
  await expect(detected).toContainText('Plays through: Web Audio');
  await expect(page.getByTestId('audio-route-evidence')).toHaveText('a drive decides');

  await page.getByRole('group', { name: 'Audio route' }).getByRole('button', { name: 'Bluetooth' }).click();
  await expect(detected).toContainText('listening on TOYOTA Corolla');

  await page.locator('.audio-route-strategy > summary').click();
  await page.getByRole('radio', { name: /Declare play and record/ }).check();
  await expect(detected).toContainText('Plays through: Declare play and record');

  // Saved: a reload keeps both choices.
  await page.reload();
  await openInTheCar(page);
  await expect(page.getByRole('group', { name: 'Audio route' }).getByRole('button', { name: 'Bluetooth' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('audio-route-detected')).toContainText('Plays through: Declare play and record');
});

test('With no Bluetooth the phone route is the measured one', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await withFakePhone(page, [{ kind: 'audioinput', label: 'iPhone Microphone', deviceId: 'mic-phone' }]);
  await page.goto('/?e2e=1');
  await openInTheCar(page);
  await expect(page.getByTestId('audio-route-detected')).toContainText('Phone only');
  await expect(page.getByTestId('audio-route-evidence')).toHaveText('measured');
});

test('Test this route plays with the mic on and takes the answer by voice', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize(PHONE);
  await withFakePhone(page, CAR);
  await withSettings(page, { audio: { audioRoute: 'bluetooth' } });
  await page.goto('/?e2e=1');
  await openInTheCar(page);

  await page.getByTestId('audio-route-test').click();
  await expect(page.getByTestId('audio-route-ask')).toBeVisible({ timeout: 15_000 });
  // "phone, no, car" -- a change of mind, the last answer wins.
  const result = page.getByTestId('audio-route-result');
  await answerByVoice(page, 'phone, no, car', () => result.isVisible());
  await expect(result).toContainText('Car speakers');
  await expect(result).toContainText('as it should be');

  // The held input was the car's, by its exact id.
  expect(await page.evaluate(() => (window as unknown as { __asked: string[] }).__asked)).toContain('mic-car');
  await expect
    .poll(async () => (await events(page)).find((e) => e.event === 'route-test')?.detail, { timeout: 5_000 })
    .toMatchObject({ answer: 'Car speakers', via: 'voice', expected: 'Car speakers', ok: true, hold: 'bluetooth' });
});

test('Test this route ends its plan: the held mic is stopped and the declaration undone (review H1)', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize(PHONE);
  await withFakePhone(page, CAR);
  await withSettings(page, { audio: { audioRoute: 'bluetooth', routeStrategy: 'play-and-record' } });
  await page.goto('/?e2e=1');
  await openInTheCar(page);
  await page.getByTestId('audio-route-test').click();
  await expect(page.getByTestId('audio-route-ask')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('audio-route-ask').getByRole('button', { name: 'Car speakers' }).click();
  await expect(page.getByTestId('audio-route-result')).toBeVisible();
  const live = () => page.evaluate(() => (window as unknown as { __live?: Record<string, number> }).__live?.['mic-car'] ?? 0);
  await expect.poll(live).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __stops: string[] }).__stops)).toContain('mic-car');
  expect(await page.evaluate(() => (window as unknown as { __session: { type: string } }).__session.type)).toBe('auto');
});

test('Leaving Settings while Test this route opens the mic leaves no microphone open (review H2)', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize(PHONE);
  await withFakePhone(page, CAR);
  await slowEngine(page, 2500);
  await page.goto('/?e2e=1');
  await openInTheCar(page);
  await page.getByTestId('audio-route-test').click();
  await page.waitForTimeout(500);
  await page.locator('.tab-bar').getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByTestId('audio-route')).toHaveCount(0);
  // Past the engine's slow start, the trial's settle wait and its play.
  await page.waitForTimeout(8000);
  expect(await liveRecognisers(page)).toBe(0);
});

test('A tapped answer that misses the route says what was expected', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize(PHONE);
  await withFakePhone(page, CAR);
  await page.goto('/?e2e=1');
  await openInTheCar(page);
  await page.getByTestId('audio-route-test').click();
  await expect(page.getByTestId('audio-route-ask')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('audio-route-ask').getByRole('button', { name: 'Earpiece' }).click();
  await expect(page.getByTestId('audio-route-result')).toContainText('Earpiece (tapped) — expected Car speakers. Logged.');
});

test('A voice drill applies the route plan while voice is on and undoes it after', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize(PHONE);
  await withFakePhone(page, CAR);
  await withSettings(page, { audio: { audioRoute: 'bluetooth', routeStrategy: 'play-and-record' } });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');

  const sessionType = () => page.evaluate(() => (window as unknown as { __session: { type: string } }).__session.type);
  expect(await sessionType()).toBe('play-and-record');
  await expect
    .poll(async () => (await events(page)).find((e) => e.event === 'route-plan')?.detail, { timeout: 5_000 })
    .toMatchObject({ reason: 'voice-on', strategy: 'play-and-record', hold: 'bluetooth' });
  await expect
    .poll(async () => (await events(page)).find((e) => e.event === 'route-hold')?.detail, { timeout: 5_000 })
    .toMatchObject({ which: 'bluetooth', state: 'held', got: 'TOYOTA Corolla' });
  // The drill starts the recogniser, then the hold lands (review M2).
  expect(await beforeHold(page, 'mic-car')).toBe('start');

  await page.getByRole('checkbox', { name: 'Voice answers' }).uncheck();
  await expect.poll(sessionType).toBe('auto');
});

test('Auto changes nothing a drill did before', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await withFakePhone(page, CAR);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __session: { type: string } }).__session.type)).toBe('auto');
  expect(await page.evaluate(() => (window as unknown as { __asked: string[] }).__asked)).not.toContain('mic-car');
});

test('Stop during a Route kit trial closes the mic, and the abandoned step neither asks nor saves (review H2)', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize(PHONE);
  await withFakePhone(page, CAR);
  await slowEngine(page, 2500);
  await page.goto('/?e2e=1');
  await page.getByTestId('testkit-open').click();
  await page.getByRole('button', { name: /Route: car Bluetooth/ }).click();
  const kit = page.getByTestId('testkit-screen');
  await kit.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('routekit-snapshot')).toBeVisible();
  await kit.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('[data-step="auto-webaudio"]')).toBeVisible();
  await page.waitForTimeout(500);
  await kit.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.waitForTimeout(8000);
  // Still on the kit menu (the screen is mounted), and no engine is live.
  await expect(page.getByTestId('testkit-screen')).toBeVisible();
  expect(await liveRecognisers(page)).toBe(0);
  // An answer spoken now goes nowhere: no answer logged, no progress saved.
  await say(page, 'car');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => localStorage.getItem('bjtrainer.testkit.progress.v1'))).toBeNull();
  const all = await events(page);
  const stoppedAt = all.findIndex((e) => e.event === 'kit-abandoned');
  expect(stoppedAt).toBeGreaterThan(-1);
  expect(all.slice(stoppedAt).filter((e) => e.event === 'kit-answer' || e.event === 'kit-route-play')).toEqual([]);
});

test('A step answered before its line plays takes its trial with it (review M3)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize(PHONE);
  await withFakePhone(page, CAR);
  await page.goto('/?e2e=1');
  await page.getByTestId('testkit-open').click();
  await page.getByRole('button', { name: /Route: car Bluetooth/ }).click();
  const kit = page.getByTestId('testkit-screen');
  await kit.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('routekit-snapshot')).toBeVisible();
  await kit.getByRole('button', { name: 'Next', exact: true }).click();
  // "Heard nothing" tapped the moment each of the first two steps shows,
  // inside the trial's settle wait, before its line has played.
  for (const id of ['auto-webaudio', 'pr-webaudio']) {
    await expect(page.locator(`[data-step="${id}"]`)).toBeVisible();
    await kit.getByRole('button', { name: 'Heard nothing' }).click();
  }
  // The third step runs to its question; answered by voice as normal.
  await expect(page.locator('[data-step="hold-bt"]')).toBeVisible();
  await answerByVoice(page, 'car', () => page.locator('[data-step="hold-phone"]').isVisible());
  const plays = (await events(page))
    .filter((e) => e.event === 'kit-route-play' && e.detail?.step !== 'hold-phone')
    .map((e) => `${e.detail?.step}:${e.detail?.session}:${e.detail?.applied}:${e.detail?.appliedHold}`);
  // No line from an answered step played later, under the next step's plan.
  expect(plays).toEqual(['hold-bt:auto:web-audio:bluetooth']);
});

test('The car Route kit runs every step by voice and logs one summary line', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(PHONE);
  await withFakePhone(page, CAR);
  await page.goto('/?e2e=1');
  await page.getByTestId('testkit-open').click();
  await page.getByRole('button', { name: /Route: car Bluetooth/ }).click();
  const kit = page.getByTestId('testkit-screen');

  await expect(page.locator('[data-step="snapshot"]')).toBeVisible();
  await kit.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('routekit-snapshot')).toContainText('TOYOTA Corolla, iPhone Microphone');
  await kit.getByRole('button', { name: 'Next', exact: true }).click();

  // Each step runs on its own; the answer is spoken. The car answers the
  // first two, the earpiece the rest, so the summary must count 2 hits.
  const steps = ['auto-webaudio', 'pr-webaudio', 'hold-bt', 'hold-phone', 'quiet-close'];
  for (const [i, id] of steps.entries()) {
    await expect(page.locator(`[data-step="${id}"]`)).toBeVisible({ timeout: 15_000 });
    const next = steps[i + 1];
    const words = i < 2 ? 'car' : 'earpiece';
    await answerByVoice(page, words, async () =>
      next ? page.locator(`[data-step="${next}"]`).isVisible() : page.locator(`[data-step="${id}"]`).isHidden(),
    );
  }

  await expect
    .poll(async () => (await events(page)).find((e) => e.event === 'kit-route-summary')?.detail, { timeout: 5_000 })
    .toMatchObject({
      kit: 'route-car',
      hits: 2,
      answered: 5,
      byVoice: 5,
      byStep:
        'auto-webaudio=Car speakers pr-webaudio=Car speakers hold-bt=Earpiece hold-phone=Earpiece quiet-close=Earpiece',
    });
  const all = await events(page);
  // Every trial played under the plan the AUDIO LAYER had in force (session
  // type from the faked navigator.audioSession, plan from activeRoutePlan),
  // not the step's own data. Quiet-close plays with the plan ended.
  const plays = all
    .filter((e) => e.event === 'kit-route-play')
    .map((e) => `${e.detail?.step}:${e.detail?.session}:${e.detail?.applied}:${e.detail?.appliedHold}`);
  expect(plays).toEqual([
    'auto-webaudio:auto:web-audio:none',
    'pr-webaudio:play-and-record:play-and-record:none',
    'hold-bt:auto:web-audio:bluetooth',
    'hold-phone:auto:web-audio:phone',
    'quiet-close:auto:none:none',
  ]);
  const asked = await page.evaluate(() => (window as unknown as { __asked: string[] }).__asked);
  expect(asked).toContain('mic-car');
  expect(asked).toContain('mic-phone');
  // The kit measures the drill's order: recogniser first, then the hold (M2).
  expect(await beforeHold(page, 'mic-car')).toBe('start');
  expect(await beforeHold(page, 'mic-phone')).toBe('start');
  // And says whether the held track was still live as the line played.
  const holdPlays = all
    .filter((e) => e.event === 'kit-route-play' && String(e.detail?.step).startsWith('hold-'))
    .map((e) => `${e.detail?.step}:${e.detail?.holdState}:${e.detail?.holdGot}:${e.detail?.holdReadyState}`);
  expect(holdPlays).toEqual(['hold-bt:held:TOYOTA Corolla:live', 'hold-phone:held:iPhone Microphone:live']);
});
