import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Module under test tracks state at module scope (sentinel, wanted flag), so
// each test re-imports a fresh copy via vi.resetModules() + dynamic import
// rather than relying on any exported reset helper.
type WakeLockModule = typeof import('./wakeLock');

async function freshModule(): Promise<WakeLockModule> {
  vi.resetModules();
  return import('./wakeLock');
}

describe('wakeLock — unsupported environment (no navigator.wakeLock)', () => {
  afterEach(() => {
    delete (navigator as { wakeLock?: unknown }).wakeLock;
  });

  it('requestWakeLock() resolves without throwing and stays inactive', async () => {
    const { requestWakeLock, isWakeLockActive } = await freshModule();
    await expect(requestWakeLock()).resolves.toBeUndefined();
    expect(isWakeLockActive()).toBe(false);
  });
});

describe('wakeLock — stubbed navigator.wakeLock', () => {
  let requestMock: ReturnType<typeof vi.fn>;
  let releaseMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    releaseMock = vi.fn().mockResolvedValue(undefined);
    requestMock = vi.fn().mockResolvedValue({
      release: releaseMock,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    (navigator as unknown as { wakeLock: unknown }).wakeLock = { request: requestMock };
  });

  afterEach(() => {
    delete (navigator as { wakeLock?: unknown }).wakeLock;
  });

  it('calls request("screen") exactly once and marks the lock active', async () => {
    const { requestWakeLock, isWakeLockActive } = await freshModule();
    await requestWakeLock();
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith('screen');
    expect(isWakeLockActive()).toBe(true);
  });

  it('releaseWakeLock() releases the sentinel and flips isWakeLockActive() back to false', async () => {
    const { requestWakeLock, releaseWakeLock, isWakeLockActive } = await freshModule();
    await requestWakeLock();
    expect(isWakeLockActive()).toBe(true);

    await releaseWakeLock();
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(isWakeLockActive()).toBe(false);
  });
});

describe('wakeLock — request() rejects (browsers reject when the tab is hidden)', () => {
  afterEach(() => {
    delete (navigator as { wakeLock?: unknown }).wakeLock;
  });

  it('swallows the rejection: requestWakeLock() resolves and stays inactive', async () => {
    const requestMock = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    (navigator as unknown as { wakeLock: unknown }).wakeLock = { request: requestMock };

    const { requestWakeLock, isWakeLockActive } = await freshModule();
    await expect(requestWakeLock()).resolves.toBeUndefined();
    expect(isWakeLockActive()).toBe(false);
  });
});
