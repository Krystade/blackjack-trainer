import { describe, it, expect } from 'vitest';
import {
  createVoiceController,
  restartDelayFor,
  RESTART_DELAY_MS,
  MAX_RESTART_DELAY_MS,
  PRODUCTIVE_SESSION_MS,
  shouldCycle,
  isSuppressed,
  CYCLE_AFTER_MS,
  SPEECH_TAIL_MS,
  START_TIMEOUT_MS,
  MAX_PERMISSION_RETRIES,
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

interface LogLine {
  event: string;
  detail?: Record<string, unknown>;
}

interface Harness {
  actions: VoiceAction[];
  states: ListenState[];
  heard: Array<[string, HeardVerdict]>;
  logs: LogLine[];
  made: FakeRecognition[];
  current: () => FakeRecognition;
  advance: (ms: number) => void;
  controller: ReturnType<typeof createVoiceController>;
}

function harness(opts: { create?: () => RecognitionLike | null } = {}): Harness {
  const actions: VoiceAction[] = [];
  const states: ListenState[] = [];
  const heard: Array<[string, HeardVerdict]> = [];
  const logs: LogLine[] = [];
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
    log: (event, detail) => logs.push({ event, detail }),
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
    logs,
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
  // Reporting the inertia was the first fix and it was not enough. An engine
  // that fires nothing used to leave the controller parked in 'error' with
  // nothing scheduled, for the rest of the drive -- and on an iPhone whose
  // audio route has just flipped, a start() that returns quietly and fires
  // nothing is a routine outcome, not an exotic one. So the state the
  // operator reached most often was the one with no way out of it.
  //
  // The watchdog now treats it as the failed session it is: torn down,
  // counted against the backoff, and retried.
  it('tears the dead session down and retries instead of parking in error', () => {
    // A recogniser whose start() does nothing: no events, ever.
    let built = 0;
    let aborted = 0;
    const silent = (): RecognitionLike => {
      built++;
      return {
        continuous: false,
        interimResults: false,
        lang: '',
        start: () => {},
        abort: () => {
          aborted++;
        },
        onstart: null,
        onend: null,
        onerror: null,
        onresult: null,
      };
    };
    const states: ListenState[] = [];
    let clock = 0;
    let handle = 0;
    const timers = new Map<number, { at: number; fn: () => void }>();
    const controller = createVoiceController({
      createRecognition: silent,
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

    // Fires due timers repeatedly, because a timer's callback schedules the
    // next one: a single pass would stop after the watchdog and never reach
    // the restart it just queued.
    const run = (ms: number) => {
      clock += ms;
      for (let guard = 0; guard < 50; guard++) {
        const due = [...timers].filter(([, t]) => t.at <= clock);
        if (due.length === 0) return;
        for (const [id, t] of due) {
          timers.delete(id);
          t.fn();
        }
      }
    };

    controller.start();
    expect(controller.state()).toBe('starting');
    expect(built).toBe(1);

    run(START_TIMEOUT_MS);
    // No longer claiming to be starting -- that was the original point --
    // and now also scheduled to try again rather than stuck.
    expect(controller.state()).toBe('restarting');
    expect(aborted).toBe(1);

    // The retry actually happens. Without this the assertion above would pass
    // on a controller that merely renamed its dead end.
    run(RESTART_DELAY_MS * 4);
    expect(built).toBeGreaterThan(1);

    // And it keeps trying rather than giving up, because an inert engine is
    // usually a route that will come back. Two runs, not one: the watchdog
    // schedules the restart, so the clock has to move again for it to land.
    run(START_TIMEOUT_MS);
    run(MAX_RESTART_DELAY_MS);
    expect(built).toBeGreaterThan(2);
    expect(controller.state()).not.toBe('error');
  });

  // A slow-but-working engine must not be condemned. The watchdog only fires
  // while the state is still 'starting', so an engine that confirms at all --
  // however late, as long as it beats the timeout -- keeps its session.
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

/**
 * Backing off a microphone that keeps dying.
 *
 * From the drive of 2026-09-10, one probe run over 194 seconds: 6 sessions
 * ended, repeated `audio-capture` errors, the last two lasting 9s and 0.5s.
 * On an iPhone in a car that is the Bluetooth route flipping to hands-free,
 * or iOS taking the input. Retrying every 250ms forever neither fixes it nor
 * lets it settle -- it just re-opens the microphone four times a second.
 */
describe('restartDelayFor', () => {
  /**
   * The cloud recogniser ends a session roughly every ninety seconds BY
   * DESIGN. A single drop is routine and must not introduce a pause, or every
   * drill gains one for no reason.
   */
  it('does not slow down the routine single drop', () => {
    expect(restartDelayFor(0)).toBe(RESTART_DELAY_MS);
  });

  it('backs off as failures run together', () => {
    expect(restartDelayFor(1)).toBeGreaterThan(restartDelayFor(0));
    expect(restartDelayFor(2)).toBeGreaterThan(restartDelayFor(1));
    expect(restartDelayFor(3)).toBeGreaterThan(restartDelayFor(2));
  });

  // It has to keep trying: the operator is driving and cannot intervene.
  it('never backs off past the ceiling, however long the run', () => {
    for (const n of [6, 10, 50, 1000]) {
      expect(restartDelayFor(n)).toBe(MAX_RESTART_DELAY_MS);
    }
    expect(MAX_RESTART_DELAY_MS).toBeLessThanOrEqual(10_000);
  });
});

describe('a microphone that keeps dying', () => {
  function die(h: ReturnType<typeof harness>): void {
    h.current().onerror?.({ error: 'audio-capture' });
    h.current().onend?.();
  }

  it('waits longer each time a dead session dies again', () => {
    const h = harness();
    h.controller.start();
    h.current().onstart?.();

    die(h);
    const first = h.made.length;
    // Nothing yet at a shorter delay than the first backoff step.
    h.advance(RESTART_DELAY_MS);
    expect(h.made.length).toBeGreaterThan(first - 1);

    // Drive a run of instant failures and watch the gap grow.
    const gaps: number[] = [];
    for (let i = 0; i < 4; i++) {
      h.current().onstart?.();
      die(h);
      let waited = 0;
      while (waited < MAX_RESTART_DELAY_MS * 2) {
        const before = h.made.length;
        h.advance(50);
        waited += 50;
        if (h.made.length > before) break;
      }
      gaps.push(waited);
    }
    expect(gaps[gaps.length - 1]!).toBeGreaterThan(gaps[0]!);
  });

  /**
   * The reset. A session that heard something proves the microphone is fine,
   * whatever ended it -- so the next drop must be treated as the routine one
   * it is, not as the tail of an old run.
   */
  it('forgets the run as soon as one session hears anything', () => {
    const h = harness();
    h.controller.start();

    for (let i = 0; i < 5; i++) {
      h.current().onstart?.();
      die(h);
      h.advance(MAX_RESTART_DELAY_MS);
    }

    h.current().onstart?.();
    h.current().onresult?.({ results: [[{ transcript: 'stand' }]] });
    die(h);

    // Back to the routine delay, because the microphone demonstrably works.
    const before = h.made.length;
    h.advance(RESTART_DELAY_MS);
    expect(h.made.length).toBe(before + 1);
  });

  // Staying up is its own proof, even in silence: the operator may simply
  // not have spoken yet.
  it('treats a session that simply lasted as a working one', () => {
    const h = harness();
    h.controller.start();

    for (let i = 0; i < 5; i++) {
      h.current().onstart?.();
      die(h);
      h.advance(MAX_RESTART_DELAY_MS);
    }

    h.current().onstart?.();
    h.advance(PRODUCTIVE_SESSION_MS);
    die(h);

    const before = h.made.length;
    h.advance(RESTART_DELAY_MS);
    expect(h.made.length).toBe(before + 1);
  });
});

/**
 * The operator's report, 2026-09-15: "I get the request to allow the mic and
 * always accept it but it seems like the mic doesn't stay active."
 *
 * `not-allowed` was terminal outright. That is right exactly once -- someone
 * who declines the prompt must not be asked again in a loop -- and wrong every
 * time afterwards, because on iOS a `start()` with no user gesture behind it
 * can come back `not-allowed` with permission perfectly well granted, and an
 * automatic restart is by definition not a gesture. One of those and the
 * microphone was off for the rest of the drive.
 */
describe('a permission refusal after the microphone has demonstrably worked', () => {
  it('still stops for good when nothing has ever worked', () => {
    const h = harness();
    h.controller.start();
    h.current().fail('not-allowed');
    h.advance(10_000);
    expect(h.controller.state()).toBe('denied');
    expect(h.made).toHaveLength(1);
  });

  it('retries when a session has produced a transcript', () => {
    const h = harness();
    h.controller.start();
    // Proof the microphone was genuinely open: it returned words.
    h.current().say('stand');
    h.current().fail('not-allowed');
    h.advance(MAX_RESTART_DELAY_MS);

    expect(h.controller.state()).not.toBe('denied');
    // Vacuity guard: a state that merely is not 'denied' proves nothing
    // unless something was actually re-opened.
    expect(h.made.length).toBeGreaterThan(1);
  });

  it('retries when a session simply stayed up long enough to be real', () => {
    const h = harness();
    h.controller.start();
    h.advance(PRODUCTIVE_SESSION_MS);
    h.current().die(); // a long session ending is normal, and counts as working
    h.advance(RESTART_DELAY_MS);
    const before = h.made.length;

    h.current().fail('not-allowed');
    h.advance(MAX_RESTART_DELAY_MS);
    expect(h.controller.state()).not.toBe('denied');
    expect(h.made.length).toBeGreaterThan(before);
  });

  it('comes to rest if the refusals keep coming, rather than re-asking forever', () => {
    const h = harness();
    h.controller.start();
    h.current().say('stand');

    for (let i = 0; i < MAX_PERMISSION_RETRIES + 2; i++) {
      h.current().fail('not-allowed');
      h.advance(MAX_RESTART_DELAY_MS);
    }
    expect(h.controller.state()).toBe('denied');
  });

  it('a working session in between clears the streak, so a long drive never accumulates', () => {
    const h = harness();
    h.controller.start();
    h.current().say('stand');

    for (let i = 0; i < 20; i++) {
      h.current().fail('not-allowed');
      h.advance(MAX_RESTART_DELAY_MS);
      // ...and the operator keeps talking, which is what a real drive looks
      // like: an occasional refusal between sessions that work.
      h.current().say('hit');
    }
    expect(h.controller.state()).not.toBe('denied');
  });
});

/**
 * The events the controller cannot see and must not have to: the page coming
 * back from hidden or frozen, the network returning, a Bluetooth route
 * settling. Each leaves a session that is dead or backed off while the
 * operator is already talking into it.
 */
describe('resume', () => {
  it('does nothing while a session is confirmed, because restarting costs a deaf window', () => {
    const h = harness();
    h.controller.start();
    expect(h.controller.state()).toBe('listening');
    const before = h.made.length;

    h.controller.resume('visibility');
    expect(h.made).toHaveLength(before);
  });

  it('restarts immediately when the session is backed off', () => {
    const h = harness();
    h.controller.start();
    // Four dead sessions in a row: the backoff is now seconds long.
    for (let i = 0; i < 4; i++) {
      h.current().die();
      h.advance(MAX_RESTART_DELAY_MS);
    }
    // ...and a fifth, left un-advanced, so the controller is genuinely
    // waiting out its delay -- which is the state a returning page finds.
    h.current().die();
    expect(h.controller.state()).toBe('restarting');
    const before = h.made.length;

    h.controller.resume('devicechange');
    expect(h.made.length).toBeGreaterThan(before);
    expect(h.controller.state()).toBe('listening');
  });

  it('clears the backoff, so the next failure starts from the short delay again', () => {
    const h = harness();
    h.controller.start();
    for (let i = 0; i < 4; i++) {
      h.current().die();
      h.advance(MAX_RESTART_DELAY_MS);
    }
    h.current().die();
    h.controller.resume('online');

    // The condition that caused the backoff has changed, so the next dead
    // session must be treated as the first one, not the fifth.
    h.current().die();
    const end = h.logs.filter((l) => l.event === 'session-end').pop();
    expect(end?.detail?.restartInMs).toBe(restartDelayFor(1));
  });

  it('stays off when voice is off', () => {
    const h = harness();
    h.controller.resume('visibility');
    expect(h.made).toHaveLength(0);
    expect(h.controller.state()).toBe('off');
  });
});

/**
 * The log is the deliverable here, not a side effect: the operator drives,
 * comes back, and pastes it. A session whose life is not written down is a
 * session that cannot be diagnosed, and this feature has already burned
 * several drives on exactly that.
 */
describe('the diagnostic log', () => {
  it('records a session from start to end, with how long it lasted', () => {
    const h = harness();
    h.controller.start();
    h.advance(30_000);
    h.current().die();

    const events = h.logs.map((l) => l.event);
    expect(events).toContain('start');
    expect(events).toContain('attempt');
    expect(events).toContain('session-start');
    expect(events).toContain('session-end');

    const end = h.logs.find((l) => l.event === 'session-end');
    expect(end?.detail?.sessionMs).toBe(30_000);
    expect(end?.detail?.heard).toBe(false);
  });

  it('records what was heard and what was made of it', () => {
    const h = harness();
    h.controller.start();
    h.current().say('stand');

    const verdict = h.logs.find((l) => l.event === 'verdict');
    expect(verdict?.detail?.heard).toBe('stand');
    expect(verdict?.detail?.verdict).toBe('stand');
  });

  it('records a rejection, which is the case the operator cannot see', () => {
    const h = harness();
    h.controller.start();
    h.current().say('how was your dad');

    const verdict = h.logs.find((l) => l.event === 'verdict');
    expect(verdict?.detail?.verdict).toBe('rejected');
  });

  it('records the error that killed a session', () => {
    const h = harness();
    h.controller.start();
    h.current().fail('audio-capture');

    const err = h.logs.find((l) => l.event === 'session-error');
    expect(err?.detail?.error).toBe('audio-capture');
  });

  it('never lets a throwing logger reach the microphone', () => {
    const made: FakeRecognition[] = [];
    let clock = 0;
    const timers = new Map<number, { at: number; fn: () => void }>();
    let handle = 0;
    const controller = createVoiceController({
      createRecognition: () => {
        const r = new FakeRecognition();
        made.push(r);
        return r;
      },
      now: () => clock,
      schedule: (fn, ms) => {
        timers.set(++handle, { at: clock + ms, fn });
        return handle;
      },
      cancel: (id) => {
        timers.delete(id);
      },
      onAction: () => {},
      onState: () => {},
      log: () => {
        throw new Error('the notebook caught fire');
      },
    });

    expect(() => controller.start()).not.toThrow();
    expect(controller.state()).toBe('listening');
    expect(() => made[0]!.say('stand')).not.toThrow();
  });
});
