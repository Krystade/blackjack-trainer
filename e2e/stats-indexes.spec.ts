import { test, expect, type Page } from '@playwright/test';
import { withProfile, withStats, statsTab, shot, openStats as openStatsTab } from './helpers';
import { activeIndices } from '../src/ui/screens/readiness';
import type { RuleSet } from '../src/engine/ruleset';

/**
 * Wave E, E7 (W2-16): Stats' Indexes table. Worst first, the published
 * wording, accuracy, Early (index play taken short of the index) and Late
 * (index reached, chart play taken anyway); unanswered indexes are one line.
 */

test.use({ viewport: { width: 375, height: 812 } });

const INSET = ':root { --safe-top: 47px; --safe-bottom: 34px; }';
// withProfile's default rules.
const RULES: RuleSet = { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false };
const ASKED = activeIndices(RULES);

type Tally = { right: number; wrong: number };
type Dir = { early: number; late: number; offTally?: number };

// The table's slice. 12v2 was only ever a phantom at the table (off the
// perIndex tally); 16v10 has one such phantom on top of its tally.
const TABLE: Record<string, Tally> = {
  '16v10': { right: 6, wrong: 2 },
  '12v3': { right: 1, wrong: 3 },
  '9v2': { right: 3, wrong: 0 },
  TTv6: { right: 1, wrong: 1 },
};
const TABLE_DIR: Record<string, Dir> = {
  '16v10': { early: 2, late: 1, offTally: 1 },
  '12v3': { early: 0, late: 3 },
  TTv6: { early: 1, late: 0 },
  '12v2': { early: 1, late: 0, offTally: 1 },
};
// Pooled = table + drills. The drills add 16v10 (one early, one late) and two
// Index-test misses on insurance, which are wrong with no direction.
const POOLED: Record<string, Tally> = { ...TABLE, '16v10': { right: 8, wrong: 4 }, ins: { right: 0, wrong: 2 } };
const POOLED_DIR: Record<string, Dir> = { ...TABLE_DIR, '16v10': { early: 3, late: 2, offTally: 1 } };

function expectedRows(tally: Record<string, Tally>, dir: Record<string, Dir>) {
  return ASKED.map((d) => {
    const t = tally[d.id] ?? { right: 0, wrong: 0 };
    const x = dir[d.id] ?? { early: 0, late: 0 };
    const wrong = t.wrong + (x.offTally ?? 0);
    return { id: d.id, right: t.right, answered: t.right + wrong, early: x.early, late: x.late };
  })
    .filter((r) => r.answered > 0)
    .map((r) => ({ ...r, acc: r.right / r.answered }));
}

async function openStats(page: Page): Promise<void> {
  await withProfile(page);
  await withStats(page, { perIndex: POOLED, tablePerIndex: TABLE, indexDirection: POOLED_DIR, tableIndexDirection: TABLE_DIR });
  await page.goto('/?e2e=1');
  await page.addStyleTag({ content: INSET });
  await openStatsTab(page);
  await expect(page.getByTestId('you-seg-stats')).toHaveAttribute('aria-selected', 'true');
}

async function readRows(page: Page, testId: string) {
  return page.getByTestId(testId).locator('tbody tr').evaluateAll((trs) =>
    trs.map((tr) => ({
      id: tr.getAttribute('data-index-id'),
      pct: (tr.querySelector('.index-dir-pct')?.textContent ?? '').trim(),
      frac: (tr.querySelector('.index-dir-frac')?.textContent ?? '').trim(),
      early: Number(tr.querySelector('[data-col="early"]')?.textContent),
      late: Number(tr.querySelector('[data-col="late"]')?.textContent),
      label: (tr.querySelector('td')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
    })),
  );
}

test('E7: Play > Indexes lists the seeded indexes worst first with Early and Late', async ({ page }) => {
  await openStats(page);
  const section = page.locator('details.stats-section').filter({ has: page.locator('summary', { hasText: /^Indexes$/ }) });
  await expect(section).toHaveCount(1);
  await expect(section).toBeVisible();
  const table = page.getByTestId('play-index-table');
  await expect(table.locator('thead th')).toHaveText(['Index', 'Accuracy', 'Early', 'Late']);

  const want = expectedRows(TABLE, TABLE_DIR);
  const got = await readRows(page, 'play-index-table');
  expect(got).toHaveLength(want.length);
  // Ascending accuracy, read off the seed rather than restated.
  const accs = got.map((r) => want.find((w) => w.id === r.id)!.acc);
  for (let i = 1; i < accs.length; i++) expect(accs[i]!, `${got[i - 1]!.id} before ${got[i]!.id}`).toBeGreaterThanOrEqual(accs[i - 1]!);
  expect(got.map((r) => r.id)).toEqual(['12v2', '12v3', 'TTv6', '16v10', '9v2']);
  for (const row of got) {
    const w = want.find((x) => x.id === row.id)!;
    expect(row.early, `${row.id} early`).toBe(w.early);
    expect(row.late, `${row.id} late`).toBe(w.late);
    expect(row.frac, `${row.id} fraction`).toBe(`${w.right}/${w.answered}`);
    expect(row.pct, `${row.id} accuracy`).toBe(`${Math.round(w.acc * 100)}%`);
    // The published wording (R6), as the index set prints it.
    const label = ASKED.find((d) => d.id === row.id)!.label.replace(': ', ' ');
    expect(row.label).toBe(label);
  }

  // No dash rows: unanswered indexes are one line.
  await expect(table).not.toContainText('—');
  await expect(table.getByTestId('index-unseen')).toHaveText(`${ASKED.length - want.length} not seen yet`);

  // Four columns that fit 375px with no sideways scroll.
  await section.scrollIntoViewIfNeeded();
  const fit = await table.locator('table').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { right: r.right, left: r.left, overflow: el.scrollWidth - el.clientWidth, cols: el.querySelectorAll('thead th').length };
  });
  expect(fit.cols).toBe(4);
  expect(fit.left).toBeGreaterThanOrEqual(0);
  expect(fit.right).toBeLessThanOrEqual(375);
  expect(fit.overflow).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  // ...and the Index column is not crushed to fit them: every hand reads on
  // one line, and so does each of these short published lines.
  const lines = await table.locator('tbody td:first-child').evaluateAll((tds) =>
    tds.map((td) => {
      const oneLine = (el: Element | null) => {
        if (!el) return true;
        const h = el.getBoundingClientRect().height;
        return h <= parseFloat(getComputedStyle(el).fontSize) * 1.6;
      };
      return { hand: oneLine(td.querySelector('.index-dir-hand')), play: oneLine(td.querySelector('.index-dir-play')), w: td.getBoundingClientRect().width };
    }),
  );
  for (const l of lines) {
    expect(l.hand).toBe(true);
    expect(l.play).toBe(true);
    expect(l.w).toBeGreaterThanOrEqual(140);
  }
  await table.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, 'e7-play-indexes');
});

test('E7: Drills > Deviation quiz uses the same table; an Index-test miss is wrong with no direction', async ({ page }) => {
  await openStats(page);
  await statsTab(page, 'Drills');
  const table = page.getByTestId('drill-index-table');
  await expect(table).toBeVisible();
  const got = await readRows(page, 'drill-index-table');
  // Drill slice = pooled minus table: 16v10 2/4 with one early and one late,
  // insurance 0/2 from Index-test misses with neither.
  expect(got.map((r) => r.id)).toEqual(['ins', '16v10']);
  expect(got[0]).toMatchObject({ pct: '0%', frac: '0/2', early: 0, late: 0 });
  expect(got[1]).toMatchObject({ pct: '50%', frac: '2/4', early: 1, late: 1 });
  await expect(table).not.toContainText('—');
  await expect(table.getByTestId('index-unseen')).toHaveText(`${ASKED.length - 2} not seen yet`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await table.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, 'e7-drill-indexes');
});

test('E7: with no table answers Play > Indexes is the one not-seen line', async ({ page }) => {
  await withProfile(page);
  await page.goto('/?e2e=1');
  await openStatsTab(page);
  const table = page.getByTestId('play-index-table');
  // Stats is lazy: the not-seen line proves the card rendered first.
  await expect(table.getByTestId('index-unseen')).toHaveText(`${ASKED.length} not seen yet`);
  await expect(table.locator('table')).toHaveCount(0);
});
