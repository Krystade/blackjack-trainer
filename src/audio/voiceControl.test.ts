import { describe, it, expect } from 'vitest';
import {
  createVoiceController,
  shouldCycle,
  isSuppressed,
  CYCLE_AFTER_MS,
  SPEECH_TAIL_MS,
  START_TIMEOUT_MS,
  type ListenState,
  type HeardVerdict,
  type RecognitionLike,
} from './voiceControl';
import type { VoiceAction } from './voiceRecognition';

/**
 * A fake recogniser plus a fake clock, so the whole session lifecycle is
 * exercised without a microphone. The real engine is reachable only from a
 * device, and the probe showed the parts that matter -- spontaneous death,
 * restart, the app hearing itself -- are exactly the parts a browser will not
 * reproduce on demand.
 */
class FakeRecognition implements RecognitionLike {
  continuous = false;
  interimResults = true;
  lang = '';
  started = 0;
  aborted = 0;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onresult: ((e: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null = null;

  start(): void {
    this.started += 1;
    this.onstart?.();
  }

  abort(): void {
    this.aborted += 1;
    // A real abort fires `onend`. Controllers that forget this restart a
    // session they meant to kill, so the fake insists on it.
    this.onend?.();
  }

  say(transcript: string): void {
    this.onresult?.({ results: [[{ transcript }]] });
  }

  die(): void {
    this.onend?.();
  }

  fail(error: string): void {
    this.onerror?.({ error });
    this.onend?.();
  }
}

interface Harness {
  actions: VoiceAction[];
  states: ListenState[];
  heard: Array<[string, HeardVerdict]>;
  made: FakeRecognition[];
  current: () => FakeRecognition;
  advance: (ms: number) => void;
  controller: ReturnType<typeof createVoiceController>;
}

function harness(opts: { create?: () => RecognitionLike | null } = {}): Harness {
  const actions: VoiceAction[] = [];
  const states: ListenState[] = [];
  const heard: Array<[string, HeardVerdict]> = [];
  const made: FakeRecognition[] = [];
  let clock = 1000;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();

  const controller = createVoiceController({
    createRecognition:
      opts.create ??
      (() => {
        const r = new FakeRecognition();
        made.push(r);
        return r;
      }),
    now: () => clock,
    schedule: (fn, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { at: clock + ms, fn });
      return handle;
    },
    cancel: (handle) => {
      timers.delete(handle);
    },
    onAction: (a) => actions.push(a),
    onState: (s) => states.push(s),
    onHeard: (h, v) => heard.push([h, v]),
  });

  const advance = (ms: number): void => {
    clock += ms;
    for (const [handle, timer] of [...timers]) {
      if (timer.at <= clock) {
        timers.delete(handle);
        timer.fn();
      }
    }
  };

  return {
    actions,
    states,
    heard,
    made,
    current: () => made[made.length - 1]!,
    advance,
    controller,
  };
}

describe('shouldCycle', () => {
  it('leaves a young session alone', () => {
    expect(shouldCycle(1000, 1000 + CYCLE_AFTER_MS - 1)).toBe(false);
  });

  it('cycles one that has reached the threshold', () => {
    expect(shouldCycle(1000, 1000 + CYCLE_AFTER_MS)).toBe(true);
  });

  // A session that never started has no age; treating 0 as "infinitely old"
  // would cycle a recogniser that is still coming up.
  it('does not treat a never-started session as stale', () => {
    expect(shouldCycle(0, 10_000_000)).toBe(false);
  });
});

describe('isSuppressed', () => {
  it('is open before the window ends and closed at it', () => {
    expect(isSuppressed(999, 1000)).toBe(true);
    expect(isSuppressed(1000, 1000)).toBe(false);
  });
});

describe('the session survives being left running', () => {
  it('starts listening and reports it', () => {
    const h = harness();
    h.controller.start();
    expect(h.made).toHaveLength(1);
    expect(h.controller.state()).toBe('listening');
    expect(h.states).toEqual(['starting', 'listening']);
  });

  it('configures the recogniser for continuous, final results', () => {
    const h = harness();
    h.controller.start();
    expect(h.current().continuous).toBe(true);
    expect(h.current().interimResults).toBe(false);
  });

  /**
   * The probe's central finding: the engine kills the session by itself,
   * roughly every ninety seconds, even with the tab visible. Without this the
   * feature works for a minute and a half and then goes quiet.
   */
  it('restarts after the engine ends the session on its own', () => {
    const h = harness();
    h.controller.start();
    h.current().die();
    expect(h.controller.state()).toBe('restarting');

    h.advance(1000);
    expect(h.made).toHaveLength(2);
    expect(h.controller.state()).toBe('listening');
  });

  it('keeps answering after a restart', () => {
    const h = harness();
    h.controller.start();
    h.current().die();
    h.advance(1000);
    h.current().say('double');
    expect(h.actions).toEqual(['double']);
  });

  // Stopping must be final. A restart scheduled by the abort's own `onend`
  // would bring the microphone back up after the operator switched it off.
  it('does not come back after stop', () => {
    const h = harness();
    h.controller.start();
    h.controller.stop();
    h.advance(10_000);
    expect(h.made).toHaveLength(1);
    expect(h.controller.state()).toBe('off');
  });

  it('cancels a pending restart when stopped mid-gap', () => {
    const h = harness();
    h.controller.start();
    h.current().die();
    h.controller.stop();
    h.advance(10_000);
    expect(h.made).toHaveLength(1);
    expect(h.controller.state()).toBe('off');
  });

  it('ignores a second start rather than killing its own session', () => {
    const h = harness();
    h.controller.start();
    h.controller.start();
    expect(h.made).toHaveLength(1);
  });
});

describe('recognised speech', () => {
  it('passes a matched command to the consumer', () => {
    const h = harness();
    h.controller.start();
    h.current().say('stand');
    expect(h.actions).toEqual(['stand']);
  });

  it('reports what it heard even when nothing matched', () => {
    const h = harness();
    h.controller.start();
    h.current().say('what time is it');
    expect(h.actions).toEqual([]);
    expect(h.heard).toEqual([['what time is it', 'rejected']]);
  });

  it('ignores empty transcripts without reporting a phantom utterance', () => {
    const h = harness();
    h.controller.start();
    h.current().say('   ');
    expect(h.heard).toEqual([]);
  });

  // A drill screen that throws while grading must not silently take the
  // microphone down with it -- the operator would be left talking to nothing.
  it('survives a consumer that throws', () => {
    const actions: VoiceAction[] = [];
    let rec: FakeRecognition | null = null;
    const controller = createVoiceController({
      createRecognition: () => (rec = new FakeRecognition()),
      now: () => 0,
      schedule: () => 1,
      cancel: () => {},
      onAction: (a) => {
        actions.push(a);
        throw new Error('grading blew up');
      },
      onState: () => {},
    });
    controller.start();
    expect(() => rec!.say('hit')).not.toThrow();
    expect(actions).toEqual(['hit']);
    expect(controller.state()).toBe('listening');
  });
});

/**
 * The failure that would be invisible and constant: the app speaks the
 * correction out loud -- "Correct. Stand." -- the car speaker plays it, the
 * microphone hears it, and the recogniser grades an answer nobody gave. Every
 * spoken word the app produces is a live command unless suppressed.
 */
describe('the app must not hear itself', () => {
  it('discards a result arriving while the app is speaking', () => {
    const h = harness();
    h.controller.start();
    h.controller.suppressFor(2000);
    h.current().say('stand');
    expect(h.actions).toEqual([]);
    expect(h.heard).toEqual([['stand', 'suppressed']]);
  });

  it('listens again once the utterance and its tail have passed', () => {
    const h = harness();
    h.controller.start();
    h.controller.suppressFor(1000);
    h.advance(1000 + SPEECH_TAIL_MS);
    h.current().say('stand');
    expect(h.actions).toEqual(['stand']);
  });

  it('is still deaf during the tail, when the audio is over but results lag', () => {
    const h = harness();
    h.controller.start();
    h.controller.suppressFor(1000);
    h.advance(1000 + SPEECH_TAIL_MS - 1);
    h.current().say('stand');
    expect(h.actions).toEqual([]);
  });

  // Back-to-back utterances: the second must not shorten the first's window.
  it('never shortens an open window with a briefer utterance', () => {
    const h = harness();
    h.controller.start();
    h.controller.suppressFor(5000);
    h.controller.suppressFor(10);
    h.advance(1000);
    h.current().say('hit');
    expect(h.actions).toEqual([]);
  });
});

/**
 * The deaf window cannot be overlapped away -- a second recogniser ends the
 * first rather than covering for it -- so the only move left is to choose
 * WHEN it happens: during feedback, while the operator is listening rather
 * than answering.
 */
describe('moving the deaf window somewhere harmless', () => {
  it('cycles a session that has run long enough', () => {
    const h = harness();
    h.controller.start();
    h.advance(CYCLE_AFTER_MS);
    h.controller.cycleIfStale();
    expect(h.made).toHaveLength(2);
    expect(h.controller.state()).toBe('listening');
  });

  it('leaves a young session running rather than cycling every answer', () => {
    const h = harness();
    h.controller.start();
    h.advance(5000);
    h.controller.cycleIfStale();
    expect(h.made).toHaveLength(1);
  });

  it('does nothing when voice is switched off', () => {
    const h = harness();
    h.controller.start();
    h.controller.stop();
    h.advance(CYCLE_AFTER_MS);
    h.controller.cycleIfStale();
    expect(h.made).toHaveLength(1);
  });

  // The replacement session's age is its own. Cycling must reset the clock,
  // or every subsequent answer would cycle again.
  it('resets the age so the next answer does not cycle again', () => {
    const h = harness();
    h.controller.start();
    h.advance(CYCLE_AFTER_MS);
    h.controller.cycleIfStale();
    h.controller.cycleIfStale();
    expect(h.made).toHaveLength(2);
  });
});

describe('when the microphone is refused or missing', () => {
  /**
   * A denied permission is terminal. Restarting would re-prompt forever, and
   * on some browsers each retry is another permission dialog -- an infinite
   * loop pointed at someone who is driving.
   */
  it('stops for good when permission is denied', () => {
    const h = harness();
    h.controller.start();
    h.current().fail('not-allowed');
    h.advance(10_000);
    expect(h.controller.state()).toBe('denied');
    expect(h.made).toHaveLength(1);
  });

  it('treats a silent stretch as ordinary and keeps going', () => {
    const h = harness();
    h.controller.start();
    h.current().fail('no-speech');
    h.advance(1000);
    expect(h.made).toHaveLength(2);
    expect(h.controller.state()).toBe('listening');
  });

  it('recovers from a dropped network, which a car will produce', () => {
    const h = harness();
    h.controller.start();
    h.current().fail('network');
    h.advance(1000);
    expect(h.controller.state()).toBe('listening');
  });

  it('reports unsupported instead of throwing when there is no API', () => {
    const h = harness({ create: () => null });
    h.controller.start();
    expect(h.controller.state()).toBe('unsupported');
  });

  it('reports unsupported when constructing the recogniser throws', () => {
    const h = harness({
      create: () => {
        throw new Error('blocked by policy');
      },
    });
    expect(() => h.controller.start()).not.toThrow();
    expect(h.controller.state()).toBe('unsupported');
  });

  it('does not retry forever on a browser with no API', () => {
    const h = harness({ create: () => null });
    h.controller.start();
    h.advance(60_000);
    expect(h.controller.state()).toBe('unsupported');
  });
});

/**
 * The probe met a browser that exposes every part of the API and then fires
 * nothing at all -- no start, no error, no end. It is the worst case to
 * present, because "waiting to hear you" and "this will never work" look the
 * same on screen, and only one of them is worth talking louder at.
 */
describe('an engine that is present but inert', () => {
  it('stops claiming to be starting once the engine has had its chance', () => {
    // A recogniser whose start() does nothing: no events, ever.
    const silent: RecognitionLike = {
      continuous: false,
      interimResults: false,
      lang: '',
      start: () => {},
      abort: () => {},
      onstart: null,
      onend: null,
      onerror: null,
      onresult: null,
    };
    const states: ListenState[] = [];
    let clock = 0;
    let handle = 0;
    const timers = new Map<number, { at: number; fn: () => void }>();
    const controller = createVoiceController({
      createRecognition: () => silent,
      now: () => clock,
      schedule: (fn, ms) => {
        timers.set(++handle, { at: clock + ms, fn });
        return handle;
      },
      cancel: (id) => {
        timers.delete(id);
      },
      onAction: () => {},
      onState: (s) => states.push(s),
    });

    controller.start();
    expect(controller.state()).toBe('starting');

    clock += START_TIMEOUT_MS;
    for (const [id, t] of [...timers]) {
      if (t.at <= clock) {
        timers.delete(id);
        t.fn();
      }
    }
    expect(controller.state()).toBe('error');
    expect(states).toContain('error');
  });

  // A slow-but-working engine must not be condemned: the watchdog only
  // changes what is REPORTED, and a late confirmation still wins.
  it('goes back to listening if a slow engine confirms late', () => {
    const h = harness();
    h.controller.start();
    // The fake confirms synchronously, so the watchdog has already been
    // cleared; firing every pending timer must not undo that.
    h.advance(START_TIMEOUT_MS * 2);
    expect(h.controller.state()).toBe('listening');
  });

  it('does not leave a watchdog running after stop', () => {
    const h = harness();
    h.controller.start();
    h.controller.stop();
    h.advance(START_TIMEOUT_MS * 2);
    expect(h.controller.state()).toBe('off');
  });
});
