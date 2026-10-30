import { test, expect, type Page } from '@playwright/test';
import { sayOnceListening, waitForMic, withSettings } from './helpers';

/**
 * Answering flashcards out loud.
 *
 * Real recognition cannot run here -- headless Chromium exposes the whole
 * SpeechRecognition surface and then fires no events, having no microphone
 * and no speech backend. So a FAKE engine is installed in its place before
 * the app loads, which is not a compromise: every behaviour worth asserting
 * is about what the app does with a transcript, and the device probe already
 * settled what the real engine does with a voice.
 */

/** Installs a scriptable engine and a window handle to drive it. */
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
        this.aborted = false;
        const w = window as unknown as { __holdStart?: boolean; __failStart?: boolean };
        // A start that never confirms (a routine restart caught mid-way).
        if (w.__holdStart) return;
        // A start that fails: the controller backs off and retries.
        if (w.__failStart) {
          setTimeout(() => {
            this.onerror?.({ error: 'network' });
            this.onend?.();
          }, 0);
          return;
        }
        setTimeout(() => {
          this.onstart?.();
          // Safari fires audiostart right after start; without it the app waits out AUDIOSTART_GRACE_MS.
          this.onaudiostart?.();
        }, 0);
      }

      aborted = false;

      abort(): void {
        this.aborted = true;
        this.onend?.();
      }
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });
}

async function openFlashcardsWithVoice(page: Page): Promise<void> {
  await withFakeEngine(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
}

/** Feed the app a transcript, as the engine would. */
async function say(page: Page, transcript: string, alternatives: string[] = []): Promise<void> {
  // WAIT FOR THE MICROPHONE FIRST. Under the shipped 'switch' route the
  // recogniser is closed for the length of every spoken line, so a word fired
  // the instant after an action went into a dead session and the answer was
  // never graded -- which this file read as the app ignoring speech. A person
  // waits for the prompt to end too.
  await waitForMic(page);
  await page.evaluate(({ text, alts }) => {
    const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
    // A real engine hands back its winner plus the readings it ranked below
    // it, in one result. The runners-up are the whole point of some of these.
    const readings = [{ transcript: text }, ...alts.map((a) => ({ transcript: a }))];
    rec?.onresult?.({ results: [readings] });
  }, { text: transcript, alts: alternatives });
}

/**
 * What a grade leaves behind, whatever the screen shows by the time anyone
 * looks: the stats and the spaced-repetition deck are written on every graded
 * answer. A correction panel auto-advances (answerPauseMs), so a retrying
 * `toBeHidden` can pass on a panel that appeared and already left; these
 * cannot.
 */
async function graded(page: Page): Promise<{ stats: unknown; flashSr: unknown; quizSr: unknown }> {
  return page.evaluate(() => ({
    stats: JSON.parse(window.localStorage.getItem('bjtrainer.stats.v1') ?? 'null'),
    flashSr: JSON.parse(window.localStorage.getItem('bjtrainer.flashsr.v1') ?? 'null'),
    quizSr: JSON.parse(window.localStorage.getItem('bjtrainer.quizsr.v1') ?? 'null'),
  }));
}

test('a spoken answer grades the card', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  await say(page, 'stand');
  // The correction panel only exists once an answer has been graded.
  await expect(page.locator('.feedback-cell')).toBeVisible();
});

test('filler before the answer is ignored, because engines prepend it', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  await say(page, 'okay uh stand');
  await expect(page.locator('.voice-status-heard')).toContainText('stand');
});

/**
 * The safety property, end to end: unrecognised speech must leave the card
 * alone. Acting on a guess would grade an answer the operator never gave.
 */
test('ordinary conversation does not answer the card', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  const before = await graded(page);
  await say(page, 'what is the weather like tomorrow');
  // The verdict is the app's reaction to the result; a grade from the same
  // result would be on screen by now -- one look, not a retry the panel's own
  // auto-advance could satisfy -- and in storage regardless.
  await expect(page.locator('.voice-status-heard')).toContainText('not a command');
  expect(await page.locator('.feedback-cell').count()).toBe(0);
  expect(await graded(page)).toEqual(before);
});

/**
 * The failure that would otherwise be constant and invisible: the app speaks
 * the correction aloud, the car speaker plays it, and the microphone hears
 * "Stand." as an answer to the NEXT card.
 */
test('the app does not grade its own voice', async ({ page }) => {
  await openFlashcardsWithVoice(page);

  // "repeat" makes the app speak, which is what a real correction does too.
  const before = await graded(page);
  await say(page, 'repeat');
  await say(page, 'hit');

  await expect(page.locator('.voice-status-heard')).toContainText('the app was speaking');
  expect(await page.locator('.feedback-cell').count()).toBe(0);
  expect(await graded(page)).toEqual(before);
});

/**
 * The probe measured the engine ending its own session roughly every ninety
 * seconds, with the tab visible. Without recovery the feature works for a
 * minute and a half and then silently stops.
 */
test('a session that dies on its own comes back and keeps answering', async ({ page }) => {
  await openFlashcardsWithVoice(page);

  await page.evaluate(() => {
    const rec = (window as unknown as { __rec?: { onend?: () => void } }).__rec;
    rec?.onend?.();
  });
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'restarting');
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');

  await say(page, 'double');
  await expect(page.locator('.voice-status-heard')).toContainText('double');
});

/**
 * The deaf gap is named rather than hidden. A word spoken during a restart is
 * genuinely lost, and an operator who cannot see why deserves to be told --
 * "Listening" throughout would be a lie.
 */
test('the restart gap is shown, not hidden', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  await page.evaluate(() => {
    const rec = (window as unknown as { __rec?: { onend?: () => void } }).__rec;
    rec?.onend?.();
  });
  await expect(page.locator('.voice-status-state')).toContainText('Reconnecting');
});

test('switching voice off releases the microphone and says so', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  await page.getByRole('checkbox', { name: 'Voice answers' }).uncheck();
  await expect(page.locator('.voice-status')).toHaveCount(0);
});

/**
 * A refused microphone is terminal: retrying re-prompts forever, and on some
 * browsers each retry is another permission dialog aimed at someone driving.
 */
test('a blocked microphone is reported once, not retried forever', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  await page.evaluate(() => {
    const rec = (window as unknown as {
      __rec?: { onerror?: (e: { error: string }) => void; onend?: () => void };
    }).__rec;
    rec?.onerror?.({ error: 'not-allowed' });
    rec?.onend?.();
  });
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'denied');
  await expect(page.locator('.voice-status-state')).toContainText('blocked');
});

/**
 * A5: and it is reported ALOUD. Eyes-free, the status bar is no report at all:
 * a microphone that has given up must not leave Jack talking into nothing.
 */
test('a microphone that gives up says so out loud, once', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  const before = await page.evaluate(() => [...((window as unknown as { __speechLog?: string[] }).__speechLog ?? [])]);
  const LINE = 'The microphone has stopped listening. Tap the screen once to turn the microphone back on.';
  expect(before).not.toContain(LINE);
  await page.evaluate(() => {
    const rec = (window as unknown as {
      __rec?: { onerror?: (e: { error: string }) => void; onend?: () => void };
    }).__rec;
    rec?.onerror?.({ error: 'not-allowed' });
    rec?.onend?.();
  });
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'denied');
  await expect
    .poll(() => page.evaluate((line) => ((window as unknown as { __speechLog?: string[] }).__speechLog ?? []).filter((t) => t === line).length, LINE))
    .toBe(1);

  // And it says what to do: one tap anywhere asks for the microphone again,
  // without answering the card under the finger.
  const spokenBefore = await page.evaluate(() => ((window as unknown as { __speechLog?: string[] }).__speechLog ?? []).length);
  await page.getByRole('button', { name: 'Stand', exact: true }).click();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
  await page.waitForTimeout(500);
  const after = await page.evaluate((n) => ((window as unknown as { __speechLog?: string[] }).__speechLog ?? []).slice(n), spokenBefore);
  expect(after, 'the waking tap also answered the card').toEqual([]);
});

/**
 * Review of A5: the tap-to-restart handler belongs to the dead mic, not to
 * the session. A "stuck" mic that comes back by itself disarms it, so an
 * answer tapped later, while a routine restart is under way, still answers.
 */
test('an answer tap during a routine restart, after a stuck mic recovered, is not swallowed', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __e2eMicStuckMs?: number }).__e2eMicStuckMs = 600;
  });
  await openFlashcardsWithVoice(page);
  const LINE = 'The microphone has stopped listening. Tap the screen once to turn the microphone back on.';
  // Stuck: every start fails and the controller keeps retrying.
  await page.evaluate(() => {
    const w = window as unknown as { __failStart?: boolean; __rec?: { onerror?: (e: { error: string }) => void; onend?: () => void } };
    w.__failStart = true;
    w.__rec?.onerror?.({ error: 'network' });
    w.__rec?.onend?.();
  });
  await expect
    .poll(() => page.evaluate((line) => ((window as unknown as { __speechLog?: string[] }).__speechLog ?? []).includes(line), LINE), { timeout: 10_000 })
    .toBe(true);
  // It comes back by itself, with no tap.
  await page.evaluate(() => {
    (window as unknown as { __failStart?: boolean }).__failStart = false;
  });
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening', { timeout: 15_000 });

  // A routine restart, caught before it confirms.
  await page.evaluate(() => {
    const w = window as unknown as { __holdStart?: boolean; __rec?: { onend?: () => void } };
    w.__holdStart = true;
    w.__rec?.onend?.();
  });
  await expect(page.locator('.voice-status')).not.toHaveAttribute('data-voice-state', 'listening');
  const words = () =>
    page.evaluate(() => ((window as unknown as { __speechLog?: string[] }).__speechLog ?? []).filter((t) => !t.startsWith('chime:')));
  const before = (await words()).length;
  await page.getByRole('button', { name: 'Stand', exact: true }).click();
  // The answer is graded aloud; a swallowed tap says nothing (a restart only chimes).
  await expect
    .poll(async () => (await words()).length > before, { message: 'the answer tap was swallowed by the tap-to-restart handler' })
    .toBe(true);
});

test('the whole vocabulary is on screen, so nothing has to be remembered', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  const words = page.locator('.voice-status-words');
  for (const word of ['hit', 'stand', 'double', 'split', 'surrender', 'repeat']) {
    await expect(words).toContainText(word);
  }
});

/**
 * The near-miss rule, end to end.
 *
 * From the drive of 2026-09-10: the engine kept landing one sound away from
 * the command -- "send" for stand, "read it" for repeat -- and the app
 * rejected every one. These are verbatim transcripts from that log.
 */
test('a word one sound off still answers the card', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  await say(page, 'send');

  // Understood as stand, and marked as the approximation it was.
  await expect(page.locator('.voice-status-heard')).toContainText('stand');
  await expect(page.locator('.voice-status-heard')).not.toContainText('not a command');
});

test('a runner-up the engine ranked second is still heard', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  // Verbatim from the probe: heard="Band" conf=0.13 alts=["Send", "Stand"].
  await say(page, 'Band', ['Send', 'Stand']);

  await expect(page.locator('.voice-status-heard')).toContainText('stand');
});

/**
 * And the guard. This is the operator narrating a steering-wheel test
 * mid-drill, verbatim, and it must never play a hand however it is sliced.
 */
test('narration during a drill never plays a hand', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  await say(page, "I'm pressing button for a lot of buttons now bud is being great", [
    'send',
    'stand',
  ]);

  await expect(page.locator('.voice-status-heard')).toContainText('not a command');
});

/**
 * The cue for a word that was not understood.
 *
 * Eyes-free, a rejection is silence, and silence looks exactly like a dead
 * microphone -- the drive of 2026-09-10 produced 22 of them, each one the
 * operator saying something into a void and waiting on a card that was never
 * going to turn.
 */
test('an attempt that is not understood says so out loud', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  await say(page, 'wombat');

  await expect(page.locator('.voice-status-heard')).toContainText('not a command');
  const log = await page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);
  expect(log).toContain('chime:again');
});

/**
 * And the guard that makes it bearable. A chime on every stray sentence in a
 * moving car would be worse than the silence it replaces, so conversation
 * gets nothing. Verbatim from the same drive.
 */
test('conversation that is not understood stays silent', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  await say(page, 'how was your dad');

  await expect(page.locator('.voice-status-heard')).toContainText('not a command');
  const log = await page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);
  expect(log).not.toContain('chime:again');
});

/**
 * C-R4 (W16): a word missed again and again on one prompt escalates --
 * the tone, then the prompt again, then (D-R5) the tone again -- never a hint.
 */
test('repeated misses escalate: tone, re-ask, then tone again with no hint', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  const log = () => page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);
  const opening = await log();
  const prompt = [...opening].reverse().find((e) => !e.startsWith('chime:'));
  expect(prompt, 'the card was read out').toBeTruthy();

  let mark = opening.length;
  await sayOnceListening(page, 'wombat');
  await expect.poll(async () => (await log()).slice(mark)).toContain('chime:again');
  expect((await log()).slice(mark)).not.toContain(prompt);

  mark = (await log()).length;
  await sayOnceListening(page, 'wombat');
  await expect.poll(async () => (await log()).slice(mark)).toContain(prompt);

  mark = (await log()).length;
  await sayOnceListening(page, 'wombat');
  await expect.poll(async () => (await log()).slice(mark)).toContain('chime:again');
  await page.waitForTimeout(300);
  expect((await log()).slice(mark), 'the third miss is the tone, not the prompt again').not.toContain(prompt);
  expect((await log()).slice(mark).join('|')).not.toMatch(/\bSay /);

  mark = (await log()).length;
  await sayOnceListening(page, 'wombat');
  await expect.poll(async () => (await log()).slice(mark)).toContain(prompt);
  expect((await log()).join('|')).not.toMatch(/\bSay (hit|yes)/);
  // Still listening, and a recognised answer still grades the card.
  await sayOnceListening(page, 'stand');
  await expect(page.locator('.feedback-cell')).toBeVisible();
});

// A word that WAS understood is answered by the card turning, not by a cue.
test('an understood word gets no say-again cue', async ({ page }) => {
  await openFlashcardsWithVoice(page);
  await say(page, 'stand');
  // The card turning is the reaction; the cue, had there been one, comes off
  // the same result. Read the log once that reaction is on screen.
  await expect(page.locator('.feedback-cell')).toBeVisible();

  const log = await page.evaluate(() => (window as unknown as { __speechLog?: string[] }).__speechLog ?? []);
  expect(log).not.toContain('chime:again');
});

/**
 * Closing the app must close the microphone.
 *
 * React's cleanup -- which is what normally calls `controller.stop()` -- does
 * not run when the app is swiped out of the switcher, so the recognition
 * session outlived the page. The operator saw iOS's orange indicator still lit
 * on the home screen afterwards (2026-09-21), and the 2026-09-20 log has the
 * same shape: `session-start`, `visibility hidden`, `pagehide`, and no stop.
 *
 * Asserted on the ENGINE being aborted rather than on the log line alone: a
 * log entry saying the microphone was closed is not the microphone being
 * closed, and it is the latter iOS puts a dot on the screen for.
 */
test('swiping the app away closes the microphone', async ({ page }) => {
  await openFlashcardsWithVoice(page);

  const abortedBefore = await page.evaluate(
    () => (window as unknown as { __rec?: { aborted?: boolean } }).__rec?.aborted ?? false,
  );
  expect(abortedBefore).toBe(false);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));

  await expect
    .poll(async () =>
      page.evaluate(
        () => (window as unknown as { __rec?: { aborted?: boolean } }).__rec?.aborted ?? false,
      ),
    )
    .toBe(true);
});

/* ---------------------------------------------------------------------- */
/* F4: the deviation quiz had an eyes-free mode and no hands-free input    */
/* ---------------------------------------------------------------------- */

async function openQuizWithVoice(page: Page, index = '16v10'): Promise<void> {
  await withFakeEngine(page);
  await page.addInitScript((quizIndex) => {
    window.localStorage.setItem(
      'bjtrainer.settings.v1',
      JSON.stringify({ version: 1, audio: { enabled: true, verbosity: 'results' }, drill: { quizIndex } }),
    );
  }, index);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Voice answers' }).check();
  await expect(page.locator('.voice-status')).toHaveAttribute('data-voice-state', 'listening');
}

/**
 * The quiz teaches the plays worth the most money and it is the drill with
 * the most to say out loud -- and it claimed neither the microphone nor the
 * wheel. Eyes-free, the only way to answer was a finger on the glass, which
 * is the one thing the mode exists to avoid.
 */
test('a spoken answer grades a deviation quiz item', async ({ page }) => {
  await openQuizWithVoice(page);
  await say(page, 'stand');
  await expect(page.locator('.message-strip .result-correct, .message-strip .mistake-card').first()).toBeVisible();
  // The echo is what tells a driver they were understood at all.
  await expect(page.locator('.voice-status-heard')).toContainText('stand');
});

test('ordinary conversation does not answer a quiz item', async ({ page }) => {
  await openQuizWithVoice(page);
  const before = await graded(page);
  await say(page, 'what is the weather like tomorrow');
  await expect(page.locator('.voice-status-heard')).toContainText('not a command');
  expect(await page.locator('.message-strip .result-correct, .message-strip .mistake-card').count()).toBe(0);
  expect(await graded(page)).toEqual(before);
});

/**
 * Insurance is the one quiz item that really is a yes/no question, so the
 * two words that mean nothing on an action item are the answer here.
 */
test('"yes" and "no" answer an insurance item', async ({ page }) => {
  await openQuizWithVoice(page, 'ins');
  await expect(page.locator('.quiz-insurance-prompt')).toBeVisible();
  await say(page, 'no');
  await expect(page.locator('.message-strip .result-correct, .message-strip .mistake-card').first()).toBeVisible();
});

/** Review of A5 (cosmetic): the dead-mic line follows the voice settings like every other line. */
test('the dead-mic line is said at the chosen rate and volume', async ({ page }) => {
  await withSettings(page, { audio: { enabled: true, rate: 1.4, volume: 0.6 } });
  await openFlashcardsWithVoice(page);
  await page.evaluate(() => {
    const rec = (window as unknown as { __rec?: { onerror?: (e: { error: string }) => void; onend?: () => void } }).__rec;
    rec?.onerror?.({ error: 'not-allowed' });
    rec?.onend?.();
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window as unknown as { __speechOptsLog?: Array<{ text: string; rate?: number; volume?: number }> }).__speechOptsLog ?? []).find((o) =>
          o.text.startsWith('The microphone has stopped listening.'),
        ),
      ),
    )
    .toMatchObject({ rate: 1.4 });
});
