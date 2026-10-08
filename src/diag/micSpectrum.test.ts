import { describe, it, expect } from 'vitest';
import {
  classifyMicBand,
  preferFrame,
  verdictFromTrackRate,
  probeMicSpectrum,
  HFP_WALL_HZ,
  NARROWBAND_RATIO,
  SILENCE_DBFS,
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

describe('when the track rate already settles it', () => {
  /*
   * EVERY CAR VERDICT SO FAR WAS INVALID, and the module already knew why --
   * it just applied the test to the wrong number.
   *
   * `classifyMicBand` short-circuits when "a Nyquist at or below the wall:
   * nothing above it could ever have shown up, so 'narrowband' would be true by
   * construction". Correct. But it was handed `ctx.sampleRate` (48000, Nyquist
   * 24000), while the TRACK ran at 8000 -- true Nyquist 4000, exactly the wall.
   * So every bin above 4kHz was an artifact of upsampling 8kHz audio to 48kHz,
   * and the ratio computed from it was noise.
   *
   * That is why the readings contradicted each other: Jack's 2026-10-06 18:01
   * run scored the iPhone mic "wideband highRatio=0.287" while DRIVING (road
   * noise upsampled into the empty band), and his parked run scored the same mic
   * "narrowband highRatio=1.6e-8" with a clear voice at -25 dBFS. Neither
   * number meant anything, because the track was 8000 in both.
   *
   * `trackSampleRate=8000` is itself the proof of the wall. It needs no spectral
   * inference, and the spectral inference it was given was worthless.
   */
  it('calls 8kHz narrowband on the strength of the rate alone', () => {
    expect(verdictFromTrackRate(8000)).toBe('narrowband-by-rate');
  });

  it('settles nothing for a rate that could show energy above the wall', () => {
    expect(verdictFromTrackRate(48000)).toBeNull();
    expect(verdictFromTrackRate(16000)).toBeNull();
  });

  it('settles nothing when the rate is unknown, rather than guessing', () => {
    expect(verdictFromTrackRate(null)).toBeNull();
  });

  it('treats exactly twice the wall as already band-limited', () => {
    // Nyquist == the wall: nothing ABOVE it can appear, which is the whole test.
    expect(verdictFromTrackRate(HFP_WALL_HZ * 2)).toBe('narrowband-by-rate');
    expect(verdictFromTrackRate(HFP_WALL_HZ * 2 + 2)).toBeNull();
  });
});

describe('how loud the probe actually was', () => {
  /*
   * WHY THIS EXISTS. Jack ran the car-bt kit twice on 2026-10-06 and forgot to
   * count out loud during the spectrum step on the first run. Those three
   * probes measured an empty cabin -- engine noise, no voice -- and still
   * returned a confident `verdict=narrowband`, because engine noise clears the
   * silence floor. The log recorded the ratio and not one number saying how
   * loud it had been, so a probe of nobody speaking was indistinguishable from
   * a probe of speech, and it was read (by me) as evidence about the Bluetooth
   * route. The module's own comment already warned: "A wall seen while nobody
   * was speaking is not evidence of a wall."
   *
   * The level is now recorded, so that confound is visible in the export
   * instead of being invisible in it. No threshold is invented here -- the
   * number is reported and nothing gates on it, because what counts as "loud
   * enough to be speech" in a Corolla at 8kHz is not yet measured.
   */
  it('reports the loudest bin it saw, not just the share above the wall', () => {
    const bins = new Float32Array([-30, -40, -50, -60]);
    expect(classifyMicBand(bins, 16000).peakDbfs).toBe(-30);
  });

  it('reports silence as silence rather than as a quiet measurement', () => {
    // Every bin at or below the floor: there was nothing to be loud.
    const bins = new Float32Array([-200, -200, -200, -200]);
    const v = classifyMicBand(bins, 16000);
    expect(v.verdict).toBe('no-signal');
    expect(v.peakDbfs).toBe(SILENCE_DBFS);
  });

  it('prefers the louder frame, which is what "the loudest moment" means', () => {
    /*
     * The loop said "the loudest moment decides" and then selected on
     * `highRatio` -- the SHARE of energy above 4kHz, which is not loudness. A
     * quiet frame of hiss has a high share and would beat a loud frame of
     * speech, so the reported ratio could come from a moment nobody spoke in.
     */
    const loudNarrow = { verdict: 'narrowband' as const, highRatio: 0.001, bins: 4, highBins: 1, peakDbfs: -20 };
    const quietWide = { verdict: 'wideband' as const, highRatio: 0.9, bins: 4, highBins: 3, peakDbfs: -85 };
    expect(preferFrame(quietWide, loudNarrow)).toBe(loudNarrow);
    expect(preferFrame(loudNarrow, quietWide)).toBe(loudNarrow);
  });

  it('takes any signal over no signal at all', () => {
    const nothing = { verdict: 'no-signal' as const, highRatio: 0, bins: 0, highBins: 0, peakDbfs: SILENCE_DBFS };
    const something = { verdict: 'narrowband' as const, highRatio: 0.001, bins: 4, highBins: 1, peakDbfs: -70 };
    expect(preferFrame(nothing, something)).toBe(something);
    expect(preferFrame(something, nothing)).toBe(something);
  });
});

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

/* ------------------------------------------------------------------------ */

/**
 * The probe's own audio context, which it never started.
 *
 * JACK'S PARKED RUN, 2026-10-07: three probes in a row -- the Corolla twice
 * and the iPhone's own microphone once -- came back `verdict=no-signal bins=0
 * highBins=0 peakDbfs=-120 frames=78`. Identical, absolute silence on every
 * input. In the same session, minutes earlier, the word step scored 20 of 20
 * through that same car microphone, so audio was certainly reaching the
 * speech engine.
 *
 * `probeMicSpectrum` builds its own `new AudioContext()` and never resumes it.
 * On iOS a context created outside a user gesture starts SUSPENDED -- and this
 * one is constructed after `await openMicStream(...)`, by which point the
 * gesture that opened the step is long gone. A suspended context renders
 * nothing, so the analyser hands back its initial fill on every frame while
 * the loop, which is driven by the wall clock, keeps counting frames.
 *
 * That is this file's own recurring sin: an instrument that cannot tell its
 * own failure from its finding. `peakDbfs=-120` is the no-signal SENTINEL, not
 * a measurement, so the reading was unreadable in both directions -- it could
 * not show that nobody spoke, and it could not show that the probe never ran.
 */
describe('the probe says whether its own context ever ran', () => {
  class FakeAnalyser {
    fftSize = 2048;
    minDecibels = -140;
    smoothingTimeConstant = 0;
    frequencyBinCount = 1024;
    readonly ctx: { state: string };
    constructor(ctx: { state: string }) {
      this.ctx = ctx;
    }
    getFloatFrequencyData(out: Float32Array): void {
      // A suspended context renders nothing, so the array keeps its fill.
      out.fill(this.ctx.state === 'running' ? -30 : -Infinity);
    }
  }

  class FakeCtx {
    state = 'suspended';
    currentTime = 0;
    sampleRate = 48000;
    resumes = 0;
    /** Set to model iOS refusing to resume without a gesture. */
    refuseResume = false;
    async resume(): Promise<void> {
      this.resumes += 1;
      if (!this.refuseResume) this.state = 'running';
    }
    async close(): Promise<void> {
      this.state = 'closed';
    }
    createAnalyser(): FakeAnalyser {
      return new FakeAnalyser(this);
    }
    createMediaStreamSource(): { connect: () => void } {
      return { connect: () => {} };
    }
  }

  let made: FakeCtx[] = [];

  function install(refuseResume: boolean): void {
    made = [];
    const track = {
      label: 'TOYOTA Corolla',
      getSettings: () => ({ sampleRate: 8000 }),
      stop: () => {},
    };
    // `navigator` is getter-only in the node environment vitest runs in.
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: async () => ({
            getAudioTracks: () => [track],
            getTracks: () => [track],
          }),
        },
      },
    });
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: function () {
        const c = new FakeCtx();
        c.refuseResume = refuseResume;
        made.push(c);
        return c;
      },
    };
  }

  it('resumes a suspended context, so there is something to measure', async () => {
    install(false);
    const r = await probeMicSpectrum({ ms: 120 });

    expect(made[0]?.resumes, 'the probe never started its own context').toBeGreaterThan(0);
    expect(r.contextState).toBe('running');
    // -30 dBFS across the band: a real reading, not the silence sentinel.
    expect(r.peakDbfs).toBeGreaterThan(SILENCE_DBFS);
    expect(r.verdict).not.toBe('no-signal');
  });

  it('says the context would not start, rather than reporting silence', async () => {
    install(true);
    const r = await probeMicSpectrum({ ms: 120 });

    /*
     * THE WHOLE POINT. A probe that could not run must not come back with a
     * confident `no-signal`, because that reads as "the microphone delivered
     * nothing" and sends the reader after a capture bug that may not exist.
     */
    expect(r.error).toBe('context-suspended');
    expect(r.contextState).toBe('suspended');
    expect(r.verdict).toBe('unmeasurable');
  });
});
