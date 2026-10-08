import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openMic, type HeldMic } from './testKitIO';
import { readDiagnosticLog, clearDiagnosticLog } from './diagnosticLog';

/**
 * The kit's microphone, and the session churn underneath it.
 *
 * WHY THIS FILE EXISTS. Jack's car run of 2026-10-06 lost 7 of 20 calibration
 * windows to `verdict=nothing-heard offered=0` -- not a wrong word, nothing at
 * all -- and every one of them followed a retry. The engine ends a session on
 * its own after silence, and `onend` restarted it with no log line, so a window
 * that opened during a restart gap was indistinguishable in the export from a
 * window where he simply said nothing. The deafness could not be diagnosed
 * because the one event that would explain it was never recorded.
 */
type Final = { transcript: string; confidence: number };

class FakeRec {
  continuous = false;
  interimResults = true;
  maxAlternatives = 1;
  lang = '';
  onstart: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<Final> & { isFinal: boolean }>;
      }) => void)
    | null = null;

  starts = 0;
  /** Set to make the NEXT start throw, as a dead engine does. */
  failNextStart = false;

  start(): void {
    if (this.failNextStart) {
      this.failNextStart = false;
      throw new Error('InvalidStateError');
    }
    this.starts += 1;
    // Asynchronous, as the real one is: openMic awaits onaudiostart.
    setTimeout(() => {
      this.onstart?.();
      this.onaudiostart?.();
    }, 0);
  }
  stop(): void {
    this.onend?.();
  }
  abort(): void {
    this.onend?.();
  }

  /** The engine giving up after silence, which is what it really does. */
  endBySilence(): void {
    this.onend?.();
  }

  /** A partial transcript: the engine has audio but has not committed to it. */
  partial(transcript: string): void {
    const result = Object.assign([{ transcript, confidence: 0 }], { isFinal: false, length: 1 });
    this.onresult?.({ resultIndex: 0, results: Object.assign([result], { length: 1 }) });
  }
}

let fake: FakeRec;

function installWindow(): void {
  fake = new FakeRec();
  (globalThis as unknown as { window: unknown }).window = {
    SpeechRecognition: function () {
      return fake;
    } as unknown as new () => FakeRec,
  };
}

async function open(): Promise<HeldMic> {
  const held = await openMic();
  if ('error' in held) throw new Error(`openMic failed: ${held.error}`);
  return held;
}

const events = (): string[] => readDiagnosticLog().map((e) => e.event);

describe('the kit microphone', () => {
  beforeEach(() => {
    vi.useRealTimers();
    clearDiagnosticLog();
    installWindow();
  });

  it('restarts a session the engine ended, and says so in the log', async () => {
    /*
     * The restart itself was already correct. What was missing is the RECORD of
     * it: a 6-second window that hears nothing guarantees an `onend`, so a
     * failed attempt is always followed by a restart -- which is the single
     * most likely explanation for the retry that also heard nothing, and the
     * export contained no trace of it.
     */
    const held = await open();
    expect(fake.starts).toBe(1);

    fake.endBySilence();

    expect(fake.starts, 'the session was not restarted').toBe(2);
    expect(events(), 'a silent restart cannot be diagnosed from an export').toContain(
      'kit-mic-restart',
    );
    const restart = readDiagnosticLog().find((e) => e.event === 'kit-mic-restart');
    // The count, so a window can be joined to the session it ran in.
    expect(restart?.detail?.n).toBe(2);

    await held.close();
  });

  it('counts the sessions it has opened, so a window can name its own', async () => {
    const held = await open();
    expect(held.sessions()).toBe(1);
    fake.endBySilence();
    fake.endBySilence();
    expect(held.sessions()).toBe(3);
    await held.close();
  });

  it('says when a restart failed and the microphone is dead', async () => {
    /*
     * THE WORST CASE, and it was completely silent. If the restart throws,
     * `alive` goes false and nothing ever opens the mic again -- every
     * remaining window of the run reads as "heard nothing", which is exactly
     * what a wrong vocabulary looks like. A run that has gone deaf must say so,
     * or its numbers get believed.
     */
    const held = await open();
    fake.failNextStart = true;
    fake.endBySilence();

    expect(fake.starts, 'the throwing start must not be counted as a session').toBe(1);
    expect(events()).toContain('kit-mic-dead');

    await held.close();
  });

  it('counts the speech the engine detected, not just the sessions it opened', async () => {
    /*
     * JACK, 2026-10-06: "The 'dead windows' were me saying the word or words and
     * them not being recognized I think. I don't know if it was a mic issue."
     *
     * That rules out the innocent reading. He was speaking, so `offered=0` means
     * a real attempt was lost, and there are exactly two ways:
     *
     *   (a) the engine was between sessions -- `sessionsAtOpen` differs from
     *       `sessionsAtClose`, already recorded.
     *   (b) the engine was up for the whole window and still returned nothing.
     *
     * Only (b) needs this: if WebKit fired `speechstart` and no final followed,
     * the capture was live and the recogniser dropped it. If it never fired,
     * audio was not reaching the engine at all -- the lost-capture failure --
     * even though the API said the mic was open. Those two want opposite fixes,
     * and nothing in the export could tell them apart.
     */
    const held = await open();
    expect(held.speechDetected()).toBe(0);

    fake.onspeechstart?.();
    fake.onspeechstart?.();

    expect(held.speechDetected()).toBe(2);
    await held.close();
  });

  it('counts partial transcripts, the only proof iOS gives that audio arrived', async () => {
    /*
     * BECAUSE `speechDetected()` IS DEAD ON THE DEVICE. Jack's parked run of
     * 2026-10-07 logged `speech=0` on all 21 attempts -- including the 20 that
     * came back with a correct final transcript, which cannot happen unless
     * audio reached the engine. iOS Safari simply does not fire `speechstart`,
     * so the field that was supposed to separate "deaf while open" from "live
     * audio, dropped" measures nothing at all.
     *
     * An interim result is the signal it does give: a partial transcript means
     * the recogniser is hearing. A window that ends `offered=0 partials>0` had
     * live audio and lost it; `partials=0` never got any. Opposite fixes, which
     * is the whole reason to measure it.
     */
    const held = await open();
    expect(held.partials()).toBe(0);

    fake.partial('hi');
    fake.partial('hit');

    expect(held.partials()).toBe(2);
    // And a partial must NOT be delivered as an answer.
    let finals = 0;
    held.onFinal = () => void (finals += 1);
    fake.partial('hit me');
    expect(finals, 'a partial was scored as a spoken word').toBe(0);

    await held.close();
  });

  it('asks the engine for partials, or there are none to count', async () => {
    // `interimResults = false` yields no partials at all, so the counter above
    // would read 0 for every window and look exactly like a deaf microphone.
    await open();
    expect(fake.interimResults).toBe(true);
  });

  it('does not restart after a deliberate close', async () => {
    // Otherwise closing the mic would reopen it forever, and the kit's
    // "mic closed" steps would be measuring an open microphone.
    const held = await open();
    await held.close();
    const startsAfterClose = fake.starts;
    fake.endBySilence();
    expect(fake.starts).toBe(startsAfterClose);
    expect(events()).toContain('kit-mic-closed');
  });
});
