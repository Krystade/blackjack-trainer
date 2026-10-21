import { describe, it, expect } from 'vitest';
import {
  ALLOWED,
  deadUses,
  isAllowed,
  producible,
  realUses,
  realVocabulary,
  uses,
  vocabulary,
} from './e2eSelectors';

/**
 * A selector naming a class or test id that nothing renders cannot fail when
 * it is asserted absent. Every name an e2e selector uses must be one src can
 * produce, or be listed in e2eSelectors.ts ALLOWED with the reason it is not
 * visible to the extraction.
 */
describe('e2e selectors name what src renders', () => {
  const vocab = realVocabulary();
  const all = realUses();

  it('reads the real sources (the scan is not silently empty)', () => {
    const names = (k: 'class' | 'testid') => new Set(all.filter((u) => u.kind === k).map((u) => u.name));
    expect(names('class').size).toBeGreaterThan(250);
    expect(names('testid').size).toBeGreaterThan(200);
    expect(names('class').has('drill-screen')).toBe(true);
    expect(names('testid').has('fieldtest-screen')).toBe(true);
    expect(vocab.class.literals.has('drill-screen')).toBe(true);
    expect(vocab.testid.literals.has('fieldtest-screen')).toBe(true);
  });

  it('every class and test id an e2e selector names can be rendered', () => {
    const dead = deadUses(all, vocab).map(
      (u) => `${u.file}:${u.line} ${u.kind} ${u.name}${u.dynamic ? '${...}' : ''}`,
    );
    expect(dead, 'a selector names something src never renders -- fix the selector, or list a genuinely dynamic name in scripts/e2eSelectors.ts ALLOWED').toEqual([]);
  });

  it('every ALLOWED entry is still used and still needed (no stale exceptions)', () => {
    for (const a of ALLOWED) {
      expect(a.reason.length, `${a.name} needs a reason`).toBeGreaterThan(10);
      expect(all.some((u) => isAllowed(u) === a), `${a.name} is no longer selected by e2e`).toBe(true);
      expect(producible({ kind: a.kind, name: a.name, dynamic: false }, vocab), `${a.name} is now found statically`).toBe(false);
    }
  });

  // The four names that shipped, each in the line that held it. Any of them
  // restored must turn this suite red.
  it('flags the dead selectors that shipped before this guard', () => {
    const lines = [
      "await expect(page.locator('.flashcard, .table-felt')).toHaveCount(0);",
      "await expect(page.getByTestId('index-test-pending')).toHaveCount(0);",
      "await expect(page.locator('.drill-feedback')).toHaveCount(0);",
      "await expect(page.locator('.drill-feedback, [class*=\"feedback\"]').first()).toBeHidden();",
      "await expect(page.locator('.drill-screen, .flashcards-screen').first()).toBeVisible();",
    ];
    const dead = deadUses(uses([{ file: 'x.spec.ts', text: lines.join('\n') }]), vocab);
    expect(dead.map((u) => `${u.line} ${u.kind} ${u.name}`)).toEqual([
      '1 class flashcard',
      '1 class table-felt',
      '2 testid index-test-pending',
      '3 class drill-feedback',
      '4 class drill-feedback',
      '5 class flashcards-screen',
    ]);
  });

  it('reads class and test-id positions, and nothing else, from src', () => {
    const v = vocabulary([
      {
        file: 'x.tsx',
        text: [
          '// className="in-a-comment"',
          "const label = 'prose-word';",
          "const quadClass = (z: string) => `pad-quad pad-quad-${z}${ok ? '' : ' pad-off'}`;",
          'const a = <div className={`root${on ? \' root-on\' : \'\'}`} data-testid={`row-${id}`} />;',
          'const b = <Banner testId="banner-x" className={`${base}-body`} />;',
          "el.classList.add('from-classlist');",
        ].join('\n'),
      },
    ]);
    const can = (kind: 'class' | 'testid', name: string) => producible({ kind, name, dynamic: false }, v);
    expect(can('class', 'in-a-comment')).toBe(false);
    expect(can('class', 'prose-word')).toBe(false);
    expect(can('class', 'pad-quad')).toBe(true);
    expect(can('class', 'pad-quad-split')).toBe(true);
    expect(can('class', 'pad-off')).toBe(true);
    expect(can('class', 'root')).toBe(true);
    expect(can('class', 'root-on')).toBe(true);
    // A ternary is two spellings, not a `root*` family.
    expect(can('class', 'root-other')).toBe(false);
    // A family must start with fixed text: `${base}-body` is not `*-body`.
    expect(can('class', 'anything-body')).toBe(false);
    expect(can('class', 'from-classlist')).toBe(true);
    expect(can('testid', 'row-7')).toBe(true);
    expect(can('testid', 'banner-x')).toBe(true);
    expect(can('testid', 'root')).toBe(false);
  });
});
