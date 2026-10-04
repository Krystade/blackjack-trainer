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

describe('next steps for the capability and handoff checks', () => {
  const r = (id: string, outcome: 'pass' | 'fail' | 'warn', detail?: Record<string, unknown>) => ({
    id,
    outcome,
    summary: '',
    ...(detail ? { detail } : {}),
  });

  it('says what a stale build means before anything else is trusted', () => {
    // The fault that silently wastes a whole drive: the fix was never on the
    // phone, and every other result was gathered from the wrong code.
    const steps = nextSteps([r('build', 'fail', { build: 'aaa', deployed: 'bbb' })]);
    expect(steps.join(' ')).toContain('aaa');
    expect(steps.join(' ')).toContain('bbb');
    expect(steps.join(' ')).toMatch(/close every tab/i);
  });

  it('tells the operator to abandon Switch when the microphone will not restart', () => {
    const steps = nextSteps([r('mic-restart', 'fail')]);
    expect(steps.join(' ')).toMatch(/Speaker or Auto/);
  });

  it('carries the restart cost into the advice when it is merely slow', () => {
    const steps = nextSteps([r('mic-restart', 'warn', { ms: 2400 })]);
    expect(steps.join(' ')).toContain('2400ms');
  });

  it('turns the two route warnings into the comparison they exist for', () => {
    /*
     * NEITHER CHECK CAN REACH A VERDICT -- only ears can -- so the advice has
     * to state the experiment rather than an outcome, and has to say what
     * BOTH answers mean. Advice that only explained the good outcome would
     * leave the operator with no reading for the bad one, which is the more
     * likely of the two.
     */
    const steps = nextSteps([r('output-route', 'warn'), r('handoff-route', 'warn')]).join(' ');
    expect(steps).toMatch(/if the second was louder/i);
    expect(steps).toMatch(/sounded the same/i);
  });

  it('says nothing about the comparison when only one of the two ran', () => {
    // Half the experiment is not the experiment, and advice that implied it
    // was would have the operator comparing a clip against nothing.
    const steps = nextSteps([r('output-route', 'warn'), r('handoff-route', 'fail')]).join(' ');
    expect(steps).not.toMatch(/if the second was louder/i);
  });

  it('still says everything passed when nothing failed', () => {
    const steps = nextSteps([r('build', 'pass'), r('wake-lock', 'pass'), r('storage', 'pass')]);
    expect(steps.join(' ')).toMatch(/needs a drive/);
  });

  it('names the screen lock, the tunnel and the private window separately', () => {
    // Three different capabilities with three different remedies. One
    // catch-all line would tell the operator to do the wrong thing twice.
    const steps = nextSteps([
      r('wake-lock', 'fail'),
      r('offline-clips', 'fail'),
      r('storage', 'fail'),
    ]);
    expect(steps).toHaveLength(3);
    expect(steps.join(' ')).toMatch(/screen locks/);
    expect(steps.join(' ')).toMatch(/Wi-Fi/);
    expect(steps.join(' ')).toMatch(/private browsing/);
  });
});
