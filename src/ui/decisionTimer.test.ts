import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDecisionTimer, holdWhileSpeaking, SPEECH_POLL_MS } from './decisionTimer';

/**
 * F5 (W2-17): Play decision timing. Fake timers drive both the clock (the
 * timer's default reads performance.now) and the speech poll.
 */
describe('decision timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('measures from start to take', () => {
    const t = createDecisionTimer();
    expect(t.elapsed()).toBeNull();
    t.start();
    vi.advanceTimersByTime(1800);
    expect(t.take()).toBe(1800);
    // Taken: nothing is running until the next decision starts.
    expect(t.take()).toBeNull();
  });

  it('a new start drops the previous decision', () => {
    const t = createDecisionTimer();
    t.start();
    vi.advanceTimersByTime(5000);
    t.start();
    vi.advanceTimersByTime(700);
    expect(t.take()).toBe(700);
  });

  it('clear drops the decision without a result', () => {
    const t = createDecisionTimer();
    t.start();
    vi.advanceTimersByTime(900);
    t.clear();
    expect(t.take()).toBeNull();
  });

  it('time the app spends speaking is not counted', () => {
    let speaking = false;
    const t = createDecisionTimer();
    const stop = holdWhileSpeaking(t, () => speaking);
    t.start();
    vi.advanceTimersByTime(1000); // thinking: counted
    speaking = true; // the correction for the last hand is read out
    vi.advanceTimersByTime(2500);
    speaking = false;
    vi.advanceTimersByTime(500); // counted
    const ms = t.take()!;
    // Each edge is known to within one poll.
    expect(ms).toBeGreaterThanOrEqual(1500 - SPEECH_POLL_MS);
    expect(ms).toBeLessThanOrEqual(1500 + SPEECH_POLL_MS);
    stop();
  });

  it('a prompt still being spoken when the hand is dealt holds the decision from its start', () => {
    let speaking = true;
    const t = createDecisionTimer();
    const stop = holdWhileSpeaking(t, () => speaking);
    t.start();
    vi.advanceTimersByTime(3000); // "You have sixteen. Dealer shows ten."
    speaking = false;
    vi.advanceTimersByTime(1200);
    const ms = t.take()!;
    expect(ms).toBeGreaterThanOrEqual(1200 - SPEECH_POLL_MS);
    expect(ms).toBeLessThanOrEqual(1200 + SPEECH_POLL_MS);
    stop();
  });

  it('without the speech hold, the same speaking time is counted', () => {
    // The control for the two cases above: not eyes-free, nothing is held.
    const t = createDecisionTimer();
    t.start();
    vi.advanceTimersByTime(4000);
    expect(t.take()).toBe(4000);
  });

  it('a modal over the hand is held, and overlapping holds release only together', () => {
    const t = createDecisionTimer();
    t.start();
    vi.advanceTimersByTime(400);
    t.hold('modal', true);
    vi.advanceTimersByTime(1000);
    t.hold('speech', true);
    vi.advanceTimersByTime(1000);
    t.hold('modal', false); // speech still holds
    vi.advanceTimersByTime(1000);
    t.hold('speech', false);
    vi.advanceTimersByTime(600);
    expect(t.take()).toBe(1000);
  });

  it('stopping the speech watch releases its hold', () => {
    const speaking = true;
    const t = createDecisionTimer();
    const stop = holdWhileSpeaking(t, () => speaking);
    t.start();
    vi.advanceTimersByTime(1000);
    stop();
    vi.advanceTimersByTime(800);
    expect(t.take()).toBe(800);
  });
});
