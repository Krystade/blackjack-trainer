import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getSharedAudioContext,
  ensureContextRunning,
  installAudioContextKeepAlive,
  _resetSharedAudioContextForTest,
} from './audioContext';
import { readDiagnosticLog, clearDiagnosticLog } from '../diag/diagnosticLog';

describe('audio context keep-alive', () => {
  let listeners: Record<string, ((e?: unknown) => void)[]>;
  let docListeners: Record<string, (() => void)[]>;
  let resumes: number;
  let visibility: string;

  beforeEach(() => {
    _resetSharedAudioContextForTest();
    clearDiagnosticLog();
    listeners = {};
    docListeners = {};
    resumes = 0;
    visibility = 'visible';
    class FakeCtx {
      state: string = 'suspended';
      async resume() {
        resumes++;
        this.state = 'running';
      }
    }
    (globalThis as any).window = {
      AudioContext: FakeCtx,
      addEventListener: (t: string, f: () => void) => (listeners[t] ??= []).push(f),
      removeEventListener: (t: string, f: () => void) => {
        listeners[t] = (listeners[t] ?? []).filter((x) => x !== f);
      },
    };
    (globalThis as any).document = {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (t: string, f: () => void) => (docListeners[t] ??= []).push(f),
      removeEventListener: () => {},
    };
  });
  afterEach(() => {
    _resetSharedAudioContextForTest();
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });

  it('ensureContextRunning resumes a suspended context and logs it', async () => {
    const ctx = getSharedAudioContext()!;
    await expect(ensureContextRunning(ctx)).resolves.toBe(true);
    expect(resumes).toBe(1);
    expect(readDiagnosticLog().some((e) => e.event === 'audio-resume' && e.detail?.ok === true)).toBe(true);
  });

  it('ensureContextRunning reports false when resume never settles', async () => {
    vi.useFakeTimers();
    const ctx = getSharedAudioContext()!;
    ctx.resume = () => new Promise(() => {});
    const p = ensureContextRunning(ctx);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(p).resolves.toBe(false);
    vi.useRealTimers();
  });

  it('resumes on the next pointerdown after an interruption, every time', async () => {
    const ctx = getSharedAudioContext()! as any;
    installAudioContextKeepAlive();
    listeners['pointerdown']![0]!();
    await vi.waitFor(() => expect(resumes).toBe(1));
    ctx.state = 'interrupted';
    listeners['pointerdown']![0]!();
    await vi.waitFor(() => expect(resumes).toBe(2));
  });

  it('resumes when the page becomes visible or is shown again, but not while hidden or already running', async () => {
    const ctx = getSharedAudioContext()! as any;
    installAudioContextKeepAlive();
    visibility = 'hidden';
    docListeners['visibilitychange']![0]!();
    expect(resumes).toBe(0);
    visibility = 'visible';
    docListeners['visibilitychange']![0]!();
    await vi.waitFor(() => expect(resumes).toBe(1));
    docListeners['visibilitychange']![0]!();
    expect(resumes).toBe(1);
    ctx.state = 'suspended';
    listeners['pageshow']![0]!();
    await vi.waitFor(() => expect(resumes).toBe(2));
  });

  it('does not create a context just to resume it', () => {
    installAudioContextKeepAlive();
    listeners['pointerdown']![0]!();
    expect(resumes).toBe(0);
  });
});
