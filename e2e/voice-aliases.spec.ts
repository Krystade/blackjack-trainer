import { test, expect, type Page } from '@playwright/test';
import { sayOnceListening } from './helpers';

/**
 * Teaching the app a word it misheard.
 *
 * WHY THIS IS AN E2E AND NOT ONLY A UNIT TEST. The matching is covered in
 * src/audio/voiceRecognition.test.ts, but what Jack actually has to use is a
 * list of rows each carrying a dropdown, on a 375px phone, in a car park. A
 * green unit suite says nothing about whether that list is reachable, whether
 * it offers the right words, or whether tapping one actually sticks -- and the
 * panel's whole value is that it is seeded from real rejections rather than
 * asking him to guess what the engine returned.
 */
async function seedRejections(page: Page): Promise<void> {
  // The real readings out of his 2026-10-04 drive, verdicts included, so the
  // panel is exercised against the data it exists for rather than invented
  // words that happen to be easy.
  await page.addInitScript(() => {
    const at = '2026-10-04T17:16:00.000Z';
    const rows = [
      { at, heard: 'Strength', verdict: 'rejected', context: 'flashcards' },
      { at, heard: 'Strength', verdict: 'rejected', context: 'flashcards' },
      { at, heard: 'Definitely', verdict: 'rejected', context: 'flashcards' },
      { at, heard: 'Definitely', verdict: 'rejected', context: 'flashcards' },
      { at, heard: "That's for sure", verdict: 'rejected', context: 'flashcards' },
      { at, heard: 'Touch', verdict: 'rejected', context: 'flashcards' },
      { at, heard: 'Shows', verdict: 'rejected', context: 'flashcards' },
      { at, heard: 'Split', verdict: 'split', context: 'flashcards' },
    ];
    localStorage.setItem('bjtrainer.voiceHistory.v1', JSON.stringify(rows));
  });
}

async function openPanel(page: Page): Promise<void> {
  await page.setViewportSize({ width: 375, height: 812 });
  await seedRejections(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Settings' }).click();
  // No click: `?e2e=1` forces every CollapsibleSection open (see
  // e2eForcesOpen in ui/components/CollapsibleSection.tsx), so clicking the
  // summary would CLOSE this one and hide everything the test is about.
  await expect(page.getByText('Teach it your words')).toBeVisible();
}

/**
 * Pick an action for a misheard word.
 *
 * React keeps its own value tracker on a <select>, so a plain assignment is
 * deduped and `onChange` never runs; going through the prototype's setter is
 * what makes React see a real change. Playwright's own `selectOption` cannot
 * settle here because choosing an action re-renders the row out of the list
 * in the same tick.
 */
async function teach(page: Page, heard: string, action: string): Promise<void> {
  await page.evaluate(
    ({ word, meant }) => {
      const el = document.querySelector(
        `select[aria-label*="${word}"]`,
      ) as HTMLSelectElement | null;
      if (!el) throw new Error(`no menu offered for "${word}"`);
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      )?.set;
      setter?.call(el, meant);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { word: heard, meant: action },
  );
}

function storedAliases(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('bjtrainer.settings.v1');
    const parsed = raw
      ? (JSON.parse(raw) as { audio?: { voiceAliases?: Record<string, string> } })
      : null;
    return parsed?.audio?.voiceAliases ?? {};
  });
}

test('offers what the engine actually misheard, commonest first', async ({ page }) => {
  await openPanel(page);

  // The point of seeding from history: these are words nobody would think to
  // type into a blank box. "Strength" appeared twice and so leads.
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).toContain('strength');
  expect(text).toContain('definitely');
  expect(text).toContain("that's for sure");

  // A reading the app UNDERSTOOD must not be offered -- there is nothing to
  // teach, and offering it would bury the real misses.
  expect(text).not.toContain('“split” ×');

  await page.getByText('Teach it your words').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/alias-panel.png' });
});

test('teaching a word stores it and takes it off the list', async ({ page }) => {
  await openPanel(page);
  await teach(page, 'strength', 'stand');

  // Stored under the audio settings, so it is exported and backed up with
  // everything else rather than lost to a reinstall.
  await expect.poll(() => storedAliases(page)).toEqual({ strength: 'stand' });

  // And read back, so he can see what he has taught and undo it.
  await expect(page.getByText('means stand', { exact: false })).toBeVisible();

  // Gone from the offers, so the list shrinks as he works through it.
  const row = page.locator('select[aria-label*="strength"]');
  await expect(row).toHaveCount(0);

  await page.getByText('Teach it your words').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/alias-panel-taught.png' });
});

test('a taught word is then heard as that command', async ({ page }) => {
  /*
   * THE ONE THAT MATTERS. Everything else here tests a settings screen; this
   * tests that the setting changes what the MICROPHONE does, which is the
   * only reason the screen exists. Without it the panel could store aliases
   * that nothing ever reads and every other test in this file would pass.
   *
   * Driven through a real drill with a fake engine rather than by calling the
   * matcher: the alias has to survive the trip from settings into the module
   * the drill screens actually consult, and that wiring is the part most
   * likely to be missing.
   */
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      lang = '';
      phrases: unknown[] = [];
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
      stop(): void {
        this.onend?.();
      }
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });

  await openPanel(page);
  await teach(page, 'strength', 'stand');
  await expect.poll(() => storedAliases(page)).toEqual({ strength: 'stand' });

  // Into a drill, with the microphone on.
  await page.getByRole('button', { name: 'Back to Home' }).click();
  await page.getByRole('button', { name: 'Play a shoe' }).click();
  await page.locator('.voice-btn').click();
  await expect(page.locator('.voice-status')).toHaveAttribute(
    'data-voice-state',
    'listening',
  );
  await page.locator('.deal-btn').click();

  // Say the taught word. Before this change it was rejected outright, which
  // is exactly what Jack's log shows happening twice in one drive.
  // Through the shared helper, which waits for the microphone to be open and
  // retries if the app began talking in the same tick. A bare onresult fired
  // straight after Deal landed while the app was still speaking -- where the
  // transcript is (correctly) suppressed -- so under load the test measured
  // the race with the dealer's own voice, not the alias.
  await sayOnceListening(page, 'strength');

  await expect(page.locator('.voice-status-heard')).toContainText('stand', {
    ignoreCase: true,
  });
});

test('refuses a phrase too long for the echo guard', async ({ page }) => {
  /*
   * Three words would break audio/selfEcho.ts: it dismisses a late transcript
   * as the app's own voice once it is longer than anything the operator could
   * say, so a three-word alias means the app can no longer tell its own
   * prompt from a command and starts grading its own voice as an answer.
   */
  await openPanel(page);
  const field = page.getByLabel('A word to listen for');
  await field.fill('i would like to stand');
  await expect(page.getByText('At most two words', { exact: false })).toBeVisible();

  // And the Add button must be refused, not merely warned about.
  const add = page.getByRole('button', { name: 'Add' });
  await expect(add).toBeDisabled();
  await expect.poll(() => storedAliases(page)).toEqual({});
});
