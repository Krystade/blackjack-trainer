import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openMicStream } from './openMicStream';
import { micSessionCostPaid, _resetMicSessionCostForTest } from './micSessionCost';

describe('openMicStream', () => {
  const realNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  beforeEach(() => _resetMicSessionCostForTest());
  afterEach(() => {
    _resetMicSessionCostForTest();
    if (realNav) Object.defineProperty(globalThis, 'navigator', realNav);
    else delete (globalThis as any).navigator;
  });

  function setNav(getUserMedia: () => Promise<unknown>) {
    Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia } }, configurable: true });
  }

  it('marks the mic as opened once getUserMedia resolves', async () => {
    const stream = {};
    setNav(vi.fn(async () => stream));
    expect(micSessionCostPaid()).toBe(false);
    await expect(openMicStream({ audio: true })).resolves.toBe(stream);
    expect(micSessionCostPaid()).toBe(true);
  });

  it('does not mark when permission is refused', async () => {
    setNav(
      vi.fn(async () => {
        throw new Error('NotAllowedError');
      }),
    );
    await expect(openMicStream({ audio: true })).rejects.toThrow();
    expect(micSessionCostPaid()).toBe(false);
  });
});
