/**
 * Chime tones as WAV data, built in plain arithmetic.
 *
 * NOTE (2026-10-05): once a microphone has been opened, chimes play this same
 * waveform through Web Audio (toneSamples -> AudioBuffer in clips.ts), with the
 * element path below as the fallback when the context is not running. The
 * reasoning below still explains why the DEFAULT is an element.
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
 * One note of an earcon: a pitch (gliding to `endHz` when given) held for
 * `ms`, then `gapMs` of silence before the next note.
 */
export interface EarconNote {
  readonly hz: number;
  readonly endHz?: number;
  readonly ms: number;
  readonly gapMs?: number;
}

/**
 * A short sequence of notes in one timbre.
 *
 * 2026-10-18, after Jack said from the car that the tones "don't sound right":
 * every kind used to be the same 120ms pure sine at a different pitch. That
 * left absolute pitch as the only cue, and pitch is the weakest one the
 * earcon literature lists (Brewster: tell earcons apart by rhythm, note count
 * and timbre first). So an earcon is now a list of notes plus `harmonics`:
 * the relative amplitude of partials 1..n, with index 0 being the
 * fundamental. `[1]` (the default) is the old pure sine. Odd partials sound
 * harsh, which suits the error tones, and a soft 2nd partial sounds like a
 * bell (IEC 60601-1-8 Annex D). Partials also lift a low fundamental into the
 * 1-2kHz band that phone and car speakers actually reproduce.
 */
export interface Earcon {
  readonly notes: readonly EarconNote[];
  readonly harmonics?: readonly number[];
}

/** The old single tone as an earcon: one 120ms pure note. */
export function singleNote(frequencyHz: number, endHz = frequencyHz): Earcon {
  return { notes: [{ hz: frequencyHz, endHz, ms: DURATION_S * 1000 }] };
}

/** Milliseconds an earcon lasts, gaps included (a trailing gap counts too). */
export function earconDurationMs(earcon: Earcon): number {
  return earcon.notes.reduce((t, n) => t + n.ms + (n.gapMs ?? 0), 0);
}

/**
 * An earcon as float samples in [-peak, peak]. The single source of the
 * waveform, shared by the WAV data URI (element path) and the AudioBuffer
 * (Web Audio path) so the two can never drift apart.
 */
export function earconSamples(earcon: Earcon, peak = 1): Float32Array {
  const safePeak = Math.min(1, Math.max(0, peak));
  const partials = earcon.harmonics && earcon.harmonics.length > 0 ? earcon.harmonics : [1];
  // Normalised so the partials summed in phase never exceed the peak.
  const norm = partials.reduce((a, b) => a + Math.abs(b), 0) || 1;
  const total = earcon.notes.reduce(
    (t, n) => t + Math.round((SAMPLE_RATE * n.ms) / 1000) + Math.round((SAMPLE_RATE * (n.gapMs ?? 0)) / 1000),
    0,
  );
  const out = new Float32Array(total);
  let at = 0;
  for (const note of earcon.notes) {
    const frames = Math.round((SAMPLE_RATE * note.ms) / 1000);
    // Every note gets its own fade, so a sequence does not click at each note
    // boundary. The fade is FADE_S, but never more than a quarter of the note,
    // so a short pip still has a flat top.
    const fadeFrames = Math.max(1, Math.min(Math.round(SAMPLE_RATE * FADE_S), Math.floor(frames / 4)));
    const endHz = note.endHz ?? note.hz;
    let phase = 0;
    for (let i = 0; i < frames; i++) {
      // Up over the fade, flat, then down to nothing at the end. `Math.min`
      // of the two ramps gives both without a branch.
      const envelope = Math.min(1, i / fadeFrames, (frames - 1 - i) / fadeFrames);
      let v = 0;
      for (let k = 0; k < partials.length; k++) {
        // Partials above Nyquist would alias into a wrong, lower pitch.
        if ((k + 1) * Math.max(note.hz, endHz) >= SAMPLE_RATE / 2) break;
        v += partials[k]! * Math.sin((k + 1) * phase);
      }
      out[at + i] = (v / norm) * envelope * safePeak;
      // C-R4: a glide by accumulating phase, so the instantaneous pitch moves
      // linearly from hz to endHz. Flat when they are equal.
      phase += (2 * Math.PI * (note.hz + ((endHz - note.hz) * i) / frames)) / SAMPLE_RATE;
    }
    at += frames + Math.round((SAMPLE_RATE * (note.gapMs ?? 0)) / 1000);
  }
  return out;
}

/** An earcon, or the old (frequency, endHz) single tone. */
export type ToneSpec = number | Earcon;

function asEarcon(spec: ToneSpec, endHz?: number): Earcon {
  return typeof spec === 'number' ? singleNote(spec, endHz ?? spec) : spec;
}

/**
 * The old single faded sine: one 120ms note. This is now a thin wrapper over
 * `earconSamples`, and it is still sample-for-sample what it always was.
 */
export function toneSamples(frequencyHz: number, peak = 1, endHz = frequencyHz): Float32Array {
  return earconSamples(singleNote(frequencyHz, endHz), peak);
}

/**
 * A 16-bit mono WAV of an earcon (or one faded sine), as a `data:` URI.
 *
 * Built at FULL amplitude and levelled by the element's own `volume`, so one
 * cached string serves every volume the setting can produce. Peak 1.0 would
 * be a very loud beep next to speech that peaks at 0.5; the caller picks the
 * level (see `chimePeak`), and this is deliberately the loudest the tone can
 * be rather than the loudest it should be.
 */
export function toneDataUri(spec: ToneSpec, peak = 1, endHz?: number): string {
  const samples = earconSamples(asEarcon(spec, endHz), peak);
  const frames = samples.length;
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
 * One generated tone per earcon, for the life of the page.
 *
 * One per kind, each a few kilobytes, generated the first time it sounds. The
 * alternative is rebuilding the same 2880 samples on every chime in a drill
 * that chimes after every answer.
 */
const cache = new Map<string, string>();

export function cachedToneDataUri(spec: ToneSpec, endHz?: number): string {
  const earcon = asEarcon(spec, endHz);
  const key = JSON.stringify(earcon);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const built = toneDataUri(earcon, 1);
  cache.set(key, built);
  return built;
}

/** Test-only: drop the generated tones. */
export function _resetToneCacheForTest(): void {
  cache.clear();
}
