import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logSelectedInput } from './environment';
import { clearDiagnosticLog, readDiagnosticLog } from './diagnosticLog';

/**
 * WHICH MICROPHONE, not which microphones.
 *
 * `logAudioInputs` calls `enumerateDevices`, which lists the inputs that
 * EXIST. It says nothing about the one in use -- and "in use" is the whole
 * question, because the phone switching its input to the car's hands-free
 * unit is the one machine-readable signature of the Bluetooth profile flip
 * that this entire protocol is built to measure the effects of. The only row
 * that ever named the input in use was the ambient step's, taken last.
 *
 * This reads the label off a live track and stops the track at once. It is
 * the caller's job to open it only where a second capture costs nothing.
 */

interface FakeTrack {
  label: string;
  getSettings: () => { deviceId?: string };
  stop: () => void;
}

function installMediaDevices(getUserMedia: () => Promise<unknown>): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getUserMedia } },
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  clearDiagnosticLog();
});

afterEach(() => {
  delete (globalThis as { navigator?: unknown }).navigator;
});

describe('logSelectedInput', () => {
  it('records the label and id of the input actually in use, then lets it go', async () => {
    const track: FakeTrack = {
      label: 'Corolla Hands-Free',
      getSettings: () => ({ deviceId: 'bt-1' }),
      stop: vi.fn(),
    };
    installMediaDevices(async () => ({
      getAudioTracks: () => [track],
      getTracks: () => [track],
    }));

    await logSelectedInput('mic-settled');

    const row = readDiagnosticLog().find(
      (e) => e.category === 'route' && e.event === 'input-selected',
    );
    expect(row, 'nothing said which input the phone was using').toBeTruthy();
    expect(row?.detail).toMatchObject({
      reason: 'mic-settled',
      label: 'Corolla Hands-Free',
      deviceId: 'bt-1',
    });
    expect(track.stop, 'the probe left a microphone open').toHaveBeenCalledTimes(1);
  });

  it('records a refusal rather than throwing into the step that asked', async () => {
    installMediaDevices(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });

    await expect(logSelectedInput('mic-settled')).resolves.toBeUndefined();

    const row = readDiagnosticLog().find(
      (e) => e.category === 'route' && e.event === 'input-selected',
    );
    expect(row?.detail).toMatchObject({ reason: 'mic-settled', state: 'threw' });
  });

  it('records the absence of the API on a platform without it', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
      writable: true,
    });

    await logSelectedInput('boot');

    const row = readDiagnosticLog().find(
      (e) => e.category === 'route' && e.event === 'input-selected',
    );
    expect(row?.detail).toMatchObject({ reason: 'boot', state: 'unavailable' });
  });
});
