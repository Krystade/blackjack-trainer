import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { withProfile } from './helpers';

/**
 * A2. The chart page said "Exactly the chart the trainer grades you
 * against", and it is reached from corrections -- including the counted ones
 * it deliberately does not contain. So the learner arrives at a ringed cell
 * that contradicts the answer they were just marked against, under a
 * sentence promising the two agree.
 *
 * The property under test is a RELATION between two things the app renders
 * independently, not a copy check: the correction names the play the trainer
 * expected (`.mistake-cell`, one letter), the chart rings the cell it prints
 * for the same hand (`data-action`, its code), and the note must appear
 * exactly when those two disagree. Neither side is computed here from the
 * feature's own helper, so a note that is always on and a note that is never
 * on both fail -- the deviation quiz below supplies the disagreeing case and
 * flashcards the agreeing one.
 */

/** What a chart code resolves to at a table that allows surrender, as a
 *  single letter in the correction panel's own notation. */
const CODE_LETTER: Record<string, string> = {
  H: 'H',
  S: 'S',
  Dh: 'D',
  Ds: 'D',
  P: 'P',
  Rh: 'R',
  Rs: 'R',
  Rp: 'R',
};

const LETTER_WORD: Record<string, string> = {
  H: 'hit',
  S: 'stand',
  D: 'double',
  P: 'split',
  R: 'surrender',
};

interface Opened {
  /** The play the trainer graded as correct, as a chart letter. */
  expected: string;
  /** The play THIS chart prints for the hand, as a chart letter. */
  printed: string;
  noteText: string | null;
}

/**
 * From a rendered correction: open the table, read both plays and the note,
 * then close the overlay again.
 */
async function openTableAndRead(page: Page): Promise<Opened> {
  const panel = page.locator('.mistake-card');
  await expect(panel).toBeVisible();
  const expected = (await panel.locator('.mistake-cell').innerText()).trim();

  await panel.getByRole('button', { name: 'Show on chart', exact: true }).click();
  const overlay = page.locator('.study-chart-overlay');
  await expect(overlay).toBeVisible();

  const ringed = overlay.locator('[data-highlight="true"]');
  await expect(ringed).toHaveCount(1);
  const code = (await ringed.getAttribute('data-action'))!;
  const printed = CODE_LETTER[code] ?? code;

  const note = overlay.locator('.charts-note');
  const noteText = (await note.count()) ? (await note.innerText()).trim() : null;
  if (noteText !== null) {
    // A note nobody scrolls to is not a note. It sits with the provenance
    // line, above the grid, on the first screen of the page.
    await expect(note).toBeInViewport();
  }

  await overlay.getByRole('button', { name: /back/i }).click();
  await expect(overlay).toHaveCount(0);
  return { expected, printed, noteText };
}

/** Assert the relation, whichever way this particular hand fell. */
function checkRelation(seen: Opened, where: string): 'differ' | 'agree' {
  if (seen.printed === seen.expected) {
    expect(
      seen.noteText,
      `${where}: the chart printed ${seen.printed} and the trainer expected ${seen.expected} -- ` +
        `there is nothing to reconcile, but the page said: ${seen.noteText}`,
    ).toBeNull();
    return 'agree';
  }
  expect(
    seen.noteText,
    `${where}: the chart rings ${seen.printed} and the learner was graded ` +
      `${seen.expected}, with nothing on the page explaining the difference`,
  ).not.toBeNull();
  // It has to name BOTH plays; "these differ" without saying how is not a
  // reconciliation.
  expect(seen.noteText!.toLowerCase()).toContain(LETTER_WORD[seen.expected]);
  expect(seen.noteText!.toLowerCase()).toContain(LETTER_WORD[seen.printed]);
  return 'differ';
}

test('a counted correction explains why the ringed cell says something else', async ({ page }) => {
  await withProfile(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills' }).first().click();
  await page.getByRole('button', { name: 'Deviation quiz', exact: true }).click();

  // 16 v 10: the index the chart cannot hold. The quiz grades it stand at
  // TC >= 0 and hit below, under a ctx with surrender off; the chart, drawn
  // for a table that offers surrender, prints Rh either way.
  await page.locator('.quiz-index-select').selectOption('16v10');

  let differ = 0;
  for (let i = 0; i < 6 && differ < 2; i++) {
    // Double is never the play on a hard 16, so this is a guaranteed miss
    // without the test having to know which side of the index we are on.
    const double = page.locator('.action-bar button.action-btn', { hasText: 'Double' });
    if (!(await double.isEnabled().catch(() => false))) break;
    await double.click();
    await expect(page.locator('.mistake-card, .message-strip .result-correct').first()).toBeVisible();
    if (!(await page.locator('.mistake-card').count())) {
      await page.locator('.drill-next-btn').first().click();
      continue;
    }

    const seen = await openTableAndRead(page);
    if (checkRelation(seen, `quiz item ${i}`) === 'differ') differ += 1;
    await page.locator('.drill-next-btn').first().click();
  }

  expect(
    differ,
    'no quiz item actually disagreed with the chart, so this test proved nothing',
  ).toBeGreaterThan(0);
});

test('a plain basic-strategy correction gets no note, because there is nothing to say', async ({
  page,
}) => {
  await withProfile(page);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Drills', exact: true }).click();
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click();
  await expect(page.locator('.drill-heading')).toHaveText('Flashcards');

  // Flashcards grade with plain basic strategy at this profile's rules, so
  // the ringed cell IS the expected play and the page must stay quiet. This
  // is the guard on the test above: a note rendered unconditionally passes
  // that one and fails this one.
  let agree = 0;
  for (let i = 0; i < 10 && agree < 3; i++) {
    const buttons = page.locator('.action-bar button.action-btn:not([disabled])');
    await expect(buttons.first()).toBeVisible();
    await buttons.first().click();
    await expect(page.locator('.mistake-card, .message-strip .result-correct').first()).toBeVisible();
    if (await page.locator('.mistake-card').count()) {
      const seen = await openTableAndRead(page);
      if (checkRelation(seen, `flashcard ${i}`) === 'agree') agree += 1;
    }
    await page.locator('.drill-next-btn').first().click();
  }

  expect(
    agree,
    'never reached a correction whose chart cell matched the grade, so the quiet case went untested',
  ).toBeGreaterThan(0);
});
