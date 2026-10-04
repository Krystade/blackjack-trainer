import { beforeEach, describe, expect, it } from 'vitest';
import {
  markInputDeviceChanged,
  msSinceInputDeviceChanged,
  _resetDeviceChurnForTest,
} from './deviceChurn';

/**
 * WHY A RECOGNISER DIED, when the log said only that it did.
 *
 * From the 2026-10-04 drive, five lines apart:
 *
 *   21:11:19.107  route inputs        reason=listen-on count=1 labels="iPhone Microphone"
 *   21:11:21.353  mic session-error   error=audio-capture sessionMs=2287
 *
 * The Corolla had been in that list a minute earlier and was gone by the time
 * the session opened; two seconds later the microphone could not be read. That
 * is almost certainly the same event -- the Bluetooth input going away under a
 * live session -- but the error line says nothing about it, so the next reader
 * of that export (me, last night) treats `audio-capture` as an unexplained
 * hardware failure and goes looking for one.
 *
 * `audio-capture` within a second or two of the input list changing is a
 * different fact from `audio-capture` out of a clear sky: the first is the car
 * disconnecting, the second is a real fault. One number on the error line tells
 * them apart.
 */
describe('how long ago the inputs changed', () => {
  beforeEach(() => {
    _resetDeviceChurnForTest();
  });

  it('says nothing has changed before anything has', () => {
    expect(msSinceInputDeviceChanged(1_000)).toBeNull();
  });

  it('measures from the last change', () => {
    markInputDeviceChanged(1_000);
    expect(msSinceInputDeviceChanged(3_500)).toBe(2_500);
  });

  it('takes the LATEST change, since the car produces several in a row', () => {
    // 2026-10-04, 21:09:37 and 21:09:38: two `devicechange` events inside
    // 300ms as the Corolla attached. The oldest one is not the interesting one.
    markInputDeviceChanged(1_000);
    markInputDeviceChanged(1_300);
    expect(msSinceInputDeviceChanged(1_400)).toBe(100);
  });

  it('never reports a negative age from a clock that stepped backwards', () => {
    markInputDeviceChanged(5_000);
    expect(msSinceInputDeviceChanged(4_000)).toBe(0);
  });
});
