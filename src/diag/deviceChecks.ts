/**
 * The checks only the phone can answer.
 *
 * WHY THIS IS SEPARATE FROM THE LOGIC SUITE. Jack asked for "all the tests you
 * run" on the device, and the first answer to that was the wrong half: a suite
 * of strategy, counting and rounding cases, every one of which the desktop
 * suite already runs five thousand times in ten seconds. He said so
 * (2026-10-04): "This wasn't the main thing I wanted to test. Supposed to test
 * functionality more like the field test rather than the logic which can start
 * testing on the computer."
 *
 * So: every check here does real I/O against a real capability, and every one
 * of them would be meaningless on the development machine -- which has no
 * Bluetooth head unit, no `navigator.audioSession`, no iOS audio routing, no
 * screen to keep awake, and a service worker that never has to survive a
 * tunnel. These are the facts a drive depends on and a desk cannot establish.
 *
 * THE ONE THAT MATTERS MOST is the handoff. Everything about the earpiece
 * comes down to a question no desktop browser can be asked: once the
 * microphone HAS been open, does closing it and declaring playback give the
 * loud speaker back? `handoffRouteCheck` is the measurement, and it runs in
 * its own phase for that reason -- see carCheck.ts on why the phase exists.
 */

import { diag } from './diagnosticLog';
import { isStale } from '../updateCheck';
import {
  audioSessionSupported,
  readAudioSessionType,
  requestAudioSessionType,
} from '../audio/audioSession';
import { isWakeLockActive, requestWakeLock, releaseWakeLock } from '../audio/wakeLock';
import type { CheckDefinition, CheckResult } from './carCheck';

const pass = (id: string, summary: string, detail?: Record<string, unknown>): CheckResult => ({
  id,
  outcome: 'pass',
  summary,
  detail,
});
const fail = (id: string, summary: string, detail?: Record<string, unknown>): CheckResult => ({
  id,
  outcome: 'fail',
  summary,
  detail,
});
const warn = (id: string, summary: string, detail?: Record<string, unknown>): CheckResult => ({
  id,
  outcome: 'warn',
  summary,
  detail,
});

/**
 * How long the microphone may take to come back before it is worth a warning.
 *
 * The 2026-10-04 drive measured `confirmedInMs=1233` for a restart. Every
 * push-to-talk press pays a restart before the window can hear anything, so
 * at three seconds a press is mostly waiting.
 */
export const RESTART_BUDGET_MS = 3000;

/* ------------------------------------------------------------------------ */
/* The handoff -- the question the whole earpiece problem comes down to      */
/* ------------------------------------------------------------------------ */

/**
 * With the microphone shut AFTER having been open, and playback declared:
 * does a clip come out of the loud speaker?
 *
 * Runs in the 'handoff' phase, which exists so that "the microphone is shut"
 * and "the microphone has never been open" cannot be confused -- on iOS they
 * are completely different audio states and only the second one has ever
 * reliably used the loudspeaker.
 *
 * Deliberately inconclusive by itself. The app can establish that a sound was
 * made, and which category the session was in while it was; which speaker it
 * left by is a judgement, and recording a pass for it would be the app
 * answering its own question. The panel asks. What makes the answer useful is
 * that `output-route` asked the SAME question moments earlier with the
 * microphone open, so the pair is a comparison rather than an impression.
 */
export function handoffRouteCheck(playClip: () => Promise<string>): CheckDefinition {
  return {
    id: 'handoff-route',
    label: 'Which speaker it uses once the microphone has closed',
    phase: 'handoff',
    askOperator:
      'Same question again, now with the microphone shut: loud speaker at the bottom, or quiet earpiece at the top? If this one was loud and the last one was not, the handoff works.',
    run: async () => {
      const before = readAudioSessionType() ?? 'unknown';
      // THE ORDER IS THE POINT. Declare playback now, with nothing capturing,
      // which is the one sequence WebKit bug 218012 reports as working.
      // Declaring it mid-capture was tried on the 2026-10-04 drive and did
      // nothing at all.
      const asked = requestAudioSessionType('playback');
      const after = readAudioSessionType() ?? 'unknown';
      const how = await playClip();
      const detail = {
        sessionSupported: audioSessionSupported(),
        sessionWas: before,
        sessionType: after,
        accepted: asked,
        how,
      };
      if (how !== 'ended') {
        return fail(
          'handoff-route',
          `Nothing played (${how}), so there was nothing to listen to.`,
          detail,
        );
      }
      return warn(
        'handoff-route',
        `Played with the microphone shut, session type "${after}". Only you can say which speaker that was.`,
        detail,
      );
    },
  };
}

/**
 * How long the microphone takes to come back after being closed.
 *
 * Measured rather than assumed, because every push-to-talk press reopens the
 * microphone and the window cannot hear anything until it has. A device where
 * the recogniser refuses to restart leaves voice answers deaf after the first
 * press, so a failure here matters more than a slow result.
 */
export function micRestartCheck(
  reopenMic: () => Promise<boolean>,
  budgetMs = RESTART_BUDGET_MS,
): CheckDefinition {
  return {
    id: 'mic-restart',
    label: 'The microphone comes back after being closed',
    phase: 'handoff',
    run: async () => {
      const startedAt = Date.now();
      let live: boolean;
      try {
        live = await reopenMic();
      } catch (e) {
        return fail('mic-restart', `The microphone would not reopen: ${describe(e)}`, {
          waitedMs: Date.now() - startedAt,
        });
      }
      const ms = Date.now() - startedAt;
      if (!live) {
        // The worst outcome of the three, and the reason this check exists:
        // a recogniser that cannot restart hears nothing after the first
        // push-to-talk window.
        return fail(
          'mic-restart',
          `The microphone did not come back within ${ms}ms. Push to talk would go deaf after the first press -- use Answer on the wheel.`,
          { ms, budgetMs },
        );
      }
      if (ms > budgetMs) {
        return warn(
          'mic-restart',
          `It came back, but took ${ms}ms. Every push-to-talk press waits that long before it can hear.`,
          { ms, budgetMs },
        );
      }
      return pass('mic-restart', `Back in ${ms}ms.`, { ms, budgetMs });
    },
  };
}

/* ------------------------------------------------------------------------ */
/* The rest: capabilities a drive depends on and a desk cannot establish     */
/* ------------------------------------------------------------------------ */

/**
 * Will the screen stay awake?
 *
 * A drill is eyes-free, so the phone sits in a pocket or a cradle with nobody
 * touching it -- and on iOS a locked screen suspends the page, which stops
 * the audio and the recogniser both. The lock is requested by every drill and
 * silently refused in plenty of circumstances (a background tab, low power
 * mode, an unsupported browser), and a refusal is invisible until the drill
 * dies mid-shoe.
 */
export function wakeLockCheck(): CheckDefinition {
  return {
    id: 'wake-lock',
    label: 'The screen can be kept awake',
    phase: 'speaker',
    run: async () => {
      const held = isWakeLockActive();
      if (held) {
        // Already held by the screen that opened this check. Releasing it to
        // measure it would be a diagnostic switching the screen off.
        return pass('wake-lock', 'Held right now.', { alreadyHeld: true });
      }
      try {
        await requestWakeLock('device-check');
        const got = isWakeLockActive();
        await releaseWakeLock('device-check');
        if (!got) {
          return fail(
            'wake-lock',
            'This browser refused to keep the screen awake, so a drill will stop when the screen locks.',
            { alreadyHeld: false },
          );
        }
        return pass('wake-lock', 'Granted and released.', { alreadyHeld: false });
      } catch (e) {
        return fail('wake-lock', `The screen lock could not be taken: ${describe(e)}`);
      }
    },
  };
}

/**
 * Is the recorded voice on this device, or does it need the network?
 *
 * The drill speaks on every answer, and a tunnel is the normal case on the
 * roads this is used on. Clips are served as static files behind a service
 * worker; if they are not in the cache, the voice falls back to live speech
 * synthesis mid-drill -- which is the "it changed voice" report from the road,
 * and is the one failure a desk can never see, because a desk is never
 * offline.
 */
export function offlineClipCheck(clipUrl: () => Promise<string | null>): CheckDefinition {
  return {
    id: 'offline-clips',
    label: 'The recorded voice is stored on the phone',
    phase: 'speaker',
    run: async () => {
      if (typeof caches === 'undefined') {
        return warn(
          'offline-clips',
          'This browser has no cache storage, so nothing can be checked. In a tunnel the voice will fall back.',
        );
      }
      const url = await clipUrl();
      if (!url) {
        return warn('offline-clips', 'No clip to look for -- the recorded voice is not in use.');
      }
      try {
        // `caches.match` across all caches, which is what the service worker
        // would consult: asking a named cache would make this a test of the
        // name rather than of whether the file is there.
        const hit = await caches.match(url);
        if (!hit) {
          return fail(
            'offline-clips',
            'The recorded voice is not cached, so it needs the network. Open a drill on Wi-Fi once to store it.',
            { url },
          );
        }
        return pass('offline-clips', 'Cached -- it will speak in a tunnel.', { url });
      } catch (e) {
        return warn('offline-clips', `The cache could not be read: ${describe(e)}`, { url });
      }
    },
  };
}

/**
 * Can this phone keep a setting?
 *
 * Private browsing, a full quota and an evicted PWA all present the same way:
 * every setting resets on the next launch, and nothing says so. Writing a
 * probe and reading it back is the only way to know, and it cannot be done
 * from a desk because the desk's storage always works.
 */
export interface ProbeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_PROBE_KEY = 'bjtrainer.devicecheck.probe';

export function storageCheck(store: ProbeStorage | null): CheckDefinition {
  return {
    id: 'storage',
    label: 'Settings survive a relaunch',
    phase: 'speaker',
    run: async () => {
      if (!store) {
        return fail(
          'storage',
          'This browser exposes no storage, so every setting resets on the next launch.',
        );
      }
      const value = `probe-${Date.now()}`;
      try {
        store.setItem(STORAGE_PROBE_KEY, value);
        const got = store.getItem(STORAGE_PROBE_KEY);
        store.removeItem(STORAGE_PROBE_KEY);
        if (got !== value) {
          return fail(
            'storage',
            'Storage accepted a value and gave back something else. Settings will not survive a relaunch.',
            { wrote: value, read: got },
          );
        }
        if (store.getItem(STORAGE_PROBE_KEY) !== null) {
          return fail('storage', 'Storage will not delete a key, so the log cannot be cleared.');
        }
        return pass('storage', 'Written, read back and deleted.');
      } catch (e) {
        return fail(
          'storage',
          `Storage refused: ${describe(e)}. Every setting will reset on the next launch.`,
        );
      }
    },
  };
}

/**
 * Is this phone running the build that was deployed?
 *
 * THE FAULT THAT COSTS A WHOLE DRIVE. A PWA serves its own cached shell, so a
 * deploy does not necessarily reach the phone, and the symptom is that a fix
 * "did not work" when it was never actually there. Every drive log has to be
 * read against the build that produced it, and the worst way to learn the
 * build was stale is afterwards.
 *
 * Unanswerable on a desk, which reloads from a dev server every time and has
 * no service worker holding a shell from last week.
 */
export function buildCheck(
  running: () => string | null,
  deployed: () => Promise<string | null>,
): CheckDefinition {
  return {
    id: 'build',
    label: 'This phone is running the build that was deployed',
    phase: 'speaker',
    run: async () => {
      const here = running();
      if (!here) {
        return warn('build', 'This build carries no identifier, so the log cannot name it.');
      }
      let there: string | null;
      try {
        there = await deployed();
      } catch (e) {
        // No signal is not a stale build. A tunnel would otherwise report
        // one, which is a false alarm in exactly the place this app is used.
        return warn('build', `Running ${here}. Could not reach the server: ${describe(e)}.`, {
          build: here,
        });
      }
      if (!there) {
        return warn('build', `Running ${here}. The server did not say which build is current.`, {
          build: here,
        });
      }
      diag('env', 'build-check', { build: here, deployed: there });
      if (isStale(here, there)) {
        return fail(
          'build',
          `This phone is running ${here} but ${there} is deployed. Close every tab and reopen, or a fix you are testing may not be here.`,
          { build: here, deployed: there },
        );
      }
      return pass('build', `Running ${here}, which is current.`, { build: here, deployed: there });
    },
  };
}

/**
 * The handoff phase, in the only order that can work.
 *
 * `mic-restart` REOPENS THE MICROPHONE. Running it before `handoff-route`
 * would mean the route measurement happened with the microphone open again --
 * measuring the state the handoff is supposed to escape, and agreeing with
 * `output-route` every time. That is a test that cannot fail, so the order is
 * a function with a test on it rather than a comment next to an array.
 */
export function handoffPhaseChecks(deps: {
  playClip: () => Promise<string>;
  reopenMic: () => Promise<boolean>;
}): CheckDefinition[] {
  return [
    // Listen first, with the microphone still down.
    handoffRouteCheck(deps.playClip),
    // Then find out what getting it back costs.
    micRestartCheck(deps.reopenMic),
  ];
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
