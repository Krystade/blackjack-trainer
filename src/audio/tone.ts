/**
 * Chime tones as WAV data, built in plain arithmetic.
 *
 * WHY NOT AN OSCILLATOR. Because on Jack's phone the oscillator makes no
 * sound. From the 2026-10-03 export, on build 89bd8db:
 *
 *   17:12:10.573  speak audio-unlock    reason=gesture state=suspended rate=48000
 *   17:12:18.556  speak cue-held        kind=ready why=quiet
 *   17:12:18.556  speak chime           kind=ready volume=1
 *   17:12:18.658  speak chime-suspended kind=ready state=suspended
 *
 * The held cue worked -- it waited for the prompt to finish and fired into
 * silence, which is exactly what it was built for -- and then the tone was
 * generated into a graph that was still suspended eight seconds after a
 * gesture had resumed it. `chime-suspended` again at 17:12:56.758 on the next
 * page load. Recorded clips played perfectly throughout both. So on this
 * device the Web Audio graph does not reliably wake, and the plain media
 * element does: the same lesson the volume boost taught on 2026-10-02, now
 * applied to the last thing in the app that still depended on the graph.
 *
 * A sine wave is not hard to write down. 2880 samples at 24kHz is 120
 * milliseconds, which is the tone this app has always played; generating it
 * here costs a few milliseconds once per kind and removes an entire class of
 * silence that the operator cannot see and the log could only report after
 * the fact.
 *
 * 24kHz TO MATCH THE CLIPS, deliberately. Every recorded clip in
 * public/clips is a 24kHz file, and a device playing one rate throughout has
 * one fewer reason to resample anything.
 */

/** Samples a second. The clips' own rate -- see the note above. */
const SAMPLE_RATE = 24_000;

/** Seconds. The tone this app has always played. */
const DURATION_S = 0.12;

/**
 * Seconds of fade in and fade out.
 *
 * Not decoration: a sine that starts at full amplitude on sample zero is a
 * step change, and a step change is a click. The click is louder than the
 * tone and carries further in a car, so without this the cue would be a tick
 * rather than a beep.
 */
const FADE_S = 0.02;

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
  bytes[offset + 3] = (value >> 24) & 0xff;
}

function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}

/** Sample rate of every generated tone (the clips' own rate). */
export const TONE_SAMPLE_RATE = SAMPLE_RATE;

/**
 * The tone as float samples in [-peak, peak]: one faded sine. The single
 * source of the waveform, shared by the WAV data URI (element path) and the
 * AudioBuffer (Web Audio path) so the two can never drift apart.
 */
export function toneSamples(frequencyHz: number, peak = 1): Float32Array {
  const frames = Math.round(SAMPLE_RATE * DURATION_S);
  const fadeFrames = Math.max(1, Math.round(SAMPLE_RATE * FADE_S));
  const safePeak = Math.min(1, Math.max(0, peak));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    // The same shape the oscillator envelope had: up over FADE_S, flat, then
    // down to nothing at the end. `Math.min` of the two ramps gives both
    // without a branch, and handles a tone shorter than two fades.
    const rampIn = i / fadeFrames;
    const rampOut = (frames - 1 - i) / fadeFrames;
    const envelope = Math.min(1, rampIn, rampOut);
    out[i] = Math.sin((2 * Math.PI * frequencyHz * i) / SAMPLE_RATE) * envelope * safePeak;
  }
  return out;
}

/**
 * A 16-bit mono WAV of one faded sine, as a `data:` URI.
 *
 * Built at FULL amplitude and levelled by the element's own `volume`, so one
 * cached string serves every volume the setting can produce. Peak 1.0 would
 * be a very loud beep next to speech that peaks at 0.5; the caller picks the
 * level (see `chimePeak`), and this is deliberately the loudest the tone can
 * be rather than the loudest it should be.
 */
export function toneDataUri(frequencyHz: number, peak = 1): string {
  const frames = Math.round(SAMPLE_RATE * DURATION_S);
  const dataBytes = frames * 2;
  const bytes = new Uint8Array(44 + dataBytes);

  writeAscii(bytes, 0, 'RIFF');
  writeU32(bytes, 4, 36 + dataBytes);
  writeAscii(bytes, 8, 'WAVE');
  writeAscii(bytes, 12, 'fmt ');
  writeU32(bytes, 16, 16); // PCM header length
  writeU16(bytes, 20, 1); // format: PCM
  writeU16(bytes, 22, 1); // channels: mono
  writeU32(bytes, 24, SAMPLE_RATE);
  writeU32(bytes, 28, SAMPLE_RATE * 2); // byte rate
  writeU16(bytes, 32, 2); // block align
  writeU16(bytes, 34, 16); // bits per sample
  writeAscii(bytes, 36, 'data');
  writeU32(bytes, 40, dataBytes);

  const samples = toneSamples(frequencyHz, peak);
  for (let i = 0; i < frames; i++) {
    const value = Math.round(samples[i]! * 32767);
    writeU16(bytes, 44 + i * 2, value < 0 ? value + 0x10000 : value);
  }

  let binary = '';
  // In chunks, because `String.fromCharCode(...bytes)` on six thousand bytes
  // spreads six thousand arguments onto the stack.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

/**
 * One generated tone per frequency, for the life of the page.
 *
 * Six kinds, each a few kilobytes, generated the first time it sounds. The
 * alternative is rebuilding the same 2880 samples on every chime in a drill
 * that chimes after every answer.
 */
const cache = new Map<number, string>();

export function cachedToneDataUri(frequencyHz: number): string {
  const hit = cache.get(frequencyHz);
  if (hit !== undefined) return hit;
  const built = toneDataUri(frequencyHz);
  cache.set(frequencyHz, built);
  return built;
}

/** Test-only: drop the generated tones. */
export function _resetToneCacheForTest(): void {
  cache.clear();
}
