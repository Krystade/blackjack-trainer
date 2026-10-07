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
