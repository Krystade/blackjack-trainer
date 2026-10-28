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
      constructor() {
        (window as unknown as { __rec: FakeRecognition }).__rec = this;
      }
      start(): void {
        setTimeout(() => {
          this.onstart?.();
          this.onaudiostart?.();
        }, 0);
      }
      stop(): void {
        this.onerror?.({ error: 'aborted' });
        this.onend?.();
      }
      abort(): void {
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
  // Every trial says which plan it ran under.
  const plays = all.filter((e) => e.event === 'kit-route-play').map((e) => `${e.detail?.step}:${e.detail?.strategy}:${e.detail?.hold}`);
  expect(plays).toEqual([
    'auto-webaudio:web-audio:none',
    'pr-webaudio:play-and-record:none',
    'hold-bt:web-audio:bluetooth',
    'hold-phone:web-audio:phone',
    'quiet-close:web-audio:none',
  ]);
  const asked = await page.evaluate(() => (window as unknown as { __asked: string[] }).__asked);
  expect(asked).toContain('mic-car');
  expect(asked).toContain('mic-phone');
});
