import { afterEach, describe, expect, it } from 'vitest';
import { cancelSpeech, speak } from './speech';

/**
 * C-R5: one line at a time. A non-interrupting speak() issued while an
 * earlier line is still sounding waits for it -- on every path, because the
 * clip chain and live speech are separate players and nothing else stops a
 * clip and a live line (or two clip chains) talking over each other.
 */
class FakeUtterance {
  text: string;
  rate?: number;
  volume?: number;
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function install(): FakeUtterance[] {
  const started: FakeUtterance[] = [];
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (globalThis as any).SpeechSynthesisUtterance = FakeUtterance;
  (globalThis as any).window = {
    location: { search: '' },
    speechSynthesis: {
      getVoices: () => [],
      // An engine that does NOT queue: everything handed to it sounds at once,
      // which is what two clip chains do.
      speak: (u: FakeUtterance) => started.push(u),
      cancel: () => {},
    },
  };
  return started;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  cancelSpeech();
  delete (globalThis as any).window;
  delete (globalThis as any).SpeechSynthesisUtterance;
  /* eslint-enable @typescript-eslint/no-explicit-any */
});

describe('speak() serialises non-interrupting lines (C-R5)', () => {
  it('a second line starts only when the first has ended', async () => {
    const started = install();
    speak('Your ramp sits out. True count minus one.');
    speak('Queen.');
    await flush();
    expect(started.map((u) => u.text)).toEqual(['Your ramp sits out. True count minus one.']);
    started[0]!.onend?.();
    await flush();
    expect(started.map((u) => u.text)).toEqual([
      'Your ramp sits out. True count minus one.',
      'Queen.',
    ]);
  });

  it('an interrupting line does not wait, and drops what was queued', async () => {
    const started = install();
    speak('First.');
    speak('Queued.');
    speak('Now.', { interrupt: true });
    await flush();
    started[0]!.onend?.();
    await flush();
    expect(started.map((u) => u.text)).toEqual(['First.', 'Now.']);
  });

  it('cancelSpeech drops queued lines', async () => {
    const started = install();
    speak('First.');
    speak('Queued.');
    cancelSpeech();
    await flush();
    speak('After.');
    await flush();
    expect(started.map((u) => u.text)).toEqual(['First.', 'After.']);
  });
});

describe('a protected line (C-R3: Drive speaks from the tap)', () => {
  it('an interrupt waits behind it instead of cutting it off', async () => {
    const started = install();
    let cancels = 0;
    (globalThis as any).window.speechSynthesis.cancel = () => { cancels += 1; }; // eslint-disable-line @typescript-eslint/no-explicit-any
    speak('Flashcards.', { protect: true, interrupt: true });
    const before = cancels;
    speak('You have sixteen. Dealer shows ten.', { interrupt: true });
    await flush();
    expect(cancels, 'the protected line was cancelled').toBe(before);
    expect(started.map((u) => u.text)).toEqual(['Flashcards.']);
    started[0]!.onend?.();
    await flush();
    expect(started.map((u) => u.text)).toEqual(['Flashcards.', 'You have sixteen. Dealer shows ten.']);
  });

  it('cancelSpeech leaves it playing, and a later line still waits for it', async () => {
    const started = install();
    speak('Count drill.', { protect: true, interrupt: true });
    cancelSpeech();
    speak('Seven.', { interrupt: true });
    await flush();
    expect(started.map((u) => u.text)).toEqual(['Count drill.']);
    started[0]!.onend?.();
    await flush();
    expect(started.map((u) => u.text)).toEqual(['Count drill.', 'Seven.']);
    // Once it has ended, interrupts interrupt again.
    speak('Eight.');
    speak('Nine.', { interrupt: true });
    await flush();
    expect(started.map((u) => u.text).slice(-1)).toEqual(['Nine.']);
  });
});

