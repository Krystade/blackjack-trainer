import { describe, it, expect, beforeEach } from 'vitest';
import { toneDataUri, cachedToneDataUri, _resetToneCacheForTest } from './tone';

/**
 * The chimes stopped being an oscillator on 2026-10-03, because on Jack's
 * phone the oscillator made no sound: `chime-suspended` twice in one export,
 * eight seconds after a gesture had resumed the graph, while recorded clips
 * played throughout. The tone is now written out as WAV samples and played on
 * the same element path the clips use.
 *
 * WHAT THESE GUARD. A generated sound has its own way of being silent, and it
 * is quieter than a thrown error: a wrong header byte, an envelope that never
 * leaves zero, or a sample that wraps gives a file an element will happily
 * "play" while the cabin hears nothing or hears a click. None of that shows up
 * in any log. So the bytes are decoded back and read.
 */

function decode(uri: string): { header: string; samples: Int16Array; rate: number } {
  const base64 = uri.slice(uri.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const header = String.fromCharCode(...bytes.subarray(0, 4)) + String.fromCharCode(...bytes.subarray(8, 12));
  const rate = view.getUint32(24, true);
  const dataLength = view.getUint32(40, true);
  const samples = new Int16Array(dataLength / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(44 + i * 2, true);
  return { header, samples, rate };
}

describe('toneDataUri', () => {
  beforeEach(() => _resetToneCacheForTest());

  it('is a playable WAV data URI', () => {
    const uri = toneDataUri(880);
    expect(uri.startsWith('data:audio/wav;base64,')).toBe(true);
    const { header } = decode(uri);
    expect(header, 'the RIFF/WAVE header is wrong, so nothing will decode it').toBe('RIFFWAVE');
  });

  it('declares the clips’ own sample rate', () => {
    // 24kHz, matching every file in public/clips. A device playing one rate
    // throughout has one fewer reason to resample anything -- which is the
    // failure that wrecked the volume boost on 2026-10-02.
    expect(decode(toneDataUri(880)).rate).toBe(24_000);
  });

  it('declares exactly as many samples as it carries', () => {
    // A data chunk longer than the bytes present is the classic silent
    // failure: some decoders play static off the end, others refuse the file.
    const uri = toneDataUri(880);
    const { samples } = decode(uri);
    expect(samples.length).toBe(Math.round(24_000 * 0.12));
  });

  it('actually makes a sound', () => {
    const { samples } = decode(toneDataUri(880));
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s));
    // Full amplitude by construction: the element's own volume sets the level,
    // so one generated tone serves every volume the setting can produce.
    expect(peak).toBeGreaterThan(30_000);
  });

  it('fades in and out, so the cue is a beep and not a click', () => {
    const { samples } = decode(toneDataUri(880));
    // A sine that starts at full amplitude on sample zero is a step change,
    // and the click that makes is louder than the tone and carries further in
    // a car.
    expect(Math.abs(samples[0]!)).toBeLessThan(1_000);
    expect(Math.abs(samples[samples.length - 1]!)).toBeLessThan(1_000);
  });

  it('never wraps a sample round to the opposite sign', () => {
    /**
     * 32768 IS NOT A VALID POSITIVE SAMPLE. The positive side of a signed
     * 16-bit value stops at 32767, so rounding a peak into 32768 wraps to
     * -32768 -- an inverted spike at the loudest point of the waveform, which
     * is an audible crack rather than a beep.
     *
     * Checked by looking for a sign flip between neighbours at full
     * amplitude: a real sine changes sign only when it passes through zero.
     */
    const { samples } = decode(toneDataUri(880, 1));
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]!;
      const b = samples[i]!;
      if (Math.sign(a) !== Math.sign(b) && Math.abs(a) > 20_000 && Math.abs(b) > 20_000) {
        throw new Error(`a sample wrapped at index ${i}: ${a} -> ${b}`);
      }
    }
  });

  it('scales by the peak it was given', () => {
    const loud = decode(toneDataUri(880, 1)).samples;
    const quiet = decode(toneDataUri(880, 0.25)).samples;
    let loudPeak = 0;
    let quietPeak = 0;
    for (const s of loud) loudPeak = Math.max(loudPeak, Math.abs(s));
    for (const s of quiet) quietPeak = Math.max(quietPeak, Math.abs(s));
    expect(quietPeak / loudPeak).toBeCloseTo(0.25, 1);
  });

  it('gives a different frequency a different waveform', () => {
    expect(toneDataUri(440)).not.toBe(toneDataUri(880));
  });
});

describe('cachedToneDataUri', () => {
  beforeEach(() => _resetToneCacheForTest());

  it('returns the identical string for a repeated frequency', () => {
    // A drill chimes after every answer; rebuilding 2880 samples each time is
    // work nobody asked for.
    const first = cachedToneDataUri(880);
    expect(cachedToneDataUri(880)).toBe(first);
  });

  it('keeps the kinds apart', () => {
    expect(cachedToneDataUri(440)).not.toBe(cachedToneDataUri(880));
  });

  it('matches what the generator produces', () => {
    expect(cachedToneDataUri(660)).toBe(toneDataUri(660));
  });
});
