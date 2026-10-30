import { describe, it, expect } from 'vitest';
import type { SpeakOutcome } from '../audio/speech';
import { startResumeProbe, resumeProbeDelayMs } from './resumeProbe';
import probeView from '../ui/screens/drills/CountDrillView.tsx?raw';

function harness() {
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  const pending: Array<(o: SpeakOutcome) => void> = [];
  const calls = { stops: 0, heard: 0, logs: [] as Array<{ outcome: SpeakOutcome; attempt: number }> };
  const probe = startResumeProbe({
    say: () => new Promise<SpeakOutcome>((r) => pending.push(r)),
    stopSpeech: () => {
      calls.stops += 1;
    },
    schedule: (fn, ms) => {
      timers.set(next, { fn, ms });
      return next++;
    },
    cancel: (id) => {
      timers.delete(id);
    },
    onHeard: () => {
      calls.heard += 1;
    },
    log: (d) => calls.logs.push(d),
  });
  const fire = () => {
    const [id, t] = [...timers.entries()][0]!;
    timers.delete(id);
    t.fn();
    return t.ms;
  };
  const settle = async (o: SpeakOutcome) => {
    pending.shift()!(o);
    await Promise.resolve();
    await Promise.resolve();
  };
  return { probe, timers, calls, fire, settle };
}

describe('the resume probe', () => {
  it('a resume while a probe line is in flight stops that line', () => {
    const h = harness();
    h.fire();
    h.probe.stop();
    expect(h.calls.stops).toBe(1);
  });

  it('a resume between attempts stops nothing that is not its own', () => {
    const h = harness();
    h.probe.stop();
    expect(h.calls.stops).toBe(0);
    expect(h.timers.size).toBe(0);
  });

  it('a heard line resumes, and the stop that follows cuts nothing', async () => {
    const h = harness();
    h.fire();
    await h.settle('spoken');
    expect(h.calls.heard).toBe(1);
    h.probe.stop();
    expect(h.calls.stops).toBe(0);
  });

  it('the count view runs the probe through this module and stops it on cleanup', () => {
    expect(probeView).toMatch(/startResumeProbe\(/);
    expect(probeView).toMatch(/stopSpeech: \(\) => cancelSpeech\(\)/);
  });

  it('backs off 4 s, 8 s, 16 s, then every 30 s', async () => {
    const h = harness();
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      delays.push(h.fire());
      await h.settle('unheard');
    }
    expect(delays).toEqual([4000, 8000, 16000, 30000, 30000, 30000, 30000]);
    expect([0, 1, 2, 3, 50].map(resumeProbeDelayMs)).toEqual([4000, 8000, 16000, 30000, 30000]);
  });

  it('logs at most one line per attempt group, so a long outage cannot flood the log', async () => {
    const h = harness();
    for (let i = 0; i < 200; i++) {
      h.fire();
      await h.settle('unheard');
    }
    // Groups double: attempts 1, 2, 3-4, 5-8, ... 129-256 -> 9 lines for 200.
    expect(h.calls.logs.length).toBeLessThanOrEqual(9);
    expect(h.calls.logs.length).toBeGreaterThanOrEqual(1);
    expect(h.calls.logs[h.calls.logs.length - 1]).toMatchObject({ outcome: 'unheard' });
    expect(typeof h.calls.logs[h.calls.logs.length - 1]!.attempt).toBe('number');
  });
});
