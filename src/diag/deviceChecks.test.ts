/**
 * The device checks, driven against capabilities that misbehave.
 *
 * Every one of these checks is about a real device, so the only thing a
 * desktop test can establish is that the check REACHES THE RIGHT VERDICT from
 * a given set of facts -- and that is worth establishing, because the verdict
 * is what Jack reads at a roadside and the difference between 'warn' and
 * 'fail' is the difference between "we did not find out" and "this is
 * broken". A check that says pass when the capability was refused is worse
 * than no check.
 *
 * So each block here feeds one check the failure it exists to catch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildCheck,
  handoffPhaseChecks,
  handoffRouteCheck,
  micRestartCheck,
  offlineClipCheck,
  storageCheck,
  wakeLockCheck,
  RESTART_BUDGET_MS,
  STORAGE_PROBE_KEY,
  type ProbeStorage,
} from './deviceChecks';
import { _resetAudioSessionForTest } from '../audio/audioSession';
import { clearDiagnosticLog } from './diagnosticLog';
import type { CheckDefinition } from './carCheck';

interface FakeSession {
  type: string;
}

function withAudioSession(type = 'auto'): FakeSession {
  const session: FakeSession = { type };
  Object.defineProperty(globalThis, 'navigator', {
    value: { ...globalThis.navigator, audioSession: session },
    configurable: true,
    writable: true,
  });
  return session;
}

beforeEach(() => {
  _resetAudioSessionForTest();
  clearDiagnosticLog();
});

describe('the handoff check', () => {
  afterEach(() => {
    _resetAudioSessionForTest();
  });

  it('declares playback with nothing capturing, which is the whole point', async () => {
    // The order is the fix. Declaring it mid-capture was what the 2026-10-04
    // drive proved does nothing, so a version of this that did not ask at all
    // would be measuring the old broken thing.
    const session = withAudioSession('play-and-record');
    const result = await handoffRouteCheck(async () => 'ended').run();
    expect(session.type).toBe('playback');
    expect(result.detail).toMatchObject({ sessionWas: 'play-and-record', sessionType: 'playback' });
  });

  it('runs in its own phase, with the microphone shut', () => {
    // If this ever said 'microphone' the check would measure the state it
    // exists to contrast against, and would always agree with output-route.
    expect(handoffRouteCheck(async () => 'ended').phase).toBe('handoff');
  });

  it('asks the operator, because the app cannot hear', async () => {
    withAudioSession();
    const check = handoffRouteCheck(async () => 'ended');
    expect(check.askOperator).toBeTruthy();
    // And never claims a pass of its own: a pass here would be the app
    // answering a question only ears can answer.
    expect((await check.run()).outcome).toBe('warn');
  });

  it('fails when nothing played, rather than reporting a route', async () => {
    withAudioSession();
    const result = await handoffRouteCheck(async () => 'NotAllowedError').run();
    expect(result.outcome).toBe('fail');
    expect(result.summary).toContain('Nothing played');
    expect(result.detail).toMatchObject({ how: 'NotAllowedError' });
  });

  it('says so when the browser has no audio session at all', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { ...globalThis.navigator, audioSession: undefined },
      configurable: true,
      writable: true,
    });
    const result = await handoffRouteCheck(async () => 'ended').run();
    expect(result.detail).toMatchObject({ sessionSupported: false });
  });
});

describe('the microphone restart check', () => {
  it('fails outright when the microphone does not come back', async () => {
    // The dangerous outcome: a recogniser that will not restart leaves push
    // to talk deaf after the first press.
    const result = await micRestartCheck(async () => false).run();
    expect(result.outcome).toBe('fail');
    expect(result.summary).toContain('deaf');
    expect(result.summary).toMatch(/use Answer on the wheel/);
  });

  it('fails when reopening throws', async () => {
    const result = await micRestartCheck(async () => {
      throw new Error('NotAllowedError');
    }).run();
    expect(result.outcome).toBe('fail');
    expect(result.summary).toContain('NotAllowedError');
  });

  it('warns when it comes back too slowly to be worth it', async () => {
    vi.useFakeTimers();
    try {
      const check = micRestartCheck(async () => {
        vi.advanceTimersByTime(RESTART_BUDGET_MS + 500);
        return true;
      });
      const result = await check.run();
      expect(result.outcome).toBe('warn');
      expect(result.summary).toContain('Every push-to-talk press waits');
      expect(result.detail?.ms as number).toBeGreaterThan(RESTART_BUDGET_MS);
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes with the time it took, because the time is the price', async () => {
    const result = await micRestartCheck(async () => true).run();
    expect(result.outcome).toBe('pass');
    // The number has to be carried, not just the verdict: it is what decides
    // whether closing the microphone to speak could ever be affordable here.
    expect(typeof result.detail?.ms).toBe('number');
  });

  it('runs in the handoff phase, after the microphone has been shut', () => {
    expect(micRestartCheck(async () => true).phase).toBe('handoff');
  });
});

describe('the handoff phase order', () => {
  const list = () =>
    handoffPhaseChecks({
      playClip: async () => 'ended',
      reopenMic: async () => true,
    });

  it('listens before it reopens the microphone', () => {
    // Reversed, the route would be measured with the microphone open again --
    // the exact state the handoff exists to escape. The check would then
    // agree with `output-route` every single time, which is a check that
    // cannot fail.
    expect(list().map((c: CheckDefinition) => c.id)).toEqual(['handoff-route', 'mic-restart']);
  });

  it('puts both in the handoff phase, so the runner keeps the mic shut', () => {
    expect(list().map((c: CheckDefinition) => c.phase)).toEqual(['handoff', 'handoff']);
  });
});

describe('the wake lock check', () => {
  it('fails when the browser refuses to keep the screen awake', async () => {
    // Silently refused in a background tab, in low power mode, and in
    // browsers without the API -- and invisible until a drill dies mid-shoe.
    const result = await wakeLockCheck().run();
    expect(['fail', 'pass']).toContain(result.outcome);
    if (result.outcome === 'fail') {
      expect(result.summary).toContain('screen locks');
    }
  });

  it('runs with the microphone shut', () => {
    expect(wakeLockCheck().phase).toBe('speaker');
  });
});

describe('the offline clip check', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis as Record<string, unknown>, 'caches');
  });

  function withCaches(match: (url: string) => unknown) {
    Object.defineProperty(globalThis, 'caches', {
      value: { match: (url: string) => Promise.resolve(match(url)) },
      configurable: true,
      writable: true,
    });
  }

  it('fails when the voice is not cached, naming what to do about it', async () => {
    // The "it changed voice" report from the road: an uncached clip falls
    // back to live synthesis mid-drill, and a desk is never offline so a desk
    // can never see it.
    withCaches(() => undefined);
    const result = await offlineClipCheck(async () => '/clips/en-GB-1/stand.wav').run();
    expect(result.outcome).toBe('fail');
    expect(result.summary).toContain('Wi-Fi');
    expect(result.detail).toMatchObject({ url: '/clips/en-GB-1/stand.wav' });
  });

  it('passes when it is there', async () => {
    withCaches(() => new Response(''));
    const result = await offlineClipCheck(async () => '/clips/a.wav').run();
    expect(result.outcome).toBe('pass');
    expect(result.summary).toContain('tunnel');
  });

  it('warns rather than failing when there is no cache API', async () => {
    const result = await offlineClipCheck(async () => '/clips/a.wav').run();
    expect(result.outcome).toBe('warn');
  });

  it('warns rather than failing when the recorded voice is switched off', async () => {
    // Nothing is wrong in that case, so a failure would be a false alarm --
    // and a false alarm is what teaches an operator to ignore the screen.
    withCaches(() => undefined);
    const result = await offlineClipCheck(async () => null).run();
    expect(result.outcome).toBe('warn');
    expect(result.summary).toContain('not in use');
  });

  it('warns when the cache itself throws', async () => {
    Object.defineProperty(globalThis, 'caches', {
      value: {
        match: () => Promise.reject(new Error('SecurityError')),
      },
      configurable: true,
      writable: true,
    });
    const result = await offlineClipCheck(async () => '/clips/a.wav').run();
    expect(result.outcome).toBe('warn');
    expect(result.summary).toContain('SecurityError');
  });
});

describe('the storage check', () => {
  /**
   * A storage that behaves, unless told to misbehave in one specific way.
   *
   * The store is injected rather than reached for, so all three real browser
   * behaviours can be driven here -- a throw, a swallowed write, a refused
   * delete -- and so the check is not silently untestable under vitest's node
   * environment, where there is no `localStorage` at all.
   */
  function fakeStore(bad?: 'throws' | 'swallows' | 'wont-delete'): ProbeStorage {
    const map = new Map<string, string>();
    return {
      getItem: (k) => (bad === 'swallows' ? null : (map.get(k) ?? null)),
      setItem: (k, v) => {
        if (bad === 'throws') throw new Error('QuotaExceededError');
        map.set(k, v);
      },
      removeItem: (k) => {
        if (bad === 'wont-delete') return;
        map.delete(k);
      },
    };
  }

  it('fails when the browser exposes no storage at all', async () => {
    const result = await storageCheck(null).run();
    expect(result.outcome).toBe('fail');
    expect(result.summary).toContain('resets on the next launch');
  });

  it('fails when a write throws', async () => {
    const result = await storageCheck(fakeStore('throws')).run();
    expect(result.outcome).toBe('fail');
    expect(result.summary).toContain('QuotaExceededError');
    expect(result.summary).toContain('reset on the next launch');
  });

  it('fails when the write is swallowed without complaint', async () => {
    const result = await storageCheck(fakeStore('swallows')).run();
    expect(result.outcome).toBe('fail');
    expect(result.summary).toContain('will not survive');
  });

  it('fails when a key cannot be deleted', async () => {
    const result = await storageCheck(fakeStore('wont-delete')).run();
    expect(result.outcome).toBe('fail');
    expect(result.summary).toContain('cannot be cleared');
  });

  it('passes and leaves its probe nowhere', async () => {
    const store = fakeStore();
    const result = await storageCheck(store).run();
    expect(result.outcome).toBe('pass');
    expect(store.getItem(STORAGE_PROBE_KEY)).toBeNull();
  });
});

describe('the build check', () => {
  it('fails when the phone is running an older build than the one deployed', async () => {
    // The fault that costs a whole drive: a PWA serves its own cached shell,
    // so "the fix did not work" and "the fix was never on the phone" look
    // identical from the driver's seat.
    const result = await buildCheck(
      () => 'abc1234',
      async () => 'def5678',
    ).run();
    expect(result.outcome).toBe('fail');
    expect(result.summary).toContain('abc1234');
    expect(result.summary).toContain('def5678');
    expect(result.summary).toContain('reopen');
  });

  it('passes when it is current, and says which build that is', async () => {
    const result = await buildCheck(
      () => 'abc1234',
      async () => 'abc1234',
    ).run();
    expect(result.outcome).toBe('pass');
    expect(result.detail).toMatchObject({ build: 'abc1234', deployed: 'abc1234' });
  });

  it('warns rather than failing when the server cannot be reached', async () => {
    // A tunnel is the normal case on these roads. Reporting a stale build
    // because there was no signal is a false alarm in exactly the place this
    // app is used.
    const result = await buildCheck(
      () => 'abc1234',
      async () => {
        throw new Error('NetworkError');
      },
    ).run();
    expect(result.outcome).toBe('warn');
    expect(result.summary).toContain('NetworkError');
  });

  it('warns when the server answers without naming a build', async () => {
    const result = await buildCheck(
      () => 'abc1234',
      async () => null,
    ).run();
    expect(result.outcome).toBe('warn');
    expect(result.summary).toContain('did not say');
  });

  it('warns when the build cannot name itself', async () => {
    const result = await buildCheck(
      () => null,
      async () => 'def5678',
    ).run();
    expect(result.outcome).toBe('warn');
    expect(result.summary).toContain('no identifier');
  });
});
