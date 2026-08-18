import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { shot, withSettings, withProfile, resolveInsurance } from './helpers';

/**
 * Local (spec-only) helper: read back the persisted profiles array from
 * localStorage (`bjtrainer.profiles.v1`, the same key store/profiles.ts
 * writes via saveProfiles). Mirrors readStats() in helpers.ts but for
 * profiles, so these T0 ProfileEditor specs can assert the SAVED rules /
 * ramp / cvcx value rather than just trusting the on-screen control.
 * Kept here (not in helpers.ts) because the task forbids editing helpers.ts.
 */
async function readPersistedProfiles(page: Page): Promise<Array<Record<string, any>>> {
  return page.evaluate(() => {
    const json = window.localStorage.getItem('bjtrainer.profiles.v1');
    return json ? (JSON.parse(json) as Array<Record<string, any>>) : [];
  });
}

/** Open the editor for the (single seeded) profile: Home chip -> Profiles -> Edit. */
async function openEditorForFirstProfile(page: Page): Promise<void> {
  await page.locator('.home-profile-chip').click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page.locator('.settings-heading')).toHaveText('Edit Profile');
}

test('profile create + switch: a new S17 profile can be created, saved, and activated from Home', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');
  await shot(page, '26-profiles-list-initial');

  await page.getByRole('button', { name: 'New Profile', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('New Profile');
  await shot(page, '27-profile-editor-new');

  const s17Row = page.locator('.settings-row', { hasText: 'Dealer soft 17' });
  await s17Row.getByRole('button', { name: 'S17', exact: true }).click();
  await expect(s17Row.getByRole('button', { name: 'S17', exact: true })).toHaveClass(/segmented-btn-active/);
  await shot(page, '28-profile-editor-new-s17-set');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');

  const newRow = page.locator('.profile-row', { hasText: 'New Profile' });
  await expect(newRow).toBeVisible();
  await shot(page, '29-profiles-list-after-save');

  await newRow.locator('.profile-row-select').click();
  await expect(newRow).toHaveClass(/profile-row-active/);
  await expect(newRow.locator('.profile-row-badge')).toHaveText('Active');

  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await expect(page.locator('.home-title')).toBeVisible();
  await expect(page.locator('.home-profile-chip')).toHaveText('New Profile');
  await shot(page, '30-home-chip-active-profile');
});

test('S17 profile: the dealer stands on a two-card soft 17 (seed-hunt for an A,6 dealer hand)', async ({ page }) => {
  // A specific two-card up+hole combo (A,6 in either order) out of a 6-deck
  // shoe is a ~1.2% draw (engine/cards.ts's Shoe always builds 6 decks
  // regardless of the profile's rules.decks — see report concerns), so a
  // seed-hunt over 1..60 (as used elsewhere in this suite for a much-more-
  // common ten-value pair) is not reliable here: it can come up empty ~50%
  // of the time. Widened to 1..250 (offline-verified via a standalone replay
  // of the exact mulberry32+Fisher-Yates algorithm in cards.ts: the first
  // hit is deterministically at seed=244, dealer up=6/hole=A, no earlier
  // seed matches) so this test is reliable rather than merely probable.
  test.setTimeout(120_000);
  // feedbackMode 'test' (not the default 'training') so a deliberately
  // sub-optimal Stand doesn't pop the training wrong-play overlay — this
  // test only cares about the dealer's own hit/stand behavior.
  await withSettings(page, { feedbackMode: 'test' });
  await withProfile(page, { name: 'S17 Test Profile', rules: { s17: true } });

  let foundSeed: number | null = null;
  for (let seed = 1; seed <= 250 && foundSeed === null; seed++) {
    await page.goto(`/?seed=${seed}&e2e=1`);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await resolveInsurance(page, false);

    const bar = page.locator('.action-bar[data-advice]');
    if (!(await bar.isVisible().catch(() => false))) continue; // player natural blackjack settled the round immediately

    await bar.getByRole('button', { name: 'Stand', exact: true }).click();

    const dealerCards = page.locator('.dealer-area .card[data-card]');
    const count = await dealerCards.count();
    if (count < 2) continue; // hole never got revealed on this path

    const [c0, c1] = await Promise.all([dealerCards.nth(0).getAttribute('data-card'), dealerCards.nth(1).getAttribute('data-card')]);
    if (!c0 || !c1) continue;
    const r0 = c0.slice(0, -1);
    const r1 = c1.slice(0, -1);
    const isSoftSeventeen = (r0 === 'A' && r1 === '6') || (r0 === '6' && r1 === 'A');
    if (isSoftSeventeen) {
      foundSeed = seed;
    }
  }

  expect(foundSeed, 'expected at least one of seeds 1..250 to deal the dealer an A,6 two-card hand').not.toBeNull();
  console.log(`[s17-seed-hunt] found dealer A,6 at seed=${foundSeed}`);

  // S17 is on: the dealer must stand on this soft 17 rather than hitting a third card.
  await expect(page.locator('.dealer-area .card[data-card]')).toHaveCount(2);
  await expect(page.locator('.message-strip .message-result').first()).toBeVisible();
  await shot(page, '31-table-dealer-soft17-stand');
});

test('migration: a v1-only settings blob (no profiles keys) migrates to "Default (6D H17)"', async ({ page }) => {
  // Deliberately use withSettings only — no withProfile call — so the
  // profiles/activeProfile keys are entirely absent on first load, matching
  // the true first-run migration path in store/profiles.ts.
  await withSettings(page, { betSpreadOn: true, bankrollStart: 250, countCheckEvery: 3, penetration: 0.6 });
  await page.goto('/?e2e=1');

  await expect(page.locator('.home-profile-chip')).toHaveText('Default (6D H17)');
  await shot(page, '32-home-chip-migrated-default');
});

// ---------------------------------------------------------------------------
// T0 gap-closing specs (docs/research/2026-07-26-test-coverage-matrix.md §6):
// every ProfileEditor rule/ramp/cvcx control DRIVEN through the real UI, saved,
// and asserted against the persisted blob (and, for CVCX, the Stats header).
// ---------------------------------------------------------------------------

test('profile editor rules: DAS/LS/RSA/bj65 toggles, decks segmented, and penetration stepper all flip + persist', async ({ page }) => {
  // Seed a profile with KNOWN starting rules so each flip is unambiguous:
  // das/ls true -> we turn them OFF; rsa/bj65 false -> we turn them ON;
  // decks 6 -> set to 2; penetration 0.75 -> step up to 0.80.
  await withProfile(page, {
    name: 'Rules Profile',
    rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false },
    penetration: 0.75,
  });
  await page.goto('/?e2e=1');
  await openEditorForFirstProfile(page);

  // Decks segmented 6 -> 2 (scope to the Decks row; "Your hands" also has a 1/2/3 segmented).
  const decksRow = page.locator('.settings-row', { hasText: 'Decks' });
  await decksRow.getByRole('button', { name: '2', exact: true }).click();
  await expect(decksRow.getByRole('button', { name: '2', exact: true })).toHaveClass(/segmented-btn-active/);

  // Rule toggles (checkbox inputs inside .settings-toggle-row labels).
  const dasToggle = page.locator('.settings-toggle-row', { hasText: 'Double after split (DAS)' }).locator('input.settings-toggle');
  const lsToggle = page.locator('.settings-toggle-row', { hasText: 'Late surrender (LS)' }).locator('input.settings-toggle');
  const rsaToggle = page.locator('.settings-toggle-row', { hasText: 'Resplit aces (RSA)' }).locator('input.settings-toggle');
  const bj65Toggle = page.locator('.settings-toggle-row', { hasText: '6:5 blackjack payout' }).locator('input.settings-toggle');

  await expect(dasToggle).toBeChecked();
  await expect(lsToggle).toBeChecked();
  await expect(rsaToggle).not.toBeChecked();
  await expect(bj65Toggle).not.toBeChecked();

  await dasToggle.click();
  await lsToggle.click();
  await rsaToggle.click();
  await bj65Toggle.click();

  await expect(dasToggle).not.toBeChecked();
  await expect(lsToggle).not.toBeChecked();
  await expect(rsaToggle).toBeChecked();
  await expect(bj65Toggle).toBeChecked();

  // Penetration stepper 0.75 -> 0.80 (the '+' button; '−' is U+2212, not '+').
  const penRow = page.locator('.settings-row', { hasText: 'Penetration' });
  await expect(penRow.locator('.stepper-value')).toHaveText('75%');
  await penRow.getByRole('button', { name: '+', exact: true }).click();
  await expect(penRow.locator('.stepper-value')).toHaveText('80%');
  await shot(page, '33-profile-editor-rules-flipped');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');

  // Read the persisted blob DIRECTLY — Save calls saveProfiles synchronously, so
  // localStorage already holds the edits. Do NOT page.goto reload: withProfile seeds
  // via addInitScript, which re-runs on every load and would clobber the just-saved rules.
  const [saved] = await readPersistedProfiles(page);
  expect(saved.rules.decks).toBe(2);
  expect(saved.rules.das).toBe(false);
  expect(saved.rules.ls).toBe(false);
  expect(saved.rules.rsa).toBe(true);
  expect(saved.rules.bj65).toBe(true);
  expect(saved.penetration).toBeCloseTo(0.8, 5);
});

test('profile editor bet ramp: manual add-row / edit minTc & units / remove-row persists (independent of CVCX paste)', async ({ page }) => {
  // Seed a small, KNOWN spread with betSpreadOn so the "Bet ramp" section renders.
  await withProfile(page, {
    name: 'Ramp Profile',
    betSpreadOn: true,
    spread: [
      { minTc: -99, units: 1 },
      { minTc: 5, units: 8 },
    ],
  });
  await page.goto('/?e2e=1');
  await openEditorForFirstProfile(page);

  const rampSection = page.locator('.settings-section', { hasText: 'Bet ramp' });
  await expect(rampSection.locator('.spread-row')).toHaveCount(2);

  // Add a row -> appends { minTc: 0, units: 1 } as the 3rd (last) row.
  await rampSection.getByRole('button', { name: 'Add row', exact: true }).click();
  await expect(rampSection.locator('.spread-row')).toHaveCount(3);

  const newRow = rampSection.locator('.spread-row').last();
  const tcField = newRow.locator('.spread-field').nth(0); // "TC ≥"
  const unitsField = newRow.locator('.spread-field').nth(1); // "Units"
  await expect(tcField.locator('.stepper-value')).toHaveText('0');
  await expect(unitsField.locator('.stepper-value')).toHaveText('1');

  // Edit minTc 0 -> 3 (+ three times) and units 1 -> 3 (+ twice).
  const tcPlus = tcField.getByRole('button', { name: '+', exact: true });
  await tcPlus.click();
  await tcPlus.click();
  await tcPlus.click();
  await expect(tcField.locator('.stepper-value')).toHaveText('3');

  const unitsPlus = unitsField.getByRole('button', { name: '+', exact: true });
  await unitsPlus.click();
  await unitsPlus.click();
  await expect(unitsField.locator('.stepper-value')).toHaveText('3');

  // Remove the first row (minTc -99). Rows left: { 5, 8 } and { 3, 3 }.
  await rampSection.locator('.spread-row').first().getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(rampSection.locator('.spread-row')).toHaveCount(2);
  await shot(page, '34-profile-editor-ramp-edited');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');

  // Read the persisted blob DIRECTLY (Save wrote localStorage synchronously). No reload:
  // withProfile's addInitScript would re-seed the original spread on a fresh page load.
  const [saved] = await readPersistedProfiles(page);
  // saveDraft sorts the ramp by minTc ascending.
  expect(saved.spread).toEqual([
    { minTc: 3, units: 3 },
    { minTc: 5, units: 8 },
  ]);
});

test('profile editor CVCX: score/EV/ROR/simNote entered + saved + surfaced on the Stats profile header', async ({ page }) => {
  await withProfile(page, { name: 'CVCX Profile' });
  await page.goto('/?e2e=1');
  await openEditorForFirstProfile(page);

  const cvcxSection = page.locator('.settings-section', { hasText: 'CVCX' });
  await cvcxSection.locator('.settings-row', { hasText: 'Score' }).locator('input.profile-number-input').fill('55');
  await cvcxSection.locator('.settings-row', { hasText: 'EV / hour' }).locator('input.profile-number-input').fill('12');
  await cvcxSection.locator('.settings-row', { hasText: 'Risk of ruin' }).locator('input.profile-number-input').fill('5');
  await cvcxSection.locator('.settings-row', { hasText: 'Sim note' }).locator('input.profile-text-input').fill('N0 400M sim');
  await shot(page, '35-profile-editor-cvcx-entered');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');

  // Persisted blob carries the CVCX fields.
  const [saved] = await readPersistedProfiles(page);
  expect(saved.cvcx).toMatchObject({ score: 55, evPerHour: 12, riskOfRuin: 5, simNote: 'N0 400M sim' });

  // Confirm the numbers surface on the Stats header for the active profile
  // (formatSigned/percent formatting per Stats.tsx). Navigate there WITHOUT a
  // page reload — a page.goto would re-run withProfile's addInitScript and clobber
  // the saved CVCX. The store already holds the saved values in memory + localStorage.
  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await expect(page.locator('.home-title')).toBeVisible();
  await page.locator('.home-stats-link').click();
  await expect(page.locator('.stats-heading')).toBeVisible();
  await expect(page.locator('.mistake-row', { hasText: 'CVCX score' })).toContainText('55');
  await expect(page.locator('.mistake-row', { hasText: 'CVCX EV/hr' })).toContainText('+12');
  await expect(page.locator('.mistake-row', { hasText: 'CVCX risk of ruin' })).toContainText('5%');
  await expect(page.locator('.mistake-row', { hasText: 'CVCX sim note' })).toContainText('N0 400M sim');
  await shot(page, '36-stats-header-cvcx');
});

test('profiles: Duplicate creates a "(copy)" of a profile', async ({ page }) => {
  await withProfile(page, { name: 'Dupe Source' });
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');
  await expect(page.locator('.profile-row')).toHaveCount(1);

  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();

  await expect(page.locator('.profile-row')).toHaveCount(2);
  await expect(page.locator('.profile-row-name', { hasText: 'Dupe Source (copy)' })).toBeVisible();
  await shot(page, '37-profiles-after-duplicate');

  const profiles = await readPersistedProfiles(page);
  expect(profiles).toHaveLength(2);
  expect(profiles.map((p) => p.name)).toContain('Dupe Source (copy)');
  // Copy has a distinct id (makeId), not a clone of the source id.
  expect(profiles[0].id).not.toBe(profiles[1].id);
});

test('profiles: Delete respects the canDelete guard (disabled at 1 profile, removes at >=2)', async ({ page }) => {
  await withProfile(page, { name: 'Keep Me' });
  await page.goto('/?e2e=1');
  await page.locator('.home-profile-chip').click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');

  // With a single profile, the Delete button in the editor is disabled (canDelete=false).
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page.locator('.settings-heading')).toHaveText('Edit Profile');
  await expect(page.getByRole('button', { name: 'Delete profile', exact: true })).toBeDisabled();
  await page.locator('.profile-cancel-btn').click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');

  // Create a 2nd profile via Duplicate so delete becomes allowed.
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(page.locator('.profile-row')).toHaveCount(2);

  // Edit the copy and delete it (accept the confirm() dialog).
  await page.locator('.profile-row', { hasText: 'Keep Me (copy)' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('.settings-heading')).toHaveText('Edit Profile');
  const deleteBtn = page.getByRole('button', { name: 'Delete profile', exact: true });
  await expect(deleteBtn).toBeEnabled();
  page.once('dialog', (d) => d.accept());
  await deleteBtn.click();

  await expect(page.locator('.settings-heading')).toHaveText('Profiles');
  await expect(page.locator('.profile-row')).toHaveCount(1);
  await shot(page, '38-profiles-after-delete');

  const profiles = await readPersistedProfiles(page);
  expect(profiles).toHaveLength(1);
  expect(profiles.map((p) => p.name)).toEqual(['Keep Me']);
});

test('profile editor Cancel discards edits (name + rule change do not persist)', async ({ page }) => {
  await withProfile(page, { name: 'Cancel Me', rules: { das: true } });
  await page.goto('/?e2e=1');
  await openEditorForFirstProfile(page);

  // Make edits we expect to be thrown away.
  await page.locator('.settings-row', { hasText: 'Profile name' }).locator('input.profile-text-input').fill('CHANGED NAME');
  await page.locator('.settings-toggle-row', { hasText: 'Double after split (DAS)' }).locator('input.settings-toggle').click();

  await page.locator('.profile-cancel-btn').click();
  await expect(page.locator('.settings-heading')).toHaveText('Profiles');
  await shot(page, '39-profiles-after-cancel');

  // Nothing changed on disk: original name + original das.
  const [saved] = await readPersistedProfiles(page);
  expect(saved.name).toBe('Cancel Me');
  expect(saved.rules.das).toBe(true);
  // The list still shows the original name (not the discarded edit).
  await expect(page.locator('.profile-row-name', { hasText: 'Cancel Me' })).toBeVisible();
  await expect(page.locator('.profile-row-name', { hasText: 'CHANGED NAME' })).toHaveCount(0);
});
