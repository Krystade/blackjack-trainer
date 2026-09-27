import { describe, it, expect, beforeEach } from 'vitest';
import {
  invokeWheelCommand,
  setWheelCommandHandler,
  _resetWheelCommandsForTest,
} from './wheelCommands';
import { readDiagnosticLog, clearDiagnosticLog } from '../diag/diagnosticLog';

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
    expect(invokeWheelCommand('forward')).toBe(true);
    expect(seen).toEqual(['forward']);
  });

  /** A car can press a button at any time, including before anything is up. */
  it('reports an unclaimed press rather than throwing', () => {
    expect(invokeWheelCommand('forward')).toBe(false);
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
    expect(invokeWheelCommand('forward')).toBe(false);
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
    invokeWheelCommand('forward');
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
    expect(() => invokeWheelCommand('forward')).not.toThrow();
    expect(invokeWheelCommand('forward')).toBe(false);
  });
});

/**
 * What became of a press, not just that one arrived.
 *
 * `invokeWheelCommand`'s own doc comment claimed "the log records both, and a
 * press that reached nobody is itself evidence" -- and it wrote nothing,
 * while both call sites discarded its return value. So `wheel invoke` read
 * identically in an export whether a drill acted on the press or it fell on
 * an unmounted screen and vanished. That is the founding question of the
 * whole `wheel` category, and it was unanswerable from the artefact.
 */
describe('a wheel press records what happened to it', () => {
  beforeEach(() => {
    clearDiagnosticLog();
    _resetWheelCommandsForTest();
  });

  const dispatches = () =>
    readDiagnosticLog()
      .filter((e) => e.category === 'wheel' && e.event === 'dispatch')
      .map((e) => e.detail);

  it('says so when a screen handled it', () => {
    setWheelCommandHandler(() => {});
    expect(invokeWheelCommand('forward')).toBe(true);
    expect(dispatches().at(-1)).toMatchObject({ command: 'forward', handled: true });
  });

  it('says so when nothing was listening', () => {
    expect(invokeWheelCommand('forward')).toBe(false);
    expect(dispatches().at(-1)).toMatchObject({ handled: false, why: 'no-screen-listening' });
  });

  it('tells a screen that threw apart from a screen that was not there', () => {
    // Both return false, and both used to be one indistinguishable silence.
    // "The drill crashed on a press" and "no screen was listening" have
    // opposite diagnoses, and on `back` the first also falls through to
    // `repeatLast()`, so the press both half-ran and repeated.
    setWheelCommandHandler(() => {
      throw new Error('drill blew up');
    });
    expect(invokeWheelCommand('back')).toBe(false);
    const last = dispatches().at(-1);
    expect(last).toMatchObject({ handled: false, why: 'threw' });
    expect(last?.error).toContain('drill blew up');
  });
});

/**
 * L4: one press, one line.
 *
 * `speech.ts` used to call this, watch it return false, and then write its
 * OWN `wheel dispatch` entry saying `handled=true by=repeat-last`. A single
 * skip-back with nothing on screen therefore wrote
 * `handled=false why=no-screen-listening` -- the exact signature of the fault
 * under investigation -- immediately followed by a line contradicting it, and
 * a reader counting presses counted one press as two.
 */
describe('a press nothing on screen wanted', () => {
  beforeEach(() => {
    _resetWheelCommandsForTest();
    clearDiagnosticLog();
  });

  const dispatches = () =>
    readDiagnosticLog()
      .filter((e) => e.category === 'wheel' && e.event === 'dispatch')
      .map((e) => e.detail ?? {});

  it('writes one line, not two, when a fallback handles it', () => {
    let ran = 0;
    expect(invokeWheelCommand('back', { by: 'repeat-last', run: () => (ran += 1) })).toBe(false);
    expect(ran, 'the fallback never ran').toBe(1);
    const lines = dispatches();
    expect(
      lines.length,
      `one press wrote ${lines.length} dispatch lines: ${JSON.stringify(lines)}`,
    ).toBe(1);
    expect(lines[0]?.handled, 'a press that was handled is filed as unhandled').toBe(true);
    expect(lines[0]?.by).toBe('repeat-last');
    expect(
      lines[0]?.why,
      'the line still carries the bug signature it was handled in spite of',
    ).toBeUndefined();
  });

  it('still reports the press as unhandled when there is no fallback', () => {
    expect(invokeWheelCommand('back')).toBe(false);
    const lines = dispatches();
    expect(lines.length).toBe(1);
    expect(lines[0]?.handled).toBe(false);
    expect(lines[0]?.why).toBe('no-screen-listening');
  });

  it('does not run the fallback when a screen did want the press', () => {
    let ran = 0;
    const seen: string[] = [];
    setWheelCommandHandler((c) => seen.push(c));
    expect(invokeWheelCommand('back', { by: 'repeat-last', run: () => (ran += 1) })).toBe(true);
    expect(seen).toEqual(['back']);
    expect(ran, 'the fallback spoke over the screen that handled the press').toBe(0);
    expect(dispatches().length).toBe(1);
  });
});
