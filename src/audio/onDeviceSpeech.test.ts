import { describe, it, expect, afterEach } from 'vitest';
import {
  onDeviceProbeCrashed,
  clearOnDeviceProbeGuard,
  onDeviceStatus,
  installOnDevice,
  prefersOnDevice,
  setPrefersOnDevice,
  shouldProcessLocally,
  describeOnDeviceStatus,
  type OnDeviceStatus,
} from './onDeviceSpeech';

/**
 * The behaviour every test here is built around, measured rather than assumed:
 * `install()` can resolve FALSE, immediately, with a real user gesture, and
 * without throwing or explaining. A refusal carries no reason, so the only
 * trustworthy answer to "did it work" is to ask `available()` again.
 */

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function setWindow(value: unknown): void {
  Object.defineProperty(globalThis, 'window', { value, configurable: true, writable: true });
}

function fakeStorage(): void {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete (globalThis as { window?: unknown }).window;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('onDeviceStatus', () => {
  it('reports what the browser said', async () => {
    for (const raw of ['available', 'downloadable', 'downloading', 'unavailable']) {
      setWindow({ SpeechRecognition: { available: async () => raw } });
      expect(await onDeviceStatus()).toBe(raw);
    }
  });

  it('asks about the LOCAL model, not the cloud one', async () => {
    let asked: unknown = null;
    setWindow({
      SpeechRecognition: {
        available: async (opts: unknown) => {
          asked = opts;
          return 'downloadable';
        },
      },
    });
    await onDeviceStatus();
    expect(asked).toEqual({ langs: ['en-US'], processLocally: true });
  });

  it('says unsupported where the API is missing entirely', async () => {
    setWindow({});
    expect(await onDeviceStatus()).toBe('unsupported');
  });

  // A value from a newer build is not a "no". Reporting it as unavailable
  // would quietly hide a model that might be installed.
  it('does not mistake an unrecognised answer for a refusal', async () => {
    setWindow({ SpeechRecognition: { available: async () => 'some-future-state' } });
    expect(await onDeviceStatus()).toBe('unknown');
  });

  it('survives a query that throws', async () => {
    setWindow({
      SpeechRecognition: {
        available: async () => {
          throw new TypeError('bad options');
        },
      },
    });
    expect(await onDeviceStatus()).toBe('unknown');
  });
});

describe('installOnDevice', () => {
  /**
   * The case observed in a real browser: install resolves false at once, and
   * the model is still merely downloadable. Reporting success here would put
   * a green tick on a feature that does not exist.
   */
  it('believes available() over a refusal from install()', async () => {
    setWindow({
      SpeechRecognition: {
        install: async () => false,
        available: async () => 'downloadable',
      },
    });
    expect(await installOnDevice()).toEqual({ accepted: false, status: 'downloadable' });
  });

  /**
   * And the mirror case, which is why the re-query exists at all: a browser
   * that already holds the model can decline to install and still be ready.
   */
  it('believes available() over a refusal, even when that means success', async () => {
    setWindow({
      SpeechRecognition: {
        install: async () => false,
        available: async () => 'available',
      },
    });
    // `accepted` still reports the refusal honestly; `status` is the answer.
    expect(await installOnDevice()).toEqual({ accepted: false, status: 'available' });
  });

  it('reports the download having started', async () => {
    setWindow({
      SpeechRecognition: {
        install: async () => true,
        available: async () => 'downloading',
      },
    });
    expect(await installOnDevice()).toEqual({ accepted: true, status: 'downloading' });
  });

  it('treats a throwing install as a refusal rather than crashing', async () => {
    setWindow({
      SpeechRecognition: {
        install: async () => {
          throw new Error('no');
        },
        available: async () => 'downloadable',
      },
    });
    expect(await installOnDevice()).toEqual({ accepted: false, status: 'downloadable' });
  });

  it('says unsupported rather than pretending, where there is no install', async () => {
    setWindow({ SpeechRecognition: {} });
    expect(await installOnDevice()).toEqual({ accepted: false, status: 'unsupported' });
  });
});

/**
 * The crash guard.
 *
 * Measured, across two builds of the same browser:
 *
 *   Chrome 152    available({langs:['en-US'], processLocally:true}) -> "downloadable"
 *   Chromium 149  available({langs:['en-US'], processLocally:true}) -> RENDERER CRASH
 *
 * The promise never settles and the page dies, so there is nothing to catch;
 * and the two builds expose an identical API surface, so there is nothing to
 * feature-detect either. All that is left is to notice afterwards, which is
 * what the breadcrumb is for: set before the call, cleared after it, and
 * still set on the next load only if the call never came back.
 */
describe('the crash guard', () => {
  it('leaves no breadcrumb behind a query that returns', async () => {
    fakeStorage();
    setWindow({ SpeechRecognition: { available: async () => 'downloadable' } });
    await onDeviceStatus();
    expect(onDeviceProbeCrashed()).toBe(false);
  });

  it('leaves none behind a query that throws, which is a normal failure', async () => {
    fakeStorage();
    setWindow({
      SpeechRecognition: {
        available: async () => {
          throw new TypeError('bad options');
        },
      },
    });
    await onDeviceStatus();
    expect(onDeviceProbeCrashed()).toBe(false);
  });

  // The real case: the promise never settles, because the renderer is gone.
  // Nothing awaits it here for the same reason nothing could await it there.
  it('leaves a breadcrumb while a query has not come back', async () => {
    fakeStorage();
    setWindow({ SpeechRecognition: { available: () => new Promise<string>(() => {}) } });
    void onDeviceStatus();
    await Promise.resolve();
    expect(onDeviceProbeCrashed()).toBe(true);
  });

  /**
   * The property that matters. Without this, a browser that dies on the query
   * dies on it again every single time the operator opens the app.
   */
  it('refuses to ask a browser that did not survive being asked', async () => {
    fakeStorage();
    let asked = 0;
    setWindow({
      SpeechRecognition: {
        available: () => {
          asked++;
          return new Promise<string>(() => {});
        },
      },
    });

    void onDeviceStatus();
    await Promise.resolve();
    expect(asked).toBe(1);

    // A later load, finding the breadcrumb still set.
    expect(await onDeviceStatus()).toBe('unknown');
    expect(asked).toBe(1);
  });

  // A browser update can fix the underlying crash, so there has to be a way
  // back that is not "clear all site data".
  it('can be released, so a fixed browser gets another chance', async () => {
    fakeStorage();
    let asked = 0;
    setWindow({
      SpeechRecognition: {
        available: async () => {
          asked++;
          return 'available';
        },
      },
    });

    localStorage.setItem('bjtrainer.voiceLocalProbe.v1', 'pending');
    expect(await onDeviceStatus()).toBe('unknown');
    expect(asked).toBe(0);

    clearOnDeviceProbeGuard();
    expect(await onDeviceStatus()).toBe('available');
    expect(asked).toBe(1);
  });

  // The guard is a safety net, not a gate on browsers that never had one.
  it('does not report a crash on a device that has never been asked', () => {
    fakeStorage();
    expect(onDeviceProbeCrashed()).toBe(false);
  });
});

describe('shouldProcessLocally', () => {
  /**
   * The safety rule. Switching to local processing without an installed model
   * risks a recogniser that starts and then hears nothing -- failing silently
   * in a car is worse than using the network path that already works.
   */
  it('requires an installed model, not merely a preference', () => {
    const notReady: OnDeviceStatus[] = [
      'downloadable',
      'downloading',
      'unavailable',
      'unsupported',
      'unknown',
    ];
    for (const status of notReady) {
      expect(shouldProcessLocally(status, true)).toBe(false);
    }
  });

  it('stays off when the model is there but was not asked for', () => {
    expect(shouldProcessLocally('available', false)).toBe(false);
  });

  it('is on only when both hold', () => {
    expect(shouldProcessLocally('available', true)).toBe(true);
  });
});

describe('the remembered preference', () => {
  it('round-trips', () => {
    fakeStorage();
    expect(prefersOnDevice()).toBe(false);
    setPrefersOnDevice(true);
    expect(prefersOnDevice()).toBe(true);
    setPrefersOnDevice(false);
    expect(prefersOnDevice()).toBe(false);
  });

  it('defaults to off where storage cannot be read', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('blocked');
        },
      },
      configurable: true,
      writable: true,
    });
    expect(prefersOnDevice()).toBe(false);
  });

  it('does not throw when storage cannot be written', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota');
        },
        removeItem: () => {},
      },
      configurable: true,
      writable: true,
    });
    expect(() => setPrefersOnDevice(true)).not.toThrow();
  });
});

describe('describeOnDeviceStatus', () => {
  it('says something actionable for every status', () => {
    const all: OnDeviceStatus[] = [
      'available',
      'downloadable',
      'downloading',
      'unavailable',
      'unsupported',
      'unknown',
    ];
    for (const status of all) {
      expect(describeOnDeviceStatus(status).length).toBeGreaterThan(20);
    }
  });

  // Every state that is not "installed" must say what happens instead, so a
  // failed download never leaves the impression that voice is now offline.
  it('names the fallback wherever the model is not installed', () => {
    for (const status of ['unavailable', 'unsupported', 'unknown'] as OnDeviceStatus[]) {
      expect(describeOnDeviceStatus(status)).toContain('network');
    }
  });
});
