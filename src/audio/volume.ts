/**
 * How far "louder" can actually go, and by what mechanism.
 *
 * The app's volume setting is a multiplier UNDER the device volume, so at
 * 1.0 it is already passing audio through unattenuated. Going above that is
 * real amplification, and the platform is unusually strict about it -- these
 * ceilings were measured, not assumed:
 *
 *   - `HTMLMediaElement.volume = 2`      -> THROWS IndexSizeError
 *   - `SpeechSynthesisUtterance.volume = 2` -> silently clamps to 1
 *   - `GainNode.gain.value = 4`          -> accepted
 *
 * So above 1.0 there is exactly one route (a GainNode) and it reaches only
 * the recorded clips. Live `speechSynthesis` cannot be amplified at all --
 * that ceiling lives in the browser, and no amount of app code moves it.
 *
 * The split below is deliberate and is what keeps the boost safe: the
 * element carries everything up to unity, and a GainNode carries ONLY the
 * excess. At normal volumes nothing is routed through Web Audio at all, so
 * the ordinary playback path is byte-for-byte what it was before this
 * feature existed -- which matters, because a suspended AudioContext makes
 * routed audio go SILENT rather than quiet, and silence in a car is the
 * worst failure this app has.
 */

/** 200%. Past roughly this, already-normalised clips audibly clip. */
export const MAX_VOLUME = 2;

/** The chime's full-scale peak at volume 1.0 (a bare oscillator, so 1.0 is full scale). */
export const CHIME_PEAK_GAIN = 0.5;

export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(MAX_VOLUME, Math.max(0, v));
}

/**
 * What to put on an HTMLMediaElement. Never above 1 -- the setter throws,
 * and a throw here would take out the whole utterance.
 */
export function elementVolume(v: number): number {
  return Math.min(1, clampVolume(v));
}

/** What `speechSynthesis` can actually honour. Above 1 is clamped anyway. */
export function utteranceVolume(v: number): number {
  return Math.min(1, clampVolume(v));
}

/** True when the request genuinely needs amplification beyond unity. */
export function needsAmplification(v: number): boolean {
  return clampVolume(v) > 1;
}

/**
 * The GainNode factor. Exactly 1 below unity, so the amplifying path is only
 * ever entered when it has something to do.
 */
export function gainFactor(v: number): number {
  const c = clampVolume(v);
  return c > 1 ? c : 1;
}

/** Chime envelope peak, kept inside full scale so the tone cannot clip. */
export function chimePeak(v: number): number {
  return Math.min(1, CHIME_PEAK_GAIN * clampVolume(v));
}
