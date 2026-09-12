import { describe, it, expect, beforeEach } from 'vitest';
import {
  invokeWheelCommand,
  setWheelCommandHandler,
  _resetWheelCommandsForTest,
} from './wheelCommands';

/**
 * The routing layer between the car's transport buttons and whatever drill is
 * on screen. Small, but it is the only thing standing between a wheel press and
 * an answer being recorded, so each of its guarantees is asserted rather than
 * assumed -- see the module header for why the wheel matters at all.
 */
describe('wheelCommands', () => {
  beforeEach(() => _resetWheelCommandsForTest());

  it('delivers a press to the screen that claimed it', () => {
    const seen: string[] = [];
    setWheelCommandHandler((c) => seen.push(c));
    expect(invokeWheelCommand('advance')).toBe(true);
    expect(seen).toEqual(['advance']);
  });

  /** A car can press a button at any time, including before anything is up. */
  it('reports an unclaimed press rather than throwing', () => {
    expect(invokeWheelCommand('advance')).toBe(false);
  });

  /**
   * Releasing matters more than claiming. A press delivered to a drill the
   * driver has navigated away from would either do nothing or record an answer
   * for a hand nobody is looking at.
   */
  it('goes inert once the screen releases it', () => {
    let calls = 0;
    setWheelCommandHandler(() => (calls += 1));
    setWheelCommandHandler(null);
    expect(invokeWheelCommand('advance')).toBe(false);
    expect(calls).toBe(0);
  });

  /**
   * Last claim wins, and the order is what makes the screen wiring safe: a
   * screen that renders another drill as a child would otherwise fight it for
   * the slot (React runs child effects first, so the parent would win).
   */
  it('hands the wheel to the most recent claim', () => {
    const seen: string[] = [];
    setWheelCommandHandler(() => seen.push('first'));
    setWheelCommandHandler(() => seen.push('second'));
    invokeWheelCommand('advance');
    expect(seen).toEqual(['second']);
  });

  /**
   * The driver may be relying on `pause` to shut the app up, and every Media
   * Session handler runs through the same registration -- so a screen throwing
   * must not be able to take the car's transport controls down with it.
   */
  it('contains a throwing screen instead of breaking the transport controls', () => {
    setWheelCommandHandler(() => {
      throw new Error('a drill blew up');
    });
    expect(() => invokeWheelCommand('advance')).not.toThrow();
    expect(invokeWheelCommand('advance')).toBe(false);
  });
});
