import { describe, it, expect } from 'vitest';
import {
  classifyMicBand,
  HFP_WALL_HZ,
  NARROWBAND_RATIO,
  type MicBandVerdict,
} from './micSpectrum';

/**
 * WHICH MICROPHONE THE RECOGNISER IS ACTUALLY LISTENING THROUGH.
 *
 * The 2026-10-04 log lists two inputs -- "iPhone Microphone | TOYOTA Corolla"
 * -- and nothing in the app chooses between them. WebKit does not either:
 * `SpeechRecognitionCaptureSource::findCaptureDevice()` takes the device whose
 * `isDefault()` is true, which `AVAudioSessionCaptureDeviceManager` derives
 * from `[m_audioSession currentRoute].inputs.firstObject`. And
 * `AudioSessionIOS::setCategory` for PlayAndRecord sets `AllowBluetooth`
 * unconditionally, which makes the car's hands-free input eligible -- and iOS
 * prefers it.
 *
 * If that is what is happening, the recogniser is decoding 8kHz narrowband
 * audio from a far-field microphone near the windscreen of a moving car, and
 * no matcher, vocabulary or engine swap can recover from it. That would make
 * it the largest single factor in the whole problem.
 *
 * WHY THIS IS THE RIGHT INSTRUMENT. HFP is a hard spectral wall, not a
 * gradient: there is no energy above ~4kHz because the codec cannot carry it.
 * So the test cannot pass for the wrong reason. A quiet cabin, a mumbled word
 * and a cautious driver all still produce wideband energy when the microphone
 * is wideband; only the narrowband path produces a floor of nothing up there.
 * That is the property that made every other mic test in this repo useless.
 *
 * The classifier is split out from the capture so it can be tested at all --
 * the capture half needs a real microphone and a real car, which is the part
 * no test can have.
 */

/** A spectrum with energy spread across the whole band: a wideband mic. */
function wideband(bins = 512, sampleRate = 48_000): Float32Array {
  const out = new Float32Array(bins);
  for (let i = 0; i < bins; i++) {
    // Falling with frequency, as speech does, but never to nothing.
    out[i] = -30 - (i / bins) * 40;
  }
  void sampleRate;
  return out;
}

/** The same voice over HFP: nothing at all above the wall. */
function narrowband(bins = 512, sampleRate = 48_000): Float32Array {
  const out = new Float32Array(bins);
  const nyquist = sampleRate / 2;
  for (let i = 0; i < bins; i++) {
    const hz = (i / bins) * nyquist;
    out[i] = hz < HFP_WALL_HZ ? -30 - (hz / HFP_WALL_HZ) * 20 : -140;
  }
  return out;
}

describe('telling a narrowband car microphone from the phone’s own', () => {
  it('calls a full spectrum wideband', () => {
    const v = classifyMicBand(wideband(), 48_000);
    expect(v.verdict).toBe<MicBandVerdict['verdict']>('wideband');
  });

  it('calls a spectrum with nothing above 4kHz narrowband', () => {
    const v = classifyMicBand(narrowband(), 48_000);
    expect(v.verdict).toBe<MicBandVerdict['verdict']>('narrowband');
  });

  it('reports the ratio it judged on, so a verdict can be argued with', () => {
    // A bare label would be unauditable after a drive. The number is what
    // lets a borderline reading be re-read rather than re-driven.
    const v = classifyMicBand(narrowband(), 48_000);
    expect(v.highRatio).toBeLessThan(NARROWBAND_RATIO);
    expect(v.highRatio).toBeGreaterThanOrEqual(0);
  });

  it('refuses to judge silence', () => {
    /*
     * THE FAILURE THIS INSTRUMENT WOULD OTHERWISE HAVE.
     *
     * A microphone that is muted, or permission that was never granted,
     * produces a floor of nothing at EVERY frequency -- including above the
     * wall. Measured as a ratio that reads as "no high-frequency energy",
     * which is exactly the narrowband signature. So silence would confirm the
     * hypothesis every time, from a microphone that was never open.
     *
     * This is the shape of test that cannot fail, and the reason the verdict
     * has a third value.
     */
    const silent = new Float32Array(512).fill(-Infinity);
    expect(classifyMicBand(silent, 48_000).verdict).toBe<MicBandVerdict['verdict']>('no-signal');

    const floor = new Float32Array(512).fill(-150);
    expect(classifyMicBand(floor, 48_000).verdict).toBe<MicBandVerdict['verdict']>('no-signal');
  });

  it('refuses to judge a device that cannot represent the wall', () => {
    // A stream resampled to 8kHz has a Nyquist of 4kHz, so there are no bins
    // above the wall to measure. Reporting "narrowband" from a spectrum that
    // could not have shown otherwise would be the same trap as silence.
    const v = classifyMicBand(wideband(512, 8000), 8000);
    expect(v.verdict).toBe<MicBandVerdict['verdict']>('unmeasurable');
  });

  it('counts the bins above the wall, not just their energy', () => {
    /*
     * The ratio alone cannot separate "a quiet voice" from "a codec that
     * cannot carry the band". A true wall has NO live bins up there; a quiet
     * wideband microphone has plenty, each carrying little. Recorded so a
     * borderline drive can be re-read rather than re-driven.
     */
    expect(classifyMicBand(narrowband(), 48_000).highBins).toBe(0);
    expect(classifyMicBand(wideband(), 48_000).highBins).toBeGreaterThan(0);
  });

  it('leaves room between a real wall and a real microphone', () => {
    /*
     * THE THRESHOLD IS PROVISIONAL, AND THAT IS STATED RATHER THAN HIDDEN.
     *
     * There is exactly one real calibration point: Chromium's fake capture
     * device measured 0.0213 through this classifier. The bar started at 0.02
     * and would have called that narrowband on a bad day -- the expensive
     * direction to be wrong in, because it sends the investigation after the
     * car's microphone when the car's microphone was never the problem.
     *
     * A true HFP wall measures 0 exactly: those bins fall below SILENCE_DBFS
     * and never enter the ratio at all. So the bar belongs far below the one
     * real wideband reading and still above zero, which is what is asserted
     * here -- the ORDERING, which is defensible, rather than a number.
     *
     * An earlier version of this test invented a "quiet microphone" spectrum
     * and asserted it came out wideband. The invented rolloff was 55dB, which
     * is itself a wall, so the test failed -- and the only way to make it pass
     * would have been to tune made-up audio until it agreed. Deleted instead.
     * The real calibration comes from the first drive, and `highRatio`,
     * `highBins` and `bins` all go into the log so that drive can be re-read
     * rather than re-driven if this bar turns out wrong.
     */
    expect(NARROWBAND_RATIO).toBeGreaterThan(0);
    expect(NARROWBAND_RATIO).toBeLessThan(0.0213 / 4);
  });

  it('survives an empty spectrum without inventing a verdict', () => {
    expect(classifyMicBand(new Float32Array(0), 48_000).verdict).toBe<
      MicBandVerdict['verdict']
    >('unmeasurable');
  });
});
