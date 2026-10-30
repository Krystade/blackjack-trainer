import { describe, it, expect } from 'vitest';
import type { SpeakOutcome } from '../audio/speech';
import { startResumeProbe } from './resumeProbe';
import probeView from '../ui/screens/drills/CountDrillView.tsx?raw';

function harness() {
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  const pending: Array<(o: SpeakOutcome) => void> = [];
  const calls = { stops: 0, heard: 0, logs: [] as Array<{ outcome: SpeakOutcome }> };
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
});
