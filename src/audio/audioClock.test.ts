import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getLiveAudioContext,
  markAudioClockSuspect,
  onAudioContextReplaced,
  _resetSharedAudioContextForTest,
} from './audioContext';
import { readDiagnosticLog, clearDiagnosticLog } from '../diag/diagnosticLog';

/**
 * 2026-10-07, parked in the car: back from 46s in the background, every Web
 * Audio line ended on its watchdog while the context said 'running'. Its clock
 * was not moving. These pin the repair: notice the stopped clock, nudge it,
 * and replace the context if the nudge does not take.
 */
let made: FakeCtx[] = [];
class FakeCtx {
  state = 'running';
  sampleRate = 48000;
  destination = {};
  closed = false;
  /** Frozen unless `moving`; `nudgeFixes` makes suspend+resume restart it. */
  moving = true;
  nudgeFixes = false;
  private t = 0;
  private wall = Date.now();
  constructor() {
    made.push(this);
  }
  get currentTime() {
    if (this.moving) {
      const now = Date.now();
      this.t += (now - this.wall) / 1000;
      this.wall = now;
    }
    return this.t;
  }
  async suspend() {}
  async resume() {
    if (this.nudgeFixes) {
      this.wall = Date.now();
      this.moving = true;
    }
  }
  async close() {
    this.closed = true;
  }
}

describe('a context whose clock has stopped', () => {
  beforeEach(() => {
    made = [];
    _resetSharedAudioContextForTest();
    clearDiagnosticLog();
    (globalThis as any).window = { AudioContext: FakeCtx };
  });
  afterEach(() => {
    _resetSharedAudioContextForTest();
    delete (globalThis as any).window;
  });

  it('keeps a context whose clock moves', async () => {
    const ctx = await getLiveAudioContext();
    expect(ctx).toBe(made[0]);
    expect(made).toHaveLength(1);
  });

  it('restarts a stopped clock with suspend and resume when that is enough', async () => {
    const first = (await getLiveAudioContext()) as unknown as FakeCtx;
    first.moving = false;
    first.nudgeFixes = true;
    markAudioClockSuspect('test');
    const again = await getLiveAudioContext();
    expect(again).toBe(first);
    expect(readDiagnosticLog().some((e) => e.event === 'audio-clock-restarted')).toBe(true);
  });

  it('replaces the context when the clock stays stopped, and tells the caches', async () => {
    const first = (await getLiveAudioContext()) as unknown as FakeCtx;
    first.moving = false;
    let told = 0;
    const off = onAudioContextReplaced(() => (told += 1));
    markAudioClockSuspect('test');
    const fresh = await getLiveAudioContext();
    off();
    expect(fresh).not.toBe(first);
    expect(first.closed).toBe(true);
    expect(told).toBe(1);
    expect(readDiagnosticLog().some((e) => e.event === 'audio-context-replaced')).toBe(true);
  });

  it('notices a stopped clock passively, from the last sample, without being told', async () => {
    const first = (await getLiveAudioContext()) as unknown as FakeCtx;
    first.moving = false;
    await new Promise((r) => setTimeout(r, 150));
    const fresh = await getLiveAudioContext();
    expect(fresh).not.toBe(first);
    expect(readDiagnosticLog().some((e) => e.event === 'audio-clock-stopped')).toBe(true);
  });
});
