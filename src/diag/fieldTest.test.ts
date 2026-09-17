import { describe, it, expect, beforeEach } from 'vitest';
import {
  FIELD_TEST_CONDITIONS,
  FIELD_TEST_STEPS,
  DEFAULT_FIELD_TEST_CONDITION,
  stampFieldTest,
} from './fieldTest';
import { readDiagnosticLog, clearDiagnosticLog } from './diagnosticLog';

describe('the protocol itself', () => {
  it('has unique step ids, because the log is keyed on them', () => {
    const ids = FIELD_TEST_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique condition ids for the same reason', () => {
    const ids = FIELD_TEST_CONDITIONS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('opens on a condition that exists', () => {
    expect(FIELD_TEST_CONDITIONS.map((c) => c.id)).toContain(DEFAULT_FIELD_TEST_CONDITION);
  });

  /**
   * Every step is an instruction, a stamp and an expectation. A step missing
   * the third is the failure this whole panel exists to prevent: something
   * done in the car that nobody can check against the log afterwards.
   */
  it('tells you what to do, what to press, and what should show up', () => {
    for (const step of FIELD_TEST_STEPS) {
      expect(step.instruction.length, step.id).toBeGreaterThan(0);
      expect(step.stamp.length, step.id).toBeGreaterThan(0);
      expect(step.expect.length, step.id).toBeGreaterThan(0);
    }
  });

  /**
   * Order is load-bearing: opening the microphone is what takes the wheel
   * away, so every wheel step that is supposed to WORK has to come first.
   */
  it('tests the wheel before it opens the microphone', () => {
    const order = FIELD_TEST_STEPS.map((s) => s.id);
    expect(order.indexOf('press-forward')).toBeLessThan(order.indexOf('spoke'));
    expect(order.indexOf('press-back')).toBeLessThan(order.indexOf('spoke'));
    // ...and the one that is expected to fail comes after, on purpose.
    expect(order.indexOf('wheel-after-mic')).toBeGreaterThan(order.indexOf('spoke'));
  });

  it('keeps the speakerphone control condition, which is the whole comparison', () => {
    expect(FIELD_TEST_CONDITIONS.map((c) => c.id)).toContain('speakerphone');
  });
});

describe('stamping an intent', () => {
  beforeEach(() => {
    clearDiagnosticLog();
  });

  it('writes the step and the condition it was run under', () => {
    stampFieldTest('press-forward', 'car');
    const entry = readDiagnosticLog().find((e) => e.category === 'test');
    expect(entry?.event).toBe('press-forward');
    expect(entry?.detail?.condition).toBe('car');
  });

  it('carries the condition on every stamp, not once per run', () => {
    // A run gets abandoned and restarted and the log survives reloads, so a
    // condition written once would be read against the wrong half of the file.
    stampFieldTest('press-forward', 'car');
    stampFieldTest('press-back', 'speakerphone');
    const conditions = readDiagnosticLog()
      .filter((e) => e.category === 'test')
      .map((e) => e.detail?.condition);
    expect(conditions).toEqual(['car', 'speakerphone']);
  });
});
