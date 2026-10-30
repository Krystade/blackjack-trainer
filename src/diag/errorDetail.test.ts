import { describe, it, expect } from 'vitest';
import { rejectionDetail, windowErrorDetail } from './environment';

describe('D18: error lines that map back to source', () => {
  it('a window error carries its column and stack, not only line 1', () => {
    const error = new Error('boom');
    const d = windowErrorDetail({ message: 'Uncaught Error: boom', filename: 'https://x/assets/index-abc.js', lineno: 1, colno: 48213, error });
    expect(d).toMatchObject({ message: 'Uncaught Error: boom', source: 'https://x/assets/index-abc.js', line: 1, col: 48213 });
    expect(typeof d.stack).toBe('string');
    expect(d.stack as string).toContain('boom');
  });

  it('a non-Error throw still logs, without a stack', () => {
    const d = windowErrorDetail({ message: 'Script error.', lineno: 0, colno: 0, error: null });
    expect(d.col).toBe(0);
    expect(d.stack).toBeUndefined();
  });

  it('an unhandled rejection keeps its stack as a string', () => {
    const d = rejectionDetail(new TypeError('x is undefined'));
    expect(d.reason).toBe('TypeError: x is undefined');
    expect(d.stack as string).toContain('x is undefined');
    expect(rejectionDetail('plain').stack).toBeUndefined();
  });

  it('caps a long stack', () => {
    const e = new Error('long');
    e.stack = 'x'.repeat(5000);
    expect((rejectionDetail(e).stack as string).length).toBe(1500);
  });
});
