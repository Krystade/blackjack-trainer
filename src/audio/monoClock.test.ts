import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVoiceController, type RecognitionLike } from './voiceControl';
import { monoNow } from './monoClock';
import type { VoiceAction } from './voiceRecognition';
import hook from '../ui/useVoiceControl.ts?raw';
import env from '../diag/environment.ts?raw';

/**
 * B19: suppression windows measured on the wall clock end early when the
 * phone corrects its time mid-prompt, and the car mic's copy of the prompt is
 * graded as the answer.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

class Rec implements RecognitionLike {
  continuous = false;
  interimResults = true;
  lang = '';
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onresult: ((e: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null = null;
  start(): void {
    this.onstart?.();
  }
  abort(): void {
    this.onend?.();
  }
}

describe('voice intervals ride a clock the wall-clock resync cannot move (B19)', () => {
  it('a 3s wall-clock step forward mid-prompt does not open the window early', () => {
    let wall = 1_800_000_000_000;
    let mono = 50_000;
    vi.spyOn(Date, 'now').mockImplementation(() => wall);
    vi.stubGlobal('performance', { now: () => mono });
    const rec = new Rec();
    const actions: VoiceAction[] = [];
    const c = createVoiceController({
      createRecognition: () => rec,
      now: monoNow,
      schedule: () => 0,
      cancel: () => {},
      onAction: (a) => actions.push(a),
      onState: () => {},
    });
    c.start();
    c.suppressFor(2000); // "Correct play was hit..."
    wall += 3000; // NTP resync
    mono += 100;
    rec.onresult?.({ results: [[{ transcript: 'hit' }]] });
    expect(actions).toEqual([]);
  });

  it('the hook and both devicechange stamps use it, so the two sides of a subtraction agree', () => {
    expect(hook).toMatch(/now: monoNow,/);
    expect(hook).not.toMatch(/now: \(\) => Date\.now\(\)/);
    for (const src of [hook, env]) {
      expect(src).toMatch(/markInputDeviceChanged\(monoNow\(\)\)/);
      expect(src).not.toMatch(/markInputDeviceChanged\(Date\.now\(\)\)/);
    }
  });
});
