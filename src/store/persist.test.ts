import { describe, it, expect } from 'vitest';
import { mergeSettings } from './persist';
import { DEFAULT_SETTINGS } from './types';


/**
 * RETIRING THE TWO ROUTE SETTINGS THAT ARE NOW KNOWN NOT TO WORK.
 *
 * Both were attempts at WebKit bug 218012, and Jack's 2026-10-04 drive on
 * build e60a90f3294d settled both of them. 'playback' declares the media
 * intent mid-capture, and the earlier drive held `type=playback` end to end
 * with the sound on the earpiece. 'switch' was the untried half -- stop
 * capturing, THEN declare playback, THEN make the sound, which is the order
 * the bug thread reports as the workaround. The log executed it exactly:
 *
 *   17:00:29.765  mic   stop
 *   17:00:29.782  route session-at-mic-close type=playback
 *   17:00:29.827  speak clip-chain files="you-have-ten.mp3, dealer-shows-four.mp3"
 *   17:00:32.916  speak clip-end   reason=ended ms=3089
 *
 * Microphone shut, 'playback' confirmed by readback, a three-second clip run
 * to its natural end with nothing capturing. Jack: "I can't fucking hear the
 * app cause it's not going through the loud speaker." So the order does not
 * work either: once a page has opened a microphone, the loud speaker is gone
 * for the life of that page and no web API reverses it.
 *
 * 'switch' is worse than merely useless -- closing the microphone mid-drill
 * sent the same prompt round a repeat loop, seq 7 through 28 of one sentence.
 * So a stored 'switch' or 'playback' is migrated to 'auto', because leaving a
 * setting that cannot work selected means the operator keeps paying its cost
 * for a benefit that was disproved.
 */
describe('the output route, after both workarounds were disproved', () => {
  it('defaults to auto, the only mode that is not a known dead end', () => {
    expect(DEFAULT_SETTINGS.audio.outputRoute).toBe('auto');
  });

  it("moves a stored 'switch' to auto, because it loops the prompt", () => {
    // THE ONE THAT MATTERS FOR JACK'S PHONE: he selected 'switch' by hand, so
    // changing the default alone would never reach him -- mergeSettings
    // spreads the stored blob OVER the defaults, and his stored value wins.
    const s = mergeSettings({ version: 1, audio: { outputRoute: 'switch' } });
    expect(s.audio.outputRoute).toBe('auto');
  });

  it("moves a stored 'playback' to auto as well", () => {
    const s = mergeSettings({ version: 1, audio: { outputRoute: 'playback' } });
    expect(s.audio.outputRoute).toBe('auto');
  });

  it('leaves a stored auto alone', () => {
    const s = mergeSettings({ version: 1, audio: { outputRoute: 'auto' } });
    expect(s.audio.outputRoute).toBe('auto');
  });

  it('keeps the rest of the stored audio settings', () => {
    // A migration that reset the whole audio section would take the voice,
    // rate and volume with it -- a worse outcome than the setting it fixes.
    const s = mergeSettings({
      version: 1,
      audio: { outputRoute: 'switch', rate: 1.4, volume: 0.5 },
    });
    expect(s.audio.rate).toBe(1.4);
    expect(s.audio.volume).toBe(0.5);
  });
});
