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

  it('a second requestWakeLock() does not orphan the first sentinel', async () => {
    // CountDrillView calls requestWakeLock() on every round start while
    // eyes-free is on. Overwriting `sentinel` left the previous lock
    // unreachable, so releaseWakeLock() freed only the last one and the
    // screen never slept again -- a battery drain in the exact car-mount
    // scenario this module exists for.
    const firstRelease = vi.fn().mockResolvedValue(undefined);
    requestMock.mockResolvedValueOnce({
      release: firstRelease,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const { requestWakeLock, releaseWakeLock, isWakeLockActive } = await freshModule();
    await requestWakeLock();
    await requestWakeLock();

    // Either it reused the held lock, or it released the old one first.
    // What must never happen is two live locks and only one released.
    await releaseWakeLock();
    expect(isWakeLockActive()).toBe(false);
    const acquired = requestMock.mock.calls.length;
    const released = firstRelease.mock.calls.length + releaseMock.mock.calls.length;
    expect(released).toBe(acquired);
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

  /**
   * The defect two reviewers found independently, in one test.
   *
   * `wanted` was a single boolean, so whoever released last won. The field test
   * holds for its whole 22-step run; `useVoiceControl` holds only while the
   * recogniser is up. At step 17 the microphone steps end, the recogniser tears
   * down, and its release cleared the flag, dropped the sentinel and removed
   * the visibilitychange re-acquire listener -- while the field test still
   * needed the screen awake and, holding via an effect with `[]` deps, never
   * asked again. Steps 17-22 ran with the display free to sleep, `ambient`
   * among them, whose five-second measuring loop stalls on a hidden page.
   */
  it('one holder releasing does not drop another holder\'s lock', async () => {
    const { requestWakeLock, releaseWakeLock, isWakeLockActive } = await freshModule();

    await requestWakeLock('field-test');
    await requestWakeLock('voice');
    expect(isWakeLockActive()).toBe(true);

    // The recogniser shuts down when the microphone steps end.
    await releaseWakeLock('voice');
    expect(
      isWakeLockActive(),
      'the recogniser going away took the screen lock with it',
    ).toBe(true);
    expect(releaseMock).not.toHaveBeenCalled();

    // Only when the run itself ends does the lock actually go.
    await releaseWakeLock('field-test');
    expect(isWakeLockActive()).toBe(false);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('releasing a key that never held is a no-op rather than a decrement', async () => {
    const { requestWakeLock, releaseWakeLock, isWakeLockActive } = await freshModule();

    await requestWakeLock('field-test');
    // An unbalanced release from somewhere else must not free someone else's
    // hold -- which is why holders is a Set of keys and not a counter.
    await releaseWakeLock('voice');
    expect(isWakeLockActive()).toBe(true);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('the same key held twice is still released once', async () => {
    const { requestWakeLock, releaseWakeLock, isWakeLockActive } = await freshModule();

    // The drill views request on every round start; they all share the default
    // key, and one release on unmount has to be enough.
    await requestWakeLock();
    await requestWakeLock();
    expect(isWakeLockActive()).toBe(true);

    await releaseWakeLock();
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
