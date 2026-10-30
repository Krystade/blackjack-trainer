import { describe, it, expect } from 'vitest';
import { DecodedClipCache, bufferBytes } from './decodedClipCache';

const buf = (seconds: number) => ({ length: 48_000 * seconds, numberOfChannels: 1 });
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('DecodedClipCache (D19)', () => {
  it('counts float32 bytes per sample per channel', () => {
    expect(bufferBytes({ length: 1000, numberOfChannels: 2 })).toBe(8000);
  });

  it('evicts the least recently used once the budget is passed', async () => {
    const one = bufferBytes(buf(1));
    const c = new DecodedClipCache<ReturnType<typeof buf>>(one * 3);
    for (const u of ['a', 'b', 'c']) c.set(u, Promise.resolve(buf(1)));
    await settle();
    expect(c.size).toBe(3);
    // 'a' is used again, so 'b' is now the oldest.
    expect(c.get('a')).toBeDefined();
    c.set('d', Promise.resolve(buf(1)));
    await settle();
    expect(c.has('b')).toBe(false);
    expect(c.has('a')).toBe(true);
    expect(c.has('d')).toBe(true);
    expect(c.bytes).toBeLessThanOrEqual(one * 3);
  });

  it('stays bounded over a long session of distinct clips', async () => {
    const one = bufferBytes(buf(1));
    const c = new DecodedClipCache<ReturnType<typeof buf>>(one * 10);
    for (let i = 0; i < 500; i++) c.set(`u${i}`, Promise.resolve(buf(1)));
    await settle();
    expect(c.size).toBe(10);
    expect(c.bytes).toBe(one * 10);
  });

  it('never evicts the clip that just arrived, even alone over budget', async () => {
    const c = new DecodedClipCache<ReturnType<typeof buf>>(10);
    c.set('big', Promise.resolve(buf(1)));
    await settle();
    expect(c.has('big')).toBe(true);
  });

  it('drops a failed decode so the next attempt retries', async () => {
    const c = new DecodedClipCache<ReturnType<typeof buf>>();
    const p = Promise.reject(new Error('http-404'));
    p.catch(() => {});
    c.set('x', p);
    await settle();
    expect(c.has('x')).toBe(false);
  });

  it('clear forgets everything and its bytes', async () => {
    const c = new DecodedClipCache<ReturnType<typeof buf>>();
    c.set('a', Promise.resolve(buf(1)));
    await settle();
    c.clear();
    expect(c.size).toBe(0);
    expect(c.bytes).toBe(0);
  });
});
