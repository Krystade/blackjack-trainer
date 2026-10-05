import { expect, type Page } from '@playwright/test';
import { FIELD_TEST_CONDITIONS } from '../src/diag/fieldTest';

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
  // Navigation lives in the persistent tab bar since C4. Stats is the one
  // destination without a tab -- Home is a dashboard that already carries the
  // summary, so the full breakdown hangs off it rather than taking a fifth
  // slot from Settings, which gets changed mid-session.
  if (button === 'Stats') {
    await page.locator('.home-stats-link').click();
    return;
  }
  await page.locator('.tab-bar').getByRole('button', { name: button, exact: true }).click();
}

/** If the insurance modal is currently showing, resolve it (Take/Decline) and return true. */
export async function resolveInsurance(page: Page, take: boolean): Promise<boolean> {
  const modal = page.locator('.modal-backdrop', { hasText: 'Insurance?' });
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
export async function answerSelfReportIfPresent(page: Page): Promise<void> {
  const yes = page.getByRole('button', { name: 'I had it' });
  await yes.click({ timeout: 20_000 }).catch(() => {
    /* Not an eyes-free run, or it ended some other way. */
  });
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
    if (heard !== null && !heard.includes('the app was speaking')) return;
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
