import { diag } from './diagnosticLog';
import { openMicStream } from '../audio/openMicStream';

/**
 * Which microphone the recogniser is really listening through.
 *
 * THE QUESTION. The drive log lists two inputs -- `route inputs
 * reason=devicechange-voice count=2 labels="iPhone Microphone | TOYOTA
 * Corolla"` -- and the app chooses neither. Nor does WebKit, in any sense the
 * page can influence: `SpeechRecognitionCaptureSource::findCaptureDevice()`
 * takes the device whose `isDefault()` is true, and
 * `AVAudioSessionCaptureDeviceManager` derives that from
 * `[m_audioSession currentRoute].inputs.firstObject`. Meanwhile
 * `AudioSessionIOS::setCategory` for PlayAndRecord sets
 * `AVAudioSessionCategoryOptionAllowBluetooth` unconditionally, which makes
 * the car's hands-free input eligible -- and iOS prefers it once the SCO link
 * is up.
 *
 * If that is what happens in the Corolla, then the recogniser is decoding
 * 8kHz narrowband audio from a far-field microphone mounted near the
 * windscreen of a car at 70mph, and there is no matcher, vocabulary or engine
 * that recovers from that. Every other lever would be tuning on top of a
 * broken input.
 *
 * WHY THIS MEASUREMENT AND NOT ANOTHER. Hands-free Bluetooth is a hard
 * spectral wall: the codec cannot carry anything above roughly 4kHz, so there
 * is no energy up there at all -- not "less", none. That makes the test
 * genuinely discriminating, which almost nothing else about this microphone
 * is. A quiet cabin, a mumbled word, a closed window and a cautious driver
 * all still produce high-frequency energy through a wideband microphone. Only
 * the narrowband path produces a floor.
 *
 * The two ways it could lie are both handled, and both matter more than the
 * happy path:
 *
 *   - A microphone that never opened reads as a floor at EVERY frequency,
 *     which is the narrowband signature. So silence gets its own verdict and
 *     never confirms the hypothesis. (See the test; this is the failure this
 *     instrument would otherwise have had.)
 *   - A stream already resampled to 8kHz has its Nyquist AT the wall, so
 *     there are no bins above it to measure and "narrowband" would be
 *     unfalsifiable. That gets its own verdict too.
 */

/**
 * Where hands-free Bluetooth stops carrying audio.
 *
 * HFP narrowband is 8kHz sampled, so its usable band tops out just under
 * 4kHz. Wideband HFP (mSBC, 16kHz) reaches ~8kHz -- which this probe would
 * read as wideband, correctly for our purposes: the question is whether the
 * input has been crushed to telephone bandwidth, and mSBC has not.
 */
export const HFP_WALL_HZ = 4000;

/**
 * How much of the measured energy must sit above the wall to call it wideband.
 *
 * VERY low, and lowered deliberately after measuring. The first value here was
 * 0.02, and Chromium's fake capture device -- a generated tone, i.e. the
 * least high-frequency content any real input could have -- measured 0.0213.
 * A threshold a real wideband microphone can brush against in a quiet cabin
 * is not a threshold; it is a coin toss that would report NARROWBAND and send
 * the investigation somewhere expensive and wrong.
 *
 * The physics allows a much lower bar. HFP does not attenuate above the wall,
 * it carries nothing: those bins sit at the analyser's floor and are dropped
 * by SILENCE_DBFS before the ratio is formed, so a true narrowband route
 * measures 0 exactly. Anything measurably above zero is therefore evidence of
 * a wideband route, and 0.005 leaves four times the margin on the side that
 * matters while staying far above a genuine wall.
 */
export const NARROWBAND_RATIO = 0.005;

/**
 * Below this, in dB, a bin is indistinguishable from the analyser's floor.
 *
 * `getFloatFrequencyData` reports -Infinity for true silence and something
 * near its own `minDecibels` for a muted or unopened input.
 */
export const SILENCE_DBFS = -120;

export interface MicBandVerdict {
  /**
   * 'narrowband' -- a wall, i.e. the car's hands-free microphone.
   * 'wideband'   -- energy above the wall, i.e. the phone's own.
   * 'no-signal'  -- nothing anywhere; says nothing about the route.
   * 'unmeasurable' -- the spectrum cannot represent the wall at all.
   */
  verdict: 'narrowband' | 'wideband' | 'no-signal' | 'unmeasurable' | 'narrowband-by-rate';
  /** Share of total linear energy sitting above the wall, 0 to 1. */
  highRatio: number;
  /** Bins that carried any signal, so a thin verdict can be spotted. */
  bins: number;
  /**
   * How many of those bins were ABOVE the wall.
   *
   * The ratio can be small for two different reasons -- a quiet voice, or a
   * codec that cannot carry the band at all -- and only this tells them
   * apart. A real wall reads 0 here; a quiet wideband microphone reads dozens
   * with little energy in them. Recorded so a borderline drive can be re-read
   * instead of re-driven.
   */
  highBins: number;
  /**
   * The loudest bin in this snapshot, in dBFS, or `SILENCE_DBFS` if nothing
   * cleared the floor.
   *
   * RECORDED BECAUSE A SILENT PROBE LOOKED LIKE A MEASUREMENT. Jack ran the
   * car-bt kit twice on 2026-10-06 and forgot to count out loud during this
   * step on the first run. Those probes measured an empty cabin and still
   * returned a confident `narrowband` -- engine noise clears the silence floor
   * -- and with no level in the log a probe of nobody speaking read exactly
   * like a probe of speech. It was then taken (by me) as evidence about the
   * Bluetooth route, which it could not be.
   *
   * Nothing gates on this number: what counts as "loud enough to be speech" in
   * a Corolla at 8kHz is not measured yet, and inventing that threshold is the
   * mistake this field exists to prevent, not to commit.
   */
  peakDbfs: number;
}

/**
 * Judge one frequency snapshot.
 *
 * Takes dBFS bins as `AnalyserNode.getFloatFrequencyData` fills them, bin `i`
 * centred at `i / bins * sampleRate / 2`. Pure, so the judgement can be
 * tested without a microphone -- which is the only half of this that a test
 * can have.
 */
export function classifyMicBand(bins: Float32Array, sampleRate: number): MicBandVerdict {
  const nyquist = sampleRate / 2;
  // No bins, or a Nyquist at or below the wall: nothing above it could ever
  // have shown up, so "narrowband" would be true by construction.
  if (bins.length === 0 || nyquist <= HFP_WALL_HZ) {
    return { verdict: 'unmeasurable', highRatio: 0, bins: bins.length, highBins: 0, peakDbfs: SILENCE_DBFS };
  }

  let low = 0;
  let high = 0;
  let live = 0;
  let highBins = 0;
  let peakDbfs = SILENCE_DBFS;
  for (let i = 0; i < bins.length; i++) {
    const db = bins[i]!;
    if (!Number.isFinite(db) || db <= SILENCE_DBFS) continue;
    live += 1;
    if (db > peakDbfs) peakDbfs = db;
    // dB back to linear power, so the shares are comparable.
    const power = 10 ** (db / 10);
    const hz = (i / bins.length) * nyquist;
    if (hz < HFP_WALL_HZ) low += power;
    else {
      high += power;
      highBins += 1;
    }
  }

  const total = low + high;
  if (live === 0 || total <= 0) {
    // A microphone that never opened. Must not read as narrowband.
    return { verdict: 'no-signal', highRatio: 0, bins: live, highBins, peakDbfs: SILENCE_DBFS };
  }

  const highRatio = high / total;
  return {
    verdict: highRatio >= NARROWBAND_RATIO ? 'wideband' : 'narrowband',
    highRatio,
    bins: live,
    highBins,
    peakDbfs,
  };
}

/**
 * Does the TRACK's own sample rate already settle the question?
 *
 * EVERY CAR VERDICT BEFORE THIS WAS INVALID, and the reason was one number.
 * `classifyMicBand` correctly short-circuits when the Nyquist is at or below the
 * wall -- "nothing above it could ever have shown up, so narrowband would be
 * true by construction" -- but it is handed the AudioContext's rate (48000,
 * Nyquist 24000), while the track runs at 8000, a true Nyquist of 4000: exactly
 * the wall. Every bin above 4kHz was therefore an artifact of upsampling 8kHz
 * audio to 48kHz, and the ratio computed across them was noise.
 *
 * That is why the readings contradicted each other. The 2026-10-06 18:01 run
 * scored the iPhone mic `wideband highRatio=0.287` WHILE DRIVING -- road noise
 * upsampled into a band that cannot carry signal -- and the parked run scored
 * the same microphone `narrowband highRatio=1.6e-8` with a clear voice at
 * -25 dBFS. Neither number meant anything: the track was 8000 in both, and in
 * every other car probe taken on either day.
 *
 * `trackSampleRate=8000` IS the proof of the wall. It needs no spectral
 * inference, and the inference it was given was worthless. Returns null when the
 * rate is unknown or high enough that the band above the wall could really carry
 * something, so the spectrum still decides in the cases where it can.
 */
export function verdictFromTrackRate(
  trackSampleRate: number | null,
): 'narrowband-by-rate' | null {
  if (typeof trackSampleRate !== 'number' || !Number.isFinite(trackSampleRate)) return null;
  return trackSampleRate / 2 <= HFP_WALL_HZ ? 'narrowband-by-rate' : null;
}

/**
 * Which of two snapshots better represents the microphone: THE LOUDER ONE.
 *
 * The loop already claimed "the loudest moment decides" and then selected on
 * `highRatio`, which is the SHARE of energy above the wall and not loudness at
 * all. A quiet frame of hiss has a high share and beat a loud frame of speech,
 * so the ratio finally reported could come from a moment nobody spoke in --
 * the exact failure the comment was written to prevent.
 *
 * Any signal still beats none, so a probe that caught one word among silent
 * frames reports the word.
 */
export function preferFrame(best: MicBandVerdict, next: MicBandVerdict): MicBandVerdict {
  if (next.verdict === 'no-signal') return best;
  if (best.verdict === 'no-signal') return next;
  return next.peakDbfs > best.peakDbfs ? next : best;
}

export interface MicProbeResult extends MicBandVerdict {
  /** What the browser calls the track it gave us. Often names the car. */
  label: string;
  /** The rate the track actually runs at, which HFP forces down. */
  trackSampleRate: number | null;
  /** The rate the analyser saw, which the AudioContext may have resampled. */
  contextSampleRate: number;
  /** How many snapshots were folded into the verdict. */
  frames: number;
  /** Present instead of a verdict when the probe could not run at all. */
  error?: string;
}

/** How long to listen for. Long enough to speak one word into. */
export const PROBE_MS = 2500;

/**
 * Open a microphone, look at the top of its spectrum, and say what it is.
 *
 * Takes the loudest reading rather than an average: the question is whether
 * high frequencies are POSSIBLE on this route, so one well-spoken word is
 * worth more than two seconds of cabin noise. An average would be dragged to
 * the floor by the silence either side of the word and could report a wall
 * that is not there.
 *
 * NOTHING IS PLAYED AND NOTHING IS KEPT. No audio leaves the device, no
 * recording is retained, and the stream is stopped before this resolves --
 * which matters because opening a microphone here flips the car to hands-free
 * and takes the steering wheel with it.
 */
export async function probeMicSpectrum(
  opts: { deviceId?: string; ms?: number } = {},
): Promise<MicProbeResult> {
  const ms = opts.ms ?? PROBE_MS;
  const base: MicProbeResult = {
    verdict: 'unmeasurable',
    highRatio: 0,
    bins: 0,
    highBins: 0,
    peakDbfs: SILENCE_DBFS,
    label: '',
    trackSampleRate: null,
    contextSampleRate: 0,
    frames: 0,
  };

  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) {
    return { ...base, error: 'no-getusermedia' };
  }

  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  try {
    stream = await openMicStream({
      // `exact`, so a device that cannot be honoured FAILS rather than
      // silently handing back the one we are trying to rule out.
      audio: opts.deviceId ? { deviceId: { exact: opts.deviceId } } : true,
    });
    const track = stream.getAudioTracks()[0] ?? null;
    const settings = track?.getSettings?.() ?? {};
    const Ctor: typeof AudioContext =
      (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
    const analyser = ctx.createAnalyser();
    // 2048 gives ~23Hz bins at 48kHz: far finer than needed to see a wall at
    // 4kHz, and still cheap enough to run every frame.
    analyser.fftSize = 2048;
    analyser.minDecibels = -140;
    analyser.smoothingTimeConstant = 0;
    ctx.createMediaStreamSource(stream).connect(analyser);
    // Deliberately NOT connected to `ctx.destination`: routing the microphone
    // to the speaker in a car is feedback, and this probe runs while driving.

    const spectrum = new Float32Array(analyser.frequencyBinCount);
    let best: MicBandVerdict = {
      verdict: 'no-signal',
      highRatio: 0,
      bins: 0,
      highBins: 0,
      peakDbfs: SILENCE_DBFS,
    };
    let frames = 0;
    const until = Date.now() + ms;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 50));
      analyser.getFloatFrequencyData(spectrum);
      frames += 1;
      // The loudest moment decides -- by LEVEL, which is what that means, and
      // which this loop previously did not do. A wall seen while nobody was
      // speaking is not evidence of a wall.
      best = preferFrame(best, classifyMicBand(spectrum, ctx.sampleRate));
    }

    const trackSampleRate = typeof settings.sampleRate === 'number' ? settings.sampleRate : null;
    /*
     * THE RATE OVERRIDES THE SPECTRUM, where the rate can settle it. An 8kHz
     * track cannot carry anything above 4kHz, so the measured share up there is
     * an upsampling artifact and must not be presented as a finding -- it was,
     * and it produced two opposite verdicts for the same microphone on one day.
     * The ratio is still reported, so an old log can be re-read, but the verdict
     * no longer rests on it.
     */
    const byRate = verdictFromTrackRate(trackSampleRate);
    const result: MicProbeResult = {
      ...best,
      ...(byRate && best.verdict !== 'no-signal' ? { verdict: byRate } : {}),
      label: track?.label ?? '',
      trackSampleRate,
      contextSampleRate: ctx.sampleRate,
      frames,
    };
    diag('mic', 'spectrum', { ...result });
    return result;
  } catch (e) {
    const error = e instanceof Error ? e.name : 'failed';
    diag('mic', 'spectrum', { error });
    return { ...base, error };
  } finally {
    // Both, in this order, and unconditionally. A probe that leaves the
    // microphone open has taken the steering wheel for the rest of the drive.
    stream?.getTracks().forEach((t) => t.stop());
    await ctx?.close().catch(() => {});
  }
}

/**
 * The microphones the browser will name, for the probe to aim at.
 *
 * Labels are empty until permission has been granted once, which is why this
 * is offered after a probe rather than before one.
 */
export async function listMicrophones(): Promise<Array<{ deviceId: string; label: string }>> {
  const media = navigator.mediaDevices;
  if (!media?.enumerateDevices) return [];
  try {
    const devices = await media.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({ deviceId: d.deviceId, label: d.label }));
  } catch {
    return [];
  }
}
