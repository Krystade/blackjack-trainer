import { expect, test, describe } from 'vitest';
import { parseCvcxRamp } from './cvcxParse';

describe('parseCvcxRamp', () => {
  describe('valid inputs', () => {
    test('parses simple unit table (integer units)', () => {
      const text = `-1	1
0	2
2	4
5	8`;
      const result = parseCvcxRamp(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toEqual([
          { minTc: -1, units: 1 },
          { minTc: 0, units: 2 },
          { minTc: 2, units: 4 },
          { minTc: 5, units: 8 },
        ]);
      }
    });

    test('parses dollar amounts with unitDollars', () => {
      const text = `-1	$10
0	$20
2	$40`;
      const result = parseCvcxRamp(text, 10);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toEqual([
          { minTc: -1, units: 1 },
          { minTc: 0, units: 2 },
          { minTc: 2, units: 4 },
        ]);
      }
    });

    test('parses fractional-unit dollar amounts', () => {
      const text = `-1	$10
0	$15
2	$20`;
      const result = parseCvcxRamp(text, 10);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toEqual([
          { minTc: -1, units: 1 },
          { minTc: 0, units: 1.5 },
          { minTc: 2, units: 2 },
        ]);
      }
    });

    test('parses tab-separated columns', () => {
      const text = `1	2
2	4
3	8`;
      const result = parseCvcxRamp(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toHaveLength(3);
      }
    });

    test('parses space-separated columns', () => {
      const text = `1   2
2   4
3   8`;
      const result = parseCvcxRamp(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toHaveLength(3);
      }
    });

    test('parses comma-separated columns', () => {
      const text = `1,2
2,4
3,8`;
      const result = parseCvcxRamp(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toHaveLength(3);
      }
    });

    test('skips optional header row (non-numeric first line)', () => {
      const text = `TC	Bet
1	2
2	4
3	8`;
      const result = parseCvcxRamp(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toEqual([
          { minTc: 1, units: 2 },
          { minTc: 2, units: 4 },
          { minTc: 3, units: 8 },
        ]);
      }
    });

    test('normalizes TC decorations: "TC 2" -> 2', () => {
      const text = `TC 1	2
TC 2	4`;
      const result = parseCvcxRamp(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toEqual([
          { minTc: 1, units: 2 },
          { minTc: 2, units: 4 },
        ]);
      }
    });

    test('normalizes TC decorations: "+3" -> 3', () => {
      const text = `+1	2
+2	4`;
      const result = parseCvcxRamp(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toEqual([
          { minTc: 1, units: 2 },
          { minTc: 2, units: 4 },
        ]);
      }
    });

    test('normalizes TC decorations: "3+" -> 3', () => {
      const text = `1+	2
2+	4`;
      const result = parseCvcxRamp(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toEqual([
          { minTc: 1, units: 2 },
          { minTc: 2, units: 4 },
        ]);
      }
    });

    test('normalizes TC decorations: "≤ -1" -> -1', () => {
      const text = `≤ -1	1
≤ 0	2`;
      const result = parseCvcxRamp(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toEqual([
          { minTc: -1, units: 1 },
          { minTc: 0, units: 2 },
        ]);
      }
    });

    test('normalizes TC decorations: "<= -1" -> -1', () => {
      const text = `<= -1	1
<= 0	2`;
      const result = parseCvcxRamp(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toEqual([
          { minTc: -1, units: 1 },
          { minTc: 0, units: 2 },
        ]);
      }
    });

    test('skips blank lines', () => {
      const text = `1	2

2	4

3	8`;
      const result = parseCvcxRamp(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toHaveLength(3);
      }
    });

    test('sorts output ascending by minTc', () => {
      const text = `5	8
1	2
2	4`;
      const result = parseCvcxRamp(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toEqual([
          { minTc: 1, units: 2 },
          { minTc: 2, units: 4 },
          { minTc: 5, units: 8 },
        ]);
      }
    });

    test('handles negative TCs', () => {
      const text = `-5	1
-3	2
0	4`;
      const result = parseCvcxRamp(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toEqual([
          { minTc: -5, units: 1 },
          { minTc: -3, units: 2 },
          { minTc: 0, units: 4 },
        ]);
      }
    });

    test('handles dollar sign before amount', () => {
      const text = `-1	$10
0	$20`;
      const result = parseCvcxRamp(text, 10);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toHaveLength(2);
      }
    });

    test('handles dollar sign after amount', () => {
      const text = `-1	10$
0	20$`;
      const result = parseCvcxRamp(text, 10);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toHaveLength(2);
      }
    });
  });

  describe('error cases', () => {
    test('rejects dollar amounts without unitDollars', () => {
      const text = `1	$10
2	$20`;
      const result = parseCvcxRamp(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Dollar amounts found');
        expect(result.error).toContain('unit size');
      }
    });

    test('rejects non-clean 0.5 multiple dollar amounts', () => {
      const text = `1	$13
2	$20`;
      const result = parseCvcxRamp(text, 10);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Line');
      }
    });

    test('reports line number for unparseable TC', () => {
      const text = `1	2
invalid	4
3	8`;
      const result = parseCvcxRamp(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/Line 2/);
        expect(result.error).toContain('could not parse');
      }
    });

    test('reports line number for unparseable bet', () => {
      const text = `1	2
2	invalid`;
      const result = parseCvcxRamp(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/Line 2/);
        expect(result.error).toContain('could not parse');
      }
    });

    test('rejects duplicate minTc with line numbers', () => {
      const text = `1	2
2	4
2	6`;
      const result = parseCvcxRamp(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('duplicate TC 2');
        expect(result.error).toMatch(/Line/);
      }
    });

    test('rejects empty input', () => {
      const result = parseCvcxRamp('');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('No rows found');
      }
    });

    test('rejects whitespace-only input', () => {
      const result = parseCvcxRamp('   \n  \n  ');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('No rows found');
      }
    });

    test('rejects input with only header row', () => {
      const result = parseCvcxRamp('TC	Bet');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('No rows found');
      }
    });
  });

  describe('integration: complex scenarios', () => {
    test('real CVCX-like paste with mixed decorations', () => {
      const text = `≤ -1	$5
0	$10
+1	$15
TC 2	$20
3+	$25`;
      const result = parseCvcxRamp(text, 5);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toEqual([
          { minTc: -1, units: 1 },
          { minTc: 0, units: 2 },
          { minTc: 1, units: 3 },
          { minTc: 2, units: 4 },
          { minTc: 3, units: 5 },
        ]);
      }
    });

    test('real CVCX paste with header and unsorted input', () => {
      const text = `True Count,Bet
5	$50
1	$10
3	$30
2	$20`;
      const result = parseCvcxRamp(text, 10);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows).toEqual([
          { minTc: 1, units: 1 },
          { minTc: 2, units: 2 },
          { minTc: 3, units: 3 },
          { minTc: 5, units: 5 },
        ]);
      }
    });
  });
});
