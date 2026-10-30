import { describe, expect, it } from 'vitest';
import { MIC_STUCK_ANNOUNCE_MS, createMicDeadWatch, isMicDead } from './micDeadCue';
import type { ListenState } from './voiceControl';

function rig() {
  let clock = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let state: ListenState = 'off';
  const said: Array<[ListenState, string]> = [];
  const watch = createMicDeadWatch({
    schedule: (fn, ms) => {
      const h = next++;
      timers.set(h, { at: clock + ms, fn });
      return h;
    },
    cancel: (h) => void timers.delete(h),
    currentState: () => state,
    announce: (s, why) => said.push([s, why]),
  });
  const to = (s: ListenState) => {
    state = s;
    watch.onState(s);
  };
  const advance = (ms: number) => {
    clock += ms;
    for (const [h, t] of [...timers]) {
      if (t.at <= clock) {
        timers.delete(h);
        t.fn();
      }
    }
  };
  return { said, to, advance, watch };
}

describe('A5: a microphone that gives up says so', () => {
  it('announces a refused microphone at once', () => {
    const r = rig();
    r.to('starting');
    r.to('listening');
    r.to('denied');
    expect(r.said).toEqual([['denied', 'terminal']]);
  });

  it('announces an unsupported engine at once', () => {
    const r = rig();
    r.to('unsupported');
    expect(r.said).toEqual([['unsupported', 'terminal']]);
  });

  it('says nothing for an ordinary restart that comes back', () => {
    const r = rig();
    r.to('listening');
    r.to('restarting');
    r.advance(2000);
    r.to('starting');
    r.to('listening');
    r.advance(MIC_STUCK_ANNOUNCE_MS * 2);
    expect(r.said).toEqual([]);
  });

  it('announces a restart loop that has not come back in time', () => {
    const r = rig();
    r.to('listening');
    r.to('restarting');
    r.advance(3000);
    r.to('starting');
    r.advance(3000);
    r.to('restarting');
    r.advance(MIC_STUCK_ANNOUNCE_MS - 6000 - 1);
    expect(r.said).toEqual([]);
    r.advance(1);
    expect(r.said).toEqual([['restarting', 'stuck']]);
  });

  it('announces an error that is parked', () => {
    const r = rig();
    r.to('error');
    r.advance(MIC_STUCK_ANNOUNCE_MS);
    expect(r.said).toEqual([['error', 'stuck']]);
  });

  it('speaks once per session, however often it flaps', () => {
    const r = rig();
    r.to('error');
    r.advance(MIC_STUCK_ANNOUNCE_MS);
    r.to('listening');
    r.to('error');
    r.advance(MIC_STUCK_ANNOUNCE_MS);
    r.to('denied');
    expect(r.said).toHaveLength(1);
  });

  it('says nothing once voice is switched off', () => {
    const r = rig();
    r.to('restarting');
    r.to('off');
    r.advance(MIC_STUCK_ANNOUNCE_MS * 2);
    expect(r.said).toEqual([]);
    r.to('error');
    r.watch.dispose();
    r.advance(MIC_STUCK_ANNOUNCE_MS * 2);
    expect(r.said).toEqual([]);
  });

  it('calls the dead states dead, and the live and transient ones not', () => {
    expect(isMicDead('denied')).toBe(true);
    expect(isMicDead('unsupported')).toBe(true);
    expect(isMicDead('error')).toBe(true);
    expect(isMicDead('listening')).toBe(false);
    expect(isMicDead('restarting')).toBe(false);
    expect(isMicDead('starting')).toBe(false);
  });
});
