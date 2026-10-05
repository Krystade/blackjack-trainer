import { describe, it, expect } from 'vitest';
import {
  createVoiceController,
  AUDIOSTART_GRACE_MS,
  SPOKEN_CONFIDENCE_UNKNOWN,
  type ListenState,
  type RecognitionLike,
} from './voiceControl';
import { SPOKEN_ALTERNATIVES } from './voiceRecognition';

/**
 * WHEN THE MICROPHONE IS ACTUALLY LIVE, as opposed to when the engine said
 * "started".
 *
 * WebKit dispatches `onstart` and THEN constructs the capture source:
 * `SpeechRecognizer::start()` sets its state, fires the Start update, and only
 * afterwards calls `startCapture()`. `onaudiostart` is what fires once the
 * AVAudioSession input unit is really up -- which over Bluetooth means after
 * the hands-free SCO link has been negotiated, and that is not fast.
 *
 * So a cue given on `onstart` invites the operator to speak into a microphone
 * that is not recording yet, and the first syllable is not clipped by an
 * endpointer: it is absent from the buffer the recogniser ever sees. A
 * dictation language model handed a word with its onset missing is how "hit"
 * comes back as "It" -- which is in the 2026-10-04 log twice.
 *
 * These tests pin the gate, the measurement, and the one thing that matters
 * more than either: that an engine which never fires `onaudiostart` must still
 * end up listening. Failing open is mandatory here. Failing closed would mean
 * a drive where the microphone never opens at all, which is worse than the
 * onset loss this is meant to fix.
 */
class FakeRecognition implements RecognitionLike {
  continuous = false;
  interimResults = true;
  lang = '';
  maxAlternatives?: number;
  started = 0;
  aborted = 0;
  onstart: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onresult:
    | ((e: {
        results?: ArrayLike<ArrayLike<{ transcript?: string; confidence?: number }>>;
      }) => void)
    | null = null;

  /** Only `onstart`, deliberately. Audio comes up later, or not at all. */
  start(): void {
    this.started += 1;
    this.onstart?.();
  }

  /** The capture source coming up, the event the real engine fires second. */
  audioStart(): void {
    this.onaudiostart?.();
  }

  abort(): void {
    this.aborted += 1;
    this.onend?.();
  }

  /** One reading, with the confidence the engine attached to it. */
  say(transcript: string, confidence?: number): void {
    this.onresult?.({ results: [[{ transcript, confidence }]] });
  }

  /** Several readings of the same audio, best first, as iOS hands them back. */
  sayAll(alts: Array<{ transcript: string; confidence?: number }>): void {
    this.onresult?.({ results: [alts] });
  }
}

interface LogLine {
  event: string;
  detail?: Record<string, unknown>;
}

function harness(opts: { cueOn?: 'start' | 'audiostart'; alternatives?: number } = {}) {
  const states: ListenState[] = [];
  const logs: LogLine[] = [];
  const made: FakeRecognition[] = [];
  let clock = 1000;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();

  const controller = createVoiceController({
    createRecognition: () => {
      const r = new FakeRecognition();
      made.push(r);
      return r;
    },
    now: () => clock,
    schedule: (fn, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { at: clock + ms, fn });
      return handle;
    },
    cancel: (handle) => {
      timers.delete(handle);
    },
    onAction: () => {},
    onState: (s) => states.push(s),
    log: (event, detail) => logs.push({ event, detail }),
    // Read per session rather than captured once, so toggling the setting
    // mid-drive applies to the next session instead of needing a reload.
    cueOn: opts.cueOn ? () => opts.cueOn! : undefined,
    alternatives: opts.alternatives === undefined ? undefined : () => opts.alternatives!,
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

  const find = (event: string): LogLine | undefined => logs.find((l) => l.event === event);

  return {
    states,
    logs,
    find,
    current: () => made[made.length - 1]!,
    advance,
    controller,
  };
}

describe('the cue waits for the microphone, not for the engine', () => {
  it('does not say "listening" on onstart alone', () => {
    const h = harness({ cueOn: 'audiostart' });
    h.controller.start();

    // 'starting' is honest: the engine has accepted the request and the
    // capture source does not exist yet. Reaching 'listening' here is the
    // bug -- every screen cues the operator off this state.
    expect(h.states).toEqual(['starting']);
    expect(h.states).not.toContain('listening');
  });

  it('says "listening" once audio is really up', () => {
    const h = harness({ cueOn: 'audiostart' });
    h.controller.start();
    h.advance(400);
    // Asserted either side of the event, not just after it: `['starting',
    // 'listening']` at the end is equally true of the behaviour this change
    // replaces, so the before-state is what makes the test discriminate.
    expect(h.states).toEqual(['starting']);

    h.current().audioStart();
    expect(h.states).toEqual(['starting', 'listening']);
  });

  it('still cues on onstart when the operator has chosen that', () => {
    // The old behaviour has to remain reachable, because it is the control
    // arm: a drive with the gate off is what gives the gate a number.
    const h = harness({ cueOn: 'start' });
    h.controller.start();

    expect(h.states).toEqual(['starting', 'listening']);
  });

  it('cues anyway when the engine never fires audiostart', () => {
    /*
     * THE ONE THAT PROTECTS THE DRIVE.
     *
     * `onaudiostart` is in WebKit's dispatch path, but an engine that
     * skipped it would otherwise leave this controller in 'starting'
     * forever -- no cue, no answer, no microphone, for the whole drive.
     * The gate is an accuracy optimisation; it must never be able to cost
     * the feature entirely. So it gives up and cues.
     */
    const h = harness({ cueOn: 'audiostart' });
    h.controller.start();
    h.advance(AUDIOSTART_GRACE_MS);

    expect(h.states).toEqual(['starting', 'listening']);
    expect(h.find('audiostart-missing')?.detail).toMatchObject({
      afterMs: AUDIOSTART_GRACE_MS,
    });
  });

  it('does not report a missing audiostart that did arrive', () => {
    /*
     * REWRITTEN AFTER A MUTATION CHECK. This asserted that 'listening'
     * appeared once when both the grace timer and a late `onaudiostart`
     * fired -- and it passed with the once-per-session guard deleted,
     * because `setState` de-duplicates on its own. It was measuring
     * setState, not the guard.
     *
     * What the guard really controls is the pending timer: cueing on a real
     * `onaudiostart` has to cancel it, or the log grows an
     * `audiostart-missing` for a session whose audio demonstrably started.
     * That entry would corrupt the only measurement this change exists to
     * produce, and it is observable, which the state list was not.
     */
    const h = harness({ cueOn: 'audiostart' });
    h.controller.start();
    h.advance(300);
    h.current().audioStart();
    h.advance(AUDIOSTART_GRACE_MS * 2);

    expect(h.find('audiostart')).toBeDefined();
    expect(h.find('audiostart-missing')).toBeUndefined();
    expect(h.states.filter((s) => s === 'listening')).toHaveLength(1);
  });

  it('measures the gap even with the gate off, because that is the evidence', () => {
    /*
     * `confirmedInMs` has always measured start() -> onstart, which is the
     * leg that does NOT contain the microphone coming up. Logging the second
     * leg regardless of the setting is what makes the next drive able to say
     * whether this mattered -- including the control drive.
     */
    const h = harness({ cueOn: 'start' });
    h.controller.start();
    h.advance(640);
    h.current().audioStart();

    expect(h.find('audiostart')?.detail).toMatchObject({ afterStartMs: 640 });
  });

  it('stops waiting when voice is turned off before audio ever came up', () => {
    /*
     * The grace timer must not outlive the thing it was waiting for. Tested
     * through `stop()` rather than through a session death, because a death
     * schedules a replacement whose own cue is legitimate -- so a leak and
     * the ordinary restart look identical from the state list, and asserting
     * on it would have pinned the wrong thing.
     */
    const h = harness({ cueOn: 'audiostart' });
    h.controller.start();
    h.controller.stop();
    const before = h.states.filter((s) => s === 'listening').length;
    h.advance(AUDIOSTART_GRACE_MS * 2);

    expect(h.states.filter((s) => s === 'listening').length).toBe(before);
    expect(h.find('audiostart-missing')).toBeUndefined();
  });
});

describe('what the engine thought of its own reading', () => {
  it('logs the winner’s confidence', () => {
    // Until now this was dropped on the floor in the drill path: `confidence`
    // appeared only in the since-removed Settings voice probe. With no live distribution recorded,
    // "set a confidence threshold" is unanswerable -- so record it first.
    const h = harness({ cueOn: 'start' });
    h.controller.start();
    h.current().say('stand', 0.62);

    expect(h.find('result')?.detail).toMatchObject({ heard: 'stand', conf: 0.62 });
  });

  it('logs every reading’s confidence, not just the winner’s', () => {
    const h = harness({ cueOn: 'start' });
    h.controller.start();
    h.current().sayAll([
      { transcript: 'Band', confidence: 0.13 },
      { transcript: 'Send', confidence: 0.11 },
      { transcript: 'Stand', confidence: 0.09 },
    ]);

    // The rescue that fired is the third reading; whether its confidence is
    // separable from a bad one is the question the next drive answers.
    expect(h.find('result')?.detail?.confs).toEqual([0.13, 0.11, 0.09]);
  });

  it('says so plainly when the engine reports no confidence', () => {
    // A missing number and a zero are different news: iOS leaves segment
    // confidence at 0 on hypotheses, and a log that renders both as 0 cannot
    // tell "the engine was unsure" from "the engine did not say".
    const h = harness({ cueOn: 'start' });
    h.controller.start();
    h.current().say('stand');

    expect(h.find('result')?.detail?.conf).toBe(SPOKEN_CONFIDENCE_UNKNOWN);
    /*
     * ASSERTED ON THE ARRAY TOO, AFTER A MUTATION CHECK. The `conf` field
     * above is written as `confs[0] ?? UNKNOWN`, so a mutant that pushed a
     * raw `undefined` into the list still produced the right `conf` and this
     * test passed. The list is where the substitution actually has to happen,
     * because that is what carries the per-reading news.
     */
    expect(h.find('result')?.detail?.confs).toEqual([SPOKEN_CONFIDENCE_UNKNOWN]);
  });
});

describe('how many readings to ask for', () => {
  it('asks for three unless told otherwise', () => {
    const h = harness({ cueOn: 'start' });
    h.controller.start();
    expect(h.current().maxAlternatives).toBe(SPOKEN_ALTERNATIVES);
  });

  it('asks for as many as the operator set', () => {
    /*
     * Nobody has ever asked iOS for more than three, so whether it offers
     * more is simply unknown. WebKit's `callbackWithTranscriptions:` iterates
     * SF's transcriptions and breaks at `_maxAlternatives`, so asking for ten
     * costs nothing where fewer exist -- the list just arrives shorter.
     *
     * Safe to deepen because resolveSpoken's two guards are on LENGTH, not on
     * rank: the winner must be short AND the rescuing reading must be short,
     * so a deeper list cannot turn a sentence into a played hand.
     */
    const h = harness({ cueOn: 'start', alternatives: 10 });
    h.controller.start();
    expect(h.current().maxAlternatives).toBe(10);
  });

  it('records how many were ASKED for, not only how many arrived', () => {
    /*
     * The 2026-10-05 room test logged `offered=1` five times out of five with
     * the setting at ten. That reads as "iOS returns one transcription and
     * the whole N-best rescue is dead on this device" -- and it reads exactly
     * the same as "the setting never reached the recogniser", which would be
     * a bug here. A log that cannot separate a platform limit from my own
     * wiring fault is not evidence, so both numbers go in.
     */
    const h = harness({ cueOn: 'start', alternatives: 10 });
    h.controller.start();
    h.current().sayAll([{ transcript: 'Add' }]);

    expect(h.find('result')?.detail).toMatchObject({ asked: 10, offered: 1 });
  });

  it('records how many the engine actually offered', () => {
    const h = harness({ cueOn: 'start', alternatives: 10 });
    h.controller.start();
    h.current().sayAll([{ transcript: 'Band' }, { transcript: 'Stand' }]);

    // `offered` rather than `alternatives`: the distribution of this number
    // is what says whether asking for ten was worth anything.
    expect(h.find('result')?.detail).toMatchObject({ offered: 2 });
  });
});
