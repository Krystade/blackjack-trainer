import { test, expect, type Page } from '@playwright/test';
import { withStats } from './helpers';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

/**
 * Track 1 (1A): the Drills picker reads the Home ladder. "Start here" on the
 * current step's drill, "After: X" on drills not reached yet -- labels, not
 * locks. They replace V3-4's "Advanced -- get fluent first" note.
 */

/** Every category on target, and a sweep: basic strategy and the repair rung pass, so counting is next. */
const PAST_BASIC = {
  cellStats: {
    'hard-16-v-10': { right: 30, wrong: 0, lastAt: '' },
    'soft-18-v-9': { right: 30, wrong: 0, lastAt: '' },
    'pair-8-v-A': { right: 30, wrong: 0, lastAt: '' },
  },
  masterySweepsCompleted: 1,
};

const drill = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const tag = (page: Page, name: string) => drill(page, name).locator('.drills-nav-tag');

async function openDrills(page: Page) {
  await page.goto('/?e2e=1');
  await page.locator('.tab-bar').getByRole('button', { name: 'Drills', exact: true }).click();
  await expect(page.locator('.drills-title')).toHaveText('Drills');
}

test('a fresh install: Flashcards is where to start, the later steps say what they come after', async ({ page }) => {
  await openDrills(page);
  await expect(tag(page, 'Flashcards')).toHaveText('Start here');
  await expect(tag(page, 'Flashcards')).toHaveAttribute('data-tag', 'start');
  await expect(tag(page, 'Count drill')).toHaveText('After: Mastery challenge');
  await expect(tag(page, 'Deviation quiz')).toHaveText('After: True count drill');
  await expect(tag(page, 'Bet sizing')).toHaveText('After: Deviation quiz');
  // Off the learning path: never labelled.
  await expect(tag(page, 'Rules differences')).toHaveCount(0);
  await expect(tag(page, 'Side count')).toHaveCount(0);
  // The label is part of the button's description.
  await expect(drill(page, 'Count drill')).toHaveAccessibleDescription(/After: Mastery challenge/);
  // A label, not a lock: an "After" drill still opens.
  await drill(page, 'Deviation quiz').click();
  await expect(page.locator('.drill-heading')).toHaveText('Deviation quiz');
});

test('past basic strategy: the count drill is where to start, and basic strategy carries no label', async ({ page }) => {
  await withStats(page, PAST_BASIC);
  await openDrills(page);
  await expect(tag(page, 'Count drill')).toHaveText('Start here');
  await expect(tag(page, 'Deck estimation')).toHaveText('After: Count drill');
  await expect(tag(page, 'Flashcards')).toHaveCount(0);
  await expect(tag(page, 'Mastery challenge')).toHaveCount(0);
});
