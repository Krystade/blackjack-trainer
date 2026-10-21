import { expect, type Locator, type Page } from '@playwright/test';
import { FIELD_TEST_CONDITIONS } from '../src/diag/fieldTest';
import { basicPlay } from '../src/engine/strategy';
import { FULL_CTX } from '../src/drills/fallbackHand';
import { DEFAULT_RULES, type RuleSet } from '../src/engine/ruleset';
import type { Rank } from '../src/engine/cards';

/**
 * THE STORED DIAGNOSTIC LOG, as one JSON array string, oldest first -- what
 * `localStorage.getItem('bjtrainer.diagnostics.v1')` returned before G5 -- or
 * null when nothing is stored.
 *
 * G5 split the log into segments (src/diag/diagStore.ts): the legacy key,
 * then `bjtrainer.diagnostics.v1.<n>` in numeric order, each a JSON array of
 * the entries one flush appended. A spec reading the legacy key alone now
 * sees nothing, or only an older build's leftovers.
 *
 * Runs IN THE PAGE, so it is self-contained: `page.evaluate` serialises the
 * function's source and nothing it closes over comes with it.
 */
export function storedDiagnosticsJson(): string | null {
  const BASE = 'bjtrainer.diagnostics.v1';
  const found: { key: string; seq: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k === null) continue;
    if (k === BASE) found.push({ key: k, seq: -Infinity });
    else if (k.startsWith(`${BASE}.`) && /^-?\d{1,15}$/.test(k.slice(BASE.length + 1))) {
      found.push({ key: k, seq: Number(k.slice(BASE.length + 1)) });
    }
  }
  if (found.length === 0) return null;
  found.sort((a, b) => a.seq - b.seq);
  const all: unknown[] = [];
  for (const { key } of found) {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
      if (Array.isArray(v)) for (const e of v) all.push(e);
    } catch {
      /* an unreadable segment reads as empty, as it does in the app */
    }
  }
  return JSON.stringify(all);
}

/**
 * Write the diagnostic buffer to storage now, so a read of storage straight
 * after an action is not a read of the log from before it.
 *
 * The log flushes a second after an entry (FLUSH_DELAY_MS) and on lifecycle
 * events. `freeze` is the one lifecycle event with no listener but the log's
 * own (diag/environment.ts): it records `life freeze` and flushes
 * synchronously, so after this resolves storage holds everything logged so
 * far. An ABSENCE read from storage without it can be a buffered entry.
 */
export async function flushStoredDiagnostics(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new Event('freeze')));
}

/** `storedDiagnosticsJson`, run in `page`. */
export function readStoredDiagnostics(page: Page): Promise<string | null> {
  return page.evaluate(storedDiagnosticsJson);
}

/** Screenshot to e2e/screenshots/<name>.png (gitignored; reviewed set lives in e2e/screenshots-reviewed/). */
export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `e2e/screenshots/${name}.png` });
}

/**
 * Write a partial Settings object into localStorage BEFORE the app's first
 * script runs, so useGame/App pick it up on initial load. The store's
 * mergeSettings() deep-merges partial blobs over DEFAULT_SETTINGS, so only
 * the fields under test need to be specified.
 */
export async function withSettings(page: Page, patch: Record<string, unknown>): Promise<void> {
  const json = JSON.stringify({ version: 1, ...patch });
  await page.addInitScript((settingsJson) => {
    // SEEDED ONCE, not on every navigation. `addInitScript` re-runs on each
    // one, so a spec that reloads mid-run had its settings silently restored
    // by the harness -- which made a test about surviving a reload unable to
    // fail. A spec that wants the reload to be real sets `__noSeed` first.
    // The marker lives in STORAGE, not on `window`: init scripts run in the
    // order they were added, so a later script setting a window flag would
    // run after this one had already re-seeded.
    if (window.localStorage.getItem('e2e.noReseed') === '1') return;
    window.localStorage.setItem('bjtrainer.settings.v1', settingsJson);
  }, json);
}

/**
 * Write a single Profile into localStorage as both `bjtrainer.profiles.v1`
 * (an array of one) and `bjtrainer.activeProfile.v1` (its id), BEFORE the
 * app's first script runs — mirrors `withSettings` above, but for the v2
 * profiles store (src/store/profiles.ts). Table/Drills/grading read the
 * ACTIVE profile for rules/ramp/payouts (Cycle-1 Task 13/14), so this is how
 * e2e specs pin dealer rules (e.g. s17) or a bet ramp deterministically
 * without going through the profile-editor UI.
 *
 * Defaults mirror `makeDefaultProfile()` (v1-parity rules, v1 default ramp);
 * `patch.rules` merges shallowly over the default RuleSet, everything else
 * merges shallowly over the default Profile fields.
 */
export async function withProfile(page: Page, patch: Record<string, unknown> = {}): Promise<void> {
  const defaultRules = { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false };
  const defaultSpread = [
    { minTc: -99, units: 1 },
    { minTc: 1, units: 2 },
    { minTc: 2, units: 4 },
    { minTc: 3, units: 8 },
    { minTc: 4, units: 10 },
    { minTc: 5, units: 12 },
  ];
  const { rules: rulesPatch, ...rest } = patch as { rules?: Record<string, unknown> } & Record<string, unknown>;
  const profile = {
    id: 'e2e-profile',
    name: 'E2E Profile',
    rules: { ...defaultRules, ...(rulesPatch ?? {}) },
    penetration: 0.75,
    spread: defaultSpread,
    bankrollStart: 100,
    countCheckEvery: 0,
    betSpreadOn: false,
    ...rest,
  };
  const profilesJson = JSON.stringify([profile]);
  const activeId = profile.id;
  await page.addInitScript(
    ({ profilesJson, activeId }) => {
      window.localStorage.setItem('bjtrainer.profiles.v1', profilesJson);
      window.localStorage.setItem('bjtrainer.activeProfile.v1', activeId);
    },
    { profilesJson, activeId },
  );
}

/**
 * Write a partial Stats object into localStorage BEFORE the app's first
 * script runs -- mirrors `withSettings` above, but for `bjtrainer.stats.v1`
 * (src/store/persist.ts's mergeStats deep-merges partial blobs over
 * EMPTY_STATS the same way mergeSettings does for Settings). Lets a test pre-
 * seed drill history (e.g. `timedCount.history`) so it can exercise gate/
 * telemetry logic that depends on PRIOR runs, without having to play through
 * dozens of real drill attempts first.
 */
export async function withStats(page: Page, patch: Record<string, unknown>): Promise<void> {
  const json = JSON.stringify({ version: 1, ...patch });
  await page.addInitScript((statsJson) => {
    window.localStorage.setItem('bjtrainer.stats.v1', statsJson);
  }, json);
}

/**
 * Read back the persisted stats blob (`bjtrainer.stats.v1`) from
 * localStorage as a plain object, or `null` if nothing has been saved yet.
 * Used to prove a drill actually WROTE telemetry (src/store/persist.ts
 * saveStats), rather than just trusting the UI's result screen -- the
 * project has been bitten three times by a drill that renders fine but
 * silently records nothing.
 */
export async function readStats(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const json = window.localStorage.getItem('bjtrainer.stats.v1');
    return json ? (JSON.parse(json) as Record<string, unknown>) : null;
  });
}

/** Navigate home, then click the named Home nav button ("Play" | "Drills" | "Stats" | "Settings"). */
export async function goHomeAndNavigate(page: Page, url: string, button: 'Play' | 'Drills' | 'Stats' | 'Settings'): Promise<void> {
  await page.goto(url);
  // Navigation lives in the persistent tab bar since C4. Since #32 Stats has
  // a tab and Settings does not: Settings is reached from Home.
  if (button === 'Settings') {
    await page.locator('.home-settings-btn').click();
    return;
  }
  await page.locator('.tab-bar').getByRole('button', { name: button, exact: true }).click();
}

/** If the insurance modal is currently showing, resolve it (Take/Decline) and return true. */
export async function resolveInsurance(page: Page, take: boolean): Promise<boolean> {
  const modal = page.locator('.bottom-sheet', { hasText: 'Insurance?' });
  if (await modal.isVisible().catch(() => false)) {
    await modal.getByRole('button', { name: take ? 'Take' : 'Decline', exact: true }).click();
    return true;
  }
  return false;
}

/**
 * Drive a dealt round to completion by always taking the e2e advice
 * (`data-advice` on `.action-bar`), always declining insurance, and
 * dismissing any training-mode wrong-play overlay it happens to hit
 * (only possible if the advice itself changes between reads, which it
 * shouldn't — kept as a safety net). Stops once the action bar leaves
 * "actions" mode (round settled -> bet mode, or a count-check modal ->
 * hidden mode).
 */
export async function playRoundByAdvice(page: Page): Promise<void> {
  for (let guard = 0; guard < 30; guard++) {
    if (await resolveInsurance(page, false)) continue;

    const continueBtn = page.getByRole('button', { name: 'Continue', exact: true });
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click();
      continue;
    }

    const bar = page.locator('.action-bar[data-advice]');
    if (!(await bar.isVisible().catch(() => false))) return;
    const advice = await bar.getAttribute('data-advice');
    if (!advice) return;
    const label = advice.charAt(0).toUpperCase() + advice.slice(1);
    await bar.getByRole('button', { name: label, exact: true }).click();
  }
  throw new Error('playRoundByAdvice: exceeded guard iterations without settling');
}

/**
 * Select a Stats tab (C5). The fifteen sections are split by how the data is
 * earned — at the table, in the drills, or over time — so a spec asserting on
 * a section must first open the tab that owns it.
 */
export async function statsTab(page: Page, tab: 'Play' | 'Drills' | 'Progress'): Promise<void> {
  await page.locator('.stats-tabs').getByRole('tab', { name: tab, exact: true }).click();
}

/**
 * The eyes-free count drill now ENDS with a question.
 *
 * It used to speak the answer and jump straight to a result that recorded
 * nothing -- so the one mode built for the car never told you whether you
 * were right. It now asks "Did you have it?" and takes a two-zone tap, which
 * sits between the spoken answer and `.drill-result`.
 *
 * Specs that drive an eyes-free run to completion therefore have to answer
 * it. Reporting a hit is arbitrary but harmless: these specs assert on
 * speech and playback, not on the verdict.
 */
/*
 * WAIT FOR A DEFINITE SIGNAL, NOT FOR A CLOCK.
 *
 * This asked for the button with a 20s timeout and swallowed the failure, so
 * "there is no self-report in this run" and "the self-report has not arrived
 * yet" were the same thing to it. Under a full-suite run the second one
 * happens: a drill speaking every line through live speechSynthesis takes
 * longer than 20s to get there, the helper gave up, nothing ever answered the
 * question, and the caller then failed 20s later on a missing `.drill-result`
 * -- which reads like a drill that hung rather than a prompt nobody pressed.
 * It cost three full-suite runs, each blaming a different test, and waiting
 * longer at the caller would not have helped: the prompt needs answering, not
 * more time.
 *
 * So wait for whichever arrives first -- the question, or the result that
 * means there was no question -- and act on what actually appeared. Absence is
 * still tolerated, because some callers' runs end another way, but it is now
 * distinguished from lateness by a signal instead of a guess.
 */
export async function answerSelfReportIfPresent(page: Page): Promise<void> {
  const yes = page.getByRole('button', { name: 'I had it' });
  const ended = page.locator('.drill-result');

  const appeared = await yes
    .or(ended)
    .first()
    .waitFor({ state: 'visible', timeout: 120_000 })
    .then(() => true)
    .catch(() => false);

  if (appeared && (await yes.isVisible())) await yes.click();
}

/**
 * Put the field test on a condition WITHOUT the gate's picker, because there
 * is no longer a picker to go through.
 *
 * The gate offers exactly one leg now (`offered` in `fieldTest.ts`) and
 * renders no chooser when that is so: a field test with a menu asked the
 * operator to pick an experiment from the driver's seat, and four of the
 * seven choices were the settled routing protocol. The other six conditions
 * still exist and their steps still run, so the specs still need to drive
 * them -- they just cannot be reached by clicking a label.
 *
 * Seeding the persisted run is the honest way in: `condition` is the same
 * field `setFieldTestCondition` writes, so the app boots believing the
 * operator chose it and every path after that is the production one. Call it
 * BEFORE `page.goto`, like the other seeding helpers here.
 */
export async function selectFieldTestCondition(page: Page, label: string): Promise<void> {
  const found = FIELD_TEST_CONDITIONS.find((c) => c.label === label);
  if (!found) {
    throw new Error(
      `no field-test condition is labelled "${label}" -- ` +
        `have: ${FIELD_TEST_CONDITIONS.map((c) => c.label).join(', ')}`,
    );
  }
  await page.addInitScript((id) => {
    const KEY = 'bjtrainer.fieldTestRun.v1';
    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    } catch {
      /* a corrupt blob is the app's problem to survive, not this helper's */
    }
    localStorage.setItem(
      KEY,
      JSON.stringify({ active: false, stepIndex: 0, stamps: {}, ...current, condition: id }),
    );
  }, found.id);
}

/**
 * Change the condition on a gate that is already open.
 *
 * `selectFieldTestCondition` above is the one to reach for: it seeds storage
 * before the page loads and needs no seam at all. Use this one only where the
 * test's subject IS the change -- a leg paused and resumed somewhere else, a
 * tick earned under one condition and read under another -- because the
 * screen no longer offers a way to do it and storage cannot reach a running
 * store.
 */
export async function switchFieldTestCondition(page: Page, label: string): Promise<void> {
  const found = FIELD_TEST_CONDITIONS.find((c) => c.label === label);
  if (!found) {
    throw new Error(
      `no field-test condition is labelled "${label}" -- ` +
        `have: ${FIELD_TEST_CONDITIONS.map((c) => c.label).join(', ')}`,
    );
  }
  // F11: the field test is a lazily loaded chunk, so its screen (and the seam
  // it registers) arrives a moment after the click that opens it. Wait for
  // the seam rather than assume the screen rendered in the same tick; the
  // error below still fires if it never comes.
  await page
    .waitForFunction(() => typeof window.__setFieldTestCondition === 'function', undefined, { timeout: 10_000 })
    .catch(() => undefined);
  const took = await page.evaluate(
    (id) => window.__setFieldTestCondition?.(id) ?? false,
    found.id,
  );
  if (!took) {
    throw new Error(
      `the field test would not take the condition "${label}". The seam is ` +
        'registered by the field-test screen under ?e2e=1, so the page has to ' +
        'be on that screen, with that parameter, before this is called.',
    );
  }
}

/**
 * Say something into the fake engine, having first waited for the microphone
 * to actually be open.
 *
 * WHY WAITING FOR 'listening' IS THE WHOLE HELPER, and why firing on a timer
 * was not merely slower but wrong. The old version fired a transcript every
 * 400ms until the status stopped saying "the app was speaking". Once the route
 * setting began closing the recogniser for each spoken line, that turned into
 * a loop that could not end: every transcript that arrived while the app was
 * talking came back `suppressed`, an unheard answer makes the app ASK AGAIN,
 * and asking again closes the microphone again. Fifteen seconds of that, and
 * the spec blamed the app for a deadlock the spec was driving.
 *
 * A person does not do that. They wait for the prompt to finish and then
 * speak once, which is exactly what `data-voice-state` reports -- the
 * recogniser is 'listening' only when a session is live, which under the
 * 'switch' route means the app has stopped talking. So: wait for the
 * microphone, say it once, and only then ask whether it landed.
 *
 * The retry around the outside stays, because a session can be confirmed open
 * in the same tick as the tail of an utterance and one word can still be
 * eaten. What it may not do is fire into a closed microphone.
 */
export async function sayOnceListening(
  page: Page,
  transcript: string,
  alternatives: string[] = [],
): Promise<void> {
  const deadline = Date.now() + 20_000;
  let heard: string | null = null;
  while (Date.now() < deadline) {
    // THE MICROPHONE FIRST. An open session is the precondition for being
    // heard at all, and the thing the old helper never checked.
    await expect(page.locator('.voice-status')).toHaveAttribute(
      'data-voice-state',
      'listening',
      { timeout: 15_000 },
    );
    await page.evaluate(
      ({ text, alts }) => {
        const rec = (window as unknown as { __rec?: { onresult?: (e: unknown) => void } }).__rec;
        // The winner plus the readings ranked below it, as a real engine hands
        // them over in one result.
        const readings = [{ transcript: text }, ...alts.map((a) => ({ transcript: a }))];
        rec?.onresult?.({ results: [readings] });
      },
      { text: transcript, alts: alternatives },
    );
    heard = await page.locator('.voice-status-heard').textContent();
    // B2 #5: a word in the post-speech tail is suppressed too, and now says
    // so honestly ("ignored (too soon)"); both mean "not heard yet".
    if (heard !== null && !/ignored \((the app was speaking|too soon)\)/.test(heard)) return;
    // Suppressed after all: the app started talking again between the state
    // check and the word. Wait for the next opening rather than hammering.
    await page.waitForTimeout(250);
  }
  throw new Error(
    `"${transcript}" was still suppressed after 20s; last heard status: ${String(heard)}`,
  );
}

/**
 * Wait until a recognition session is actually live.
 *
 * Under the 'switch' route the microphone is CLOSED for the whole of every
 * spoken line, so a transcript fired on a timer lands in a dead session and
 * the spec reads it as the app failing to grade an answer. The state attribute
 * is the only honest signal that the engine can hear anything.
 */
export async function waitForMic(page: Page): Promise<void> {
  await expect(page.locator('.voice-status')).toHaveAttribute(
    'data-voice-state',
    'listening',
    { timeout: 15_000 },
  );
}


/**
 * Open the Count drill's "Options" disclosure. Everything past Length and
 * Eyes-free audio / Voice answers lives under it, closed by default (also
 * under ?e2e=1), so a spec that drives Countdown, Group size, Time per card,
 * Distractions and the rest has to open it first. Safe to call when already
 * open, or on a screen without one.
 */
export async function openCountOptions(page: Page): Promise<void> {
  const details = page.locator('.count-setup .drill-options').first();
  if ((await details.count()) === 0) return;
  const open = await details.evaluate((el) => (el as HTMLDetailsElement).open);
  if (!open) await details.locator('summary').click();
}

/**
 * B1: answer by clicking `button`, then wait for the result strip to show a
 * NEW result (the strip persists between answers, so mere visibility is not
 * proof the click landed). Returns the strip's tone.
 */
export async function answerAndReadStrip(
  page: Page,
  button: Locator,
): Promise<'ok' | 'miss'> {
  const result = page.locator('[data-testid="result-strip"] .hand-result');
  const before = (await result.count()) ? await result.getAttribute('data-result-id') : null;
  await button.click();
  await page.waitForFunction(
    (prev) => {
      const el = document.querySelector('[data-testid="result-strip"] .hand-result');
      return !!el && el.getAttribute('data-result-id') !== prev;
    },
    before,
  );
  return (await page.locator('[data-testid="result-strip"]').getAttribute('data-tone')) as 'ok' | 'miss';
}

/**
 * #32: Settings left the tab bar and is reached from Home. From any tabbed
 * screen, go Home first, then open Settings.
 */
export async function openSettingsScreen(page: Page): Promise<void> {
  const btn = page.locator('.home-settings-btn');
  if (!(await btn.isVisible().catch(() => false))) {
    await page.locator('.tab-bar').getByRole('button', { name: 'Home', exact: true }).click();
  }
  await btn.click();
}

/**
 * Wave A (s04/s05): an empty keypad no longer submits 0 -- OK stays disabled
 * until a digit is typed, so a stray or bounced tap cannot grade a phantom 0.
 * A spec that means "answer 0" types it, like a person now has to.
 */
export async function submitZero(page: Page): Promise<void> {
  const pad = page.locator('.numpad');
  await pad.locator('.numpad-btn', { hasText: /^0$/ }).click();
  await pad.locator('.numpad-ok').click();
}

const ACTION_LABEL = { hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split', surrender: 'Surrender' } as const;

/**
 * The action-bar label of the basic-strategy play for the two-card hand a
 * hand drill is showing. Lets a test give a right (or a known-wrong) answer
 * on purpose instead of repeating one action until the draw obliges -- the
 * E2 learning step re-deals missed cards, so "answer Stand until right" can
 * loop on Stand-is-wrong hands.
 */
export async function shownHandRightPlay(page: Page, rules: RuleSet = DEFAULT_RULES): Promise<string> {
  const ranks = (await page.locator('.hands-row .card-rank').allTextContents()) as Rank[];
  const [up] = (await page.locator('.dealer-area .card-rank').allTextContents()) as Rank[];
  if (ranks.length !== 2 || !up) throw new Error(`unexpected hand on screen: ${ranks.join(',')} v ${up}`);
  return ACTION_LABEL[basicPlay(ranks.map((rank) => ({ rank, suit: 's' as const })), up, FULL_CTX, rules).action];
}
