import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_STRATEGY,
  _resetAudioRouteForTest,
  activeRoutePlan,
  beginCaptureRoute,
  captureRouteSettled,
  classifyInputs,
  detectRoute,
  endCaptureRoute,
  guessBluetoothKind,
  logRouteSnapshot,
  pickSpeakerOutput,
  planRoute,
  routeSinkId,
  setRoutePreferences,
  type DeviceLike,
} from './audioRoute';
import { _resetAudioSessionForTest } from './audioSession';
import { clearDiagnosticLog, readDiagnosticLog } from '../diag/diagnosticLog';

// The labels Jack's phone actually reported (docs/TODO.md, 2026-10-06).
const PHONE: DeviceLike = { kind: 'audioinput', label: 'iPhone Microphone', deviceId: 'mic-phone' };
const CAR: DeviceLike = { kind: 'audioinput', label: 'TOYOTA Corolla', deviceId: 'mic-car' };
const PODS: DeviceLike = { kind: 'audioinput', label: 'Jack’s AirPods Pro', deviceId: 'mic-pods' };
const SPEAKER_OUT: DeviceLike = { kind: 'audiooutput', label: 'Speaker', deviceId: 'out-spk' };
const RECEIVER_OUT: DeviceLike = { kind: 'audiooutput', label: 'Receiver', deviceId: 'out-rcv' };

describe('classifyInputs', () => {
  it('a lone iPhone mic is the phone route', () => {
    const r = classifyInputs([PHONE]);
    expect(r.kind).toBe('phone');
    expect(r.bluetooth).toBeNull();
    expect(r.phone?.deviceId).toBe('mic-phone');
  });

  it('the car listed beside it is a bluetooth route, guessed as the car', () => {
    const r = classifyInputs([CAR, PHONE]);
    expect(r.kind).toBe('bluetooth');
    expect(r.bluetooth).toEqual({ label: 'TOYOTA Corolla', deviceId: 'mic-car' });
    expect(r.guess).toBe('car');
    expect(r.first).toBe('TOYOTA Corolla');
  });

  it('AirPods are guessed as a headset', () => {
    expect(classifyInputs([PHONE, PODS]).guess).toBe('headset');
  });

  it('unlabelled inputs (no permission yet) are unknown, not phone', () => {
    const r = classifyInputs([{ kind: 'audioinput', label: '', deviceId: '' }]);
    expect(r.kind).toBe('unknown');
    expect(r.inputs).toEqual(['(unlabelled)']);
  });

  it('alias ids are never chosen as a device to hold', () => {
    const r = classifyInputs([{ kind: 'audioinput', label: 'Default - TOYOTA Corolla', deviceId: 'default' }, PHONE]);
    expect(r.kind).toBe('phone');
  });

  it('lists outputs, and picks a speaker output only by a name that says so', () => {
    const r = classifyInputs([PHONE, RECEIVER_OUT, SPEAKER_OUT], true);
    expect(r.outputs.map((o) => o.label)).toEqual(['Receiver', 'Speaker']);
    expect(pickSpeakerOutput(r)?.deviceId).toBe('out-spk');
    expect(pickSpeakerOutput(classifyInputs([PHONE, RECEIVER_OUT], true))).toBeNull();
  });
});

describe('guessBluetoothKind', () => {
  it.each([
    ['AirPods Pro', 'headset'],
    ['Powerbeats Pro', 'headset'],
    ['Galaxy Buds2', 'headset'],
    ['Bose QC Headphones', 'headset'],
    ['TOYOTA Corolla', 'car'],
    ['CAR MULTIMEDIA', 'car'],
    ['Uconnect', 'car'],
  ])('%s -> %s', (label, kind) => {
    expect(guessBluetoothKind(label)).toBe(kind);
  });
});

describe('planRoute', () => {
  const phone = classifyInputs([PHONE]);
  const car = classifyInputs([CAR, PHONE]);

  it('Auto keeps the shipped behaviour on every route, and holds nothing', () => {
    for (const r of [phone, car, classifyInputs([])]) {
      const p = planRoute('auto', 'auto', r);
      expect(p.strategy).toBe('web-audio');
      expect(p.hold).toBe('none');
    }
    expect(AUTO_STRATEGY).toEqual({ phone: 'web-audio', bluetooth: 'web-audio', unknown: 'web-audio' });
  });

  it('only the phone route counts as measured; the Bluetooth default is a drive decision', () => {
    expect(planRoute('auto', 'auto', phone).evidence).toBe('measured');
    expect(planRoute('auto', 'auto', car).evidence).toBe('drive-decides');
  });

  it('Phone speaker with the car connected holds the phone mic', () => {
    expect(planRoute('phone', 'auto', car).hold).toBe('phone');
    // ...and with no Bluetooth there is nothing to steer away from.
    expect(planRoute('phone', 'auto', phone).hold).toBe('none');
  });

  it('Bluetooth holds the Bluetooth mic, and only when one is listed', () => {
    expect(planRoute('bluetooth', 'auto', car).hold).toBe('bluetooth');
    expect(planRoute('bluetooth', 'auto', phone).hold).toBe('none');
  });

  it('a hand-picked strategy is used as given', () => {
    expect(planRoute('auto', 'play-and-record', car).strategy).toBe('play-and-record');
  });

  it('speaker-sink falls back to Web Audio unless setSinkId exists AND a speaker is listed', () => {
    expect(planRoute('auto', 'speaker-sink', classifyInputs([PHONE, SPEAKER_OUT], false)).strategy).toBe('web-audio');
    expect(planRoute('auto', 'speaker-sink', classifyInputs([PHONE], true)).strategy).toBe('web-audio');
    expect(planRoute('auto', 'speaker-sink', classifyInputs([PHONE, SPEAKER_OUT], true)).strategy).toBe('speaker-sink');
  });
});

describe('the runtime', () => {
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let session: { type: string };
  let getUserMedia: ReturnType<typeof vi.fn>;
  let stopped: string[];

  function install(devices: DeviceLike[]): void {
    session = { type: 'auto' };
    stopped = [];
    getUserMedia = vi.fn(async (c: { audio: { deviceId: { exact: string } } }) => {
      const id = c.audio.deviceId.exact;
      const label = devices.find((d) => d.deviceId === id)?.label ?? '';
      const track = { label, stop: () => stopped.push(id), getSettings: () => ({ sampleRate: 8000, deviceId: id }) };
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        audioSession: session,
        mediaDevices: { enumerateDevices: async () => devices, getUserMedia },
      },
      configurable: true,
      writable: true,
    });
  }

  beforeEach(() => {
    clearDiagnosticLog();
    _resetAudioSessionForTest();
    _resetAudioRouteForTest();
  });

  afterEach(() => {
    endCaptureRoute('test-end');
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });

  it('Auto declares nothing and opens nothing', async () => {
    install([CAR, PHONE]);
    await detectRoute();
    const plan = beginCaptureRoute('t');
    await captureRouteSettled();
    expect(plan.strategy).toBe('web-audio');
    expect(session.type).toBe('auto');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('play-and-record is declared at capture start and undone at the end', () => {
    install([PHONE]);
    setRoutePreferences('auto', 'play-and-record');
    beginCaptureRoute('t');
    // Synchronous: in force before the caller starts the recogniser.
    expect(session.type).toBe('play-and-record');
    expect(activeRoutePlan()?.strategy).toBe('play-and-record');
    endCaptureRoute('t');
    expect(session.type).toBe('auto');
    expect(activeRoutePlan()).toBeNull();
  });

  it('Bluetooth holds the car input by its exact deviceId and logs what it got', async () => {
    install([CAR, PHONE]);
    setRoutePreferences('bluetooth', 'auto');
    await detectRoute();
    beginCaptureRoute('t');
    await captureRouteSettled();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'mic-car' } } });
    const row = readDiagnosticLog().find((e) => e.event === 'route-hold');
    expect(row?.detail).toMatchObject({ which: 'bluetooth', state: 'held', got: 'TOYOTA Corolla', trackSampleRate: 8000 });
    endCaptureRoute('t');
    expect(stopped).toEqual(['mic-car']);
  });

  it('Phone speaker holds the iPhone mic', async () => {
    install([CAR, PHONE]);
    setRoutePreferences('phone', 'auto');
    await detectRoute();
    beginCaptureRoute('t');
    await captureRouteSettled();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'mic-phone' } } });
  });

  it('voice stopped while the devices are read: no capture is ever opened (review L1)', async () => {
    install([CAR, PHONE]);
    setRoutePreferences('bluetooth', 'auto');
    await detectRoute();
    beginCaptureRoute('t');
    // Before the hold's enumerate resolves. Opening a capture is what flips
    // the route, so a late open-then-stop is not harmless.
    endCaptureRoute('early');
    await captureRouteSettled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(readDiagnosticLog().some((e) => e.event === 'route-hold' && e.detail?.state === 'held')).toBe(false);
  });

  it('a hold whose capture lands after voice stopped is released at once', async () => {
    install([CAR, PHONE]);
    let land: () => void = () => {};
    const gate = new Promise<void>((r) => (land = r));
    const inner = getUserMedia.getMockImplementation()!;
    getUserMedia.mockImplementation(async (c) => {
      await gate;
      return inner(c);
    });
    setRoutePreferences('bluetooth', 'auto');
    await detectRoute();
    beginCaptureRoute('t');
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    endCaptureRoute('late');
    land();
    await captureRouteSettled();
    expect(stopped).toEqual(['mic-car']);
    expect(readDiagnosticLog().some((e) => e.event === 'route-hold' && e.detail?.state === 'held')).toBe(false);
  });

  it('a new begin releases the previous hold and drops its declaration (review H1)', async () => {
    install([CAR, PHONE]);
    await detectRoute();
    // A Settings test that never ended its plan...
    beginCaptureRoute('settings-test', { strategy: 'play-and-record', hold: 'bluetooth', evidence: 'drive-decides', why: 't' });
    await captureRouteSettled();
    expect(session.type).toBe('play-and-record');
    expect(stopped).toEqual([]);
    // ...must not leak into the next (Auto) drill.
    const plan = beginCaptureRoute('voice-on');
    expect(plan.strategy).toBe('web-audio');
    expect(stopped).toEqual(['mic-car']);
    expect(session.type).toBe('auto');
  });

  it('the sink id is offered only while a speaker-sink plan is in force', async () => {
    install([PHONE, SPEAKER_OUT]);
    (globalThis as { HTMLMediaElement?: unknown }).HTMLMediaElement = class {
      setSinkId() {}
    };
    try {
      setRoutePreferences('auto', 'speaker-sink');
      await detectRoute();
      expect(routeSinkId()).toBeNull();
      beginCaptureRoute('t');
      expect(routeSinkId()).toBe('out-spk');
      endCaptureRoute('t');
      expect(routeSinkId()).toBeNull();
    } finally {
      delete (globalThis as { HTMLMediaElement?: unknown }).HTMLMediaElement;
    }
  });

  it('the snapshot line carries every reading a drive log needs', async () => {
    install([CAR, PHONE]);
    await logRouteSnapshot('t');
    const row = readDiagnosticLog().find((e) => e.event === 'route-snapshot');
    expect(row?.detail).toMatchObject({
      kind: 'bluetooth',
      guess: 'car',
      first: 'TOYOTA Corolla',
      inputs: 'TOYOTA Corolla | iPhone Microphone',
      outputs: 'none',
      sinkId: false,
      plan: 'web-audio',
      hold: 'none',
      evidence: 'drive-decides',
    });
  });
});

describe('a route not yet named', () => {
  it('holds what the setting asks for, to be resolved once the mic is open', () => {
    const unknown = classifyInputs([]);
    expect(planRoute('bluetooth', 'auto', unknown).hold).toBe('bluetooth');
    expect(planRoute('phone', 'auto', unknown).hold).toBe('phone');
    expect(planRoute('auto', 'auto', unknown).hold).toBe('none');
  });
});

describe('a phone-mic hold with no Bluetooth', () => {
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  afterEach(() => {
    endCaptureRoute('t');
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });

  it('opens nothing: the phone mic is the route already', async () => {
    clearDiagnosticLog();
    _resetAudioRouteForTest();
    const getUserMedia = vi.fn();
    Object.defineProperty(globalThis, 'navigator', {
      value: { mediaDevices: { enumerateDevices: async () => [PHONE], getUserMedia } },
      configurable: true,
      writable: true,
    });
    setRoutePreferences('phone', 'auto');
    // Planned before the inputs were named, as at a cold voice-on.
    beginCaptureRoute('t');
    await captureRouteSettled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(readDiagnosticLog().find((e) => e.event === 'route-hold')?.detail).toMatchObject({ state: 'not-needed' });
  });
});
