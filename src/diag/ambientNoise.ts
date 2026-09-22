/**
 * How loud it actually is in here.
 *
 * WHY THE APP NEEDS A NUMBER. Every audibility question this project has
 * argued about -- can the operator hear the app over the road, can the
 * microphone hear the operator -- has been settled by memory of a drive, and
 * memory of a drive is exactly the evidence the diagnostic log exists to
 * replace. "It was loud" and "it was quiet" are the same sentence written by
 * two different moods. A dBFS figure stamped into the log is not.
 *
 * WHAT IT MEASURES, precisely, because the units invite over-reading. This is
 * **dBFS**, decibels relative to digital full scale, from the RMS of the
 * microphone's time-domain samples. It is NOT dB SPL: there is no calibration
 * against a physical reference, the phone applies its own input gain, and iOS
 * in particular runs automatic gain control that this code cannot see or
 * disable. So the number is comparable against ITSELF on this device -- a
 * parked cabin against the same cabin at 70mph -- and meaningless against a
 * sound level meter. Everything downstream treats it that way.
 *
 * WHY IT CANNOT SHARE A PHASE WITH THE WHEEL CHECK. Measuring needs the
 * microphone, and opening the microphone is what makes the car flip from A2DP
 * to its hands-free profile and take the wheel with it -- the same flip that
 * routes phone-speaker playback to the earpiece. So a run that measured noise
 * and tested buttons at once would be testing the wheel under precisely the
 * condition that is known to break it, and would report a dead wheel every
 * time. The two live in different phases, with the microphone shut between.
 */

/** A reading, and what it is safe to conclude from it. */
export interface NoiseReading {
  /** RMS in dBFS. Negative; closer to 0 is louder. */
  dbfs: number;
  /** Peak sample in dBFS over the window, which catches clipping. */
  peakDbfs: number;
  /** How long the window actually ran. */
  ms: number;
  /** How many frames went into it. Zero means the reading is not a reading. */
  frames: number;
}

/**
 * The bands, and why they are wide.
 *
 * Deliberately coarse -- four names, not a scale -- because the calibration
 * does not exist to support anything finer, and a spuriously precise band
 * would get quoted as though it were dB SPL. The boundaries are set from what
 * each condition has to SUPPORT, not from acoustics: 'quiet' is a cabin where
 * the correction can be heard at ordinary volume, 'loud' is one where the
 * unclipped live-TTS lines (which cannot be boosted past device volume at all
 * -- see audio/volume.ts) will be lost even when the clipped ones are not.
 */
export type NoiseBand = 'silent' | 'quiet' | 'moderate' | 'loud';

export function bandFor(dbfs: number): NoiseBand {
  if (dbfs < -60) return 'silent';
  if (dbfs < -45) return 'quiet';
  if (dbfs < -30) return 'moderate';
  return 'loud';
}

/**
 * What a band means for this app, in the one sentence worth reading in a car.
 */
export function adviceFor(band: NoiseBand): string {
  switch (band) {
    case 'silent':
      return 'Nothing is reaching the microphone. If this is a moving car, the app is not on the microphone you think it is.';
    case 'quiet':
      return 'Quiet enough that anything the app says should be audible, and recognition has its best chance.';
    case 'moderate':
      return 'Normal cabin noise. Clipped lines should carry; live speech (which cannot be boosted) may not.';
    case 'loud':
      return 'Loud enough to lose the unclipped lines entirely. Recognition will drop words. Raise the volume and expect misses.';
  }
}

/** Linear amplitude (0..1) to dBFS, with a floor so silence is not -Infinity. */
export function toDbfs(amplitude: number): number {
  const FLOOR_DB = -100;
  if (!(amplitude > 0)) return FLOOR_DB;
  return Math.max(FLOOR_DB, 20 * Math.log10(amplitude));
}

/** RMS of one frame of time-domain samples, each in -1..1. */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}

/** Largest absolute sample in a frame. */
export function peak(samples: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]!);
    if (v > max) max = v;
  }
  return max;
}

/**
 * Fold a sequence of frames into one reading.
 *
 * The RMS across frames is the root-mean-square of the per-frame RMS values,
 * not their arithmetic mean: averaging RMS values under-reports a window that
 * is mostly quiet with a loud passage in it, which in a car is every window
 * containing a truck.
 */
export function foldFrames(frames: readonly Float32Array[], ms: number): NoiseReading {
  if (frames.length === 0) return { dbfs: toDbfs(0), peakDbfs: toDbfs(0), ms, frames: 0 };
  let sumSquares = 0;
  let worst = 0;
  for (const frame of frames) {
    const r = rms(frame);
    sumSquares += r * r;
    const p = peak(frame);
    if (p > worst) worst = p;
  }
  return {
    dbfs: toDbfs(Math.sqrt(sumSquares / frames.length)),
    peakDbfs: toDbfs(worst),
    ms,
    frames: frames.length,
  };
}
