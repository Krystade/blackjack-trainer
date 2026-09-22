import { describe, it, expect } from 'vitest';
import {
  runCarCheck,
  checksForPhase,
  nextSteps,
  PHASE_ORDER,
  type CheckDefinition,
  type CheckResult,
} from './carCheck';

function check(
  id: string,
  phase: 'speaker' | 'microphone',
  outcome: CheckResult['outcome'] = 'pass',
  onRun?: () => void,
): CheckDefinition {
  return {
    id,
    label: id,
    phase,
    run: async () => {
      onRun?.();
      return { id, outcome, summary: id };
    },
  };
}

/** A microphone whose open/closed state can be observed as checks run. */
function fakeMic() {
  const state = { open: false, transitions: [] as boolean[] };
  return {
    state,
    setMicOpen: async (open: boolean) => {
      state.open = open;
      state.transitions.push(open);
    },
    isMicOpen: () => state.open,
  };
}

describe('the two phases', () => {
  /**
   * The load-bearing invariant, and the reason the run is split at all.
   *
   * An open microphone flips the car to its hands-free profile, which takes
   * the wheel and moves phone playback to the earpiece. A speaker-phase check
   * that ran with the microphone open would be measuring the wheel under the
   * one condition known to kill it -- a test that reports a dead wheel
   * whatever the truth is.
   */
  it('never runs a speaker check with the microphone open', async () => {
    const mic = fakeMic();
    const seen: boolean[] = [];
    const checks = [
      check('ambient', 'microphone', 'pass', () => seen.push(mic.isMicOpen())),
      check('audio-out', 'speaker', 'pass', () => seen.push(mic.isMicOpen())),
      check('media-slot', 'speaker', 'pass', () => seen.push(mic.isMicOpen())),
    ];

    await runCarCheck({ checks, ...mic, log: () => {} });

    // Declaration order above is deliberately wrong; phase order must win.
    expect(seen).toEqual([false, false, true]);
  });

  it('closes the microphone again when the run ends', async () => {
    const mic = fakeMic();
    await runCarCheck({
      checks: [check('ambient', 'microphone')],
      ...mic,
      log: () => {},
    });
    expect(mic.isMicOpen()).toBe(false);
    expect(mic.state.transitions.at(-1)).toBe(false);
  });

  it('does not open the microphone at all for a speaker-only run', async () => {
    const mic = fakeMic();
    await runCarCheck({ checks: [check('audio-out', 'speaker')], ...mic, log: () => {} });
    expect(mic.state.transitions).not.toContain(true);
  });

  it('runs the speaker phase before the microphone phase', () => {
    expect(PHASE_ORDER.indexOf('speaker')).toBeLessThan(PHASE_ORDER.indexOf('microphone'));
  });

  it('sorts each check into exactly one phase', () => {
    const checks = [check('a', 'speaker'), check('b', 'microphone')];
    expect(checksForPhase(checks, 'speaker').map((c) => c.id)).toEqual(['a']);
    expect(checksForPhase(checks, 'microphone').map((c) => c.id)).toEqual(['b']);
  });
});

describe('a check that misbehaves', () => {
  /** The operator is at a roadside; a half-run that says so beats a crash. */
  it('turns a thrown check into a failure and keeps going', async () => {
    const mic = fakeMic();
    const exploding: CheckDefinition = {
      id: 'audio-out',
      label: 'boom',
      phase: 'speaker',
      run: async () => {
        throw new Error('no audio element');
      },
    };
    const run = await runCarCheck({
      checks: [exploding, check('media-slot', 'speaker')],
      ...mic,
      log: () => {},
    });

    expect(run.results.map((r) => r.id)).toEqual(['audio-out', 'media-slot']);
    expect(run.results[0]!.outcome).toBe('fail');
    expect(run.results[0]!.summary).toContain('no audio element');
    expect(run.ok).toBe(false);
  });

  /**
   * 'warn' means the check reached no verdict. It must not sink the run, or
   * "nobody pressed a button" would read the same as "the wheel is broken".
   */
  it('does not let an inconclusive check read as a failure', async () => {
    const mic = fakeMic();
    const run = await runCarCheck({
      checks: [check('wheel-press', 'speaker', 'warn')],
      ...mic,
      log: () => {},
    });
    expect(run.ok).toBe(true);
  });
});

describe('what to do next', () => {
  it('names the fix for each thing that actually failed', () => {
    const steps = nextSteps([
      { id: 'media-slot', outcome: 'fail', summary: '' },
      { id: 'audio-out', outcome: 'pass', summary: '' },
    ]);
    expect(steps.join(' ')).toContain('active media app');
    expect(steps.join(' ')).not.toContain('right source');
  });

  it('distinguishes a wheel nobody pressed from a wheel that is broken', () => {
    const steps = nextSteps([{ id: 'wheel-press', outcome: 'warn', summary: '' }]);
    expect(steps.join(' ')).toContain('No wheel button arrived');
  });

  /**
   * An all-pass run must not read as "done". Everything this tool can measure
   * passing still leaves the two questions only a drive answers.
   */
  it('says what is still unproven when everything passes', () => {
    const steps = nextSteps([{ id: 'audio-out', outcome: 'pass', summary: '' }]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toContain('needs a drive');
  });
});
