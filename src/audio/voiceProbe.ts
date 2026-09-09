import { detectVoiceSupport, matchVoiceAction } from './voiceRecognition';

/**
 * A recognition session that records what actually happened, for reading back
 * later.
 *
 * This exists because the two questions that decide whether voice input is
 * buildable cannot be answered from a development machine:
 *
 *   1. Does recognition work at all on the operator's iPhone, in the car,
 *      inside an installed home-screen PWA?
 *   2. Does it survive a BACKGROUNDED Chrome tab? Chrome throttles hidden
 *      tabs hard and recognition sessions commonly end on their own, so a
 *      design assuming a long-lived `continuous` session may quietly stop the
 *      moment the tab loses focus -- which is exactly the case being asked
 *      for.
 *
 * Playwright's Chromium answers neither: it exposes the entire API surface
 * and then fires no events at all, because there is no microphone and no
 * speech backend behind it. So the evidence has to be collected on real
 * devices, by the operator, who will be driving or doing something else --
 * which is why this persists every event rather than logging to a console
 * nobody can watch.
 *
 * Visibility changes are recorded in the SAME timeline as recognition events.
 * That interleaving is the whole point for question 2: it makes "the session
 * ended 400ms after the tab was hidden" visible as a fact rather than a
 * suspicion.
 */

const STORAGE_KEY = 'bjtrainer.voiceProbe.v1';
const MAX_ENTRIES = 300;

export type ProbeKind = 'start' | 'end' | 'error' | 'result' | 'visibility' | 'note' | 'restart';

export interface ProbeEntry {
  at: string;
  /** Milliseconds since the probe was started -- the axis that matters when
   * correlating an end against a backgrounding. */
  t: number;
  kind: ProbeKind;
  detail: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readProbeLog(): ProbeEntry[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is ProbeEntry =>
        !!e && typeof e === 'object' && typeof (e as ProbeEntry).kind === 'string',
    );
  } catch {
    return [];
  }
}

function write(entries: ProbeEntry[]): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* quota or private mode -- a diagnostic must never break the app */
  }
}

export function clearProbeLog(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

let startedAt = 0;

export function appendProbe(kind: ProbeKind, detail: string): void {
  const entries = readProbeLog();
  entries.push({
    at: new Date().toISOString(),
    t: startedAt ? Date.now() - startedAt : 0,
    kind,
    detail,
  });
  write(entries);
}

export interface ProbeHandle {
  stop: () => void;
}

/**
 * Start a probe session. Returns a handle whose `stop` tears everything down.
 *
 * `autoRestart` is the setting the background question turns on: browsers end
 * a recognition session by themselves (on silence, on a tab losing focus, on
 * their own timers), and the only way to hold a long session is to restart on
 * `end`. Restarts are LOGGED rather than hidden, because "it worked, but it
 * silently restarted 40 times in five minutes" is a materially different
 * answer from "it worked", and only one of them is a design worth shipping.
 */
export function startVoiceProbe(opts: { autoRestart: boolean }): ProbeHandle {
  startedAt = Date.now();
  const support = detectVoiceSupport();
  appendProbe('note', `support api=${support.api} flavour=${support.flavour} media=${support.media}`);
  appendProbe(
    'note',
    `agent=${typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent}`,
  );
  appendProbe(
    'note',
    `standalone=${
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(display-mode: standalone)')?.matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true)
    }`,
  );

  const w = window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) {
    appendProbe('error', 'no SpeechRecognition constructor on this browser');
    return { stop: () => {} };
  }

  let stopped = false;
  let recognition: any = null;

  const onVisibility = (): void => {
    appendProbe('visibility', document.visibilityState);
  };
  document.addEventListener('visibilitychange', onVisibility);

  const begin = (): void => {
    if (stopped) return;
    try {
      recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => appendProbe('start', 'recognition started');
      recognition.onerror = (e: { error?: string }) =>
        appendProbe('error', e?.error ?? 'unknown');
      recognition.onresult = (e: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => {
        const results = e?.results;
        if (!results) return;
        const last = results[results.length - 1];
        const transcript = last?.[0]?.transcript ?? '';
        const matched = matchVoiceAction(transcript);
        appendProbe(
          'result',
          `heard="${transcript.trim()}" -> ${matched ?? 'REJECTED'} (visibility=${document.visibilityState})`,
        );
      };
      recognition.onend = () => {
        appendProbe('end', `session ended (visibility=${document.visibilityState})`);
        if (opts.autoRestart && !stopped) {
          appendProbe('restart', 'auto-restarting after end');
          // A small delay: restarting synchronously inside onend throws on
          // some engines and busy-loops on others when the mic is unavailable.
          setTimeout(begin, 400);
        }
      };

      recognition.start();
    } catch (e) {
      appendProbe('error', `start threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  begin();

  return {
    stop: () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      try {
        recognition?.abort?.();
      } catch {
        /* tearing down must never throw */
      }
      appendProbe('note', 'probe stopped by operator');
    },
  };
}

/** The log as pasteable text, with the summary a reader actually needs first. */
export function formatProbeLog(entries: ProbeEntry[] = readProbeLog()): string {
  const heard = entries.filter((e) => e.kind === 'result');
  const errors = [...new Set(entries.filter((e) => e.kind === 'error').map((e) => e.detail))];
  const ends = entries.filter((e) => e.kind === 'end').length;
  const restarts = entries.filter((e) => e.kind === 'restart').length;
  const hiddenEnds = entries.filter(
    (e) => e.kind === 'end' && e.detail.includes('visibility=hidden'),
  ).length;

  return [
    'Blackjack Trainer — voice recognition probe',
    `captured: ${new Date().toISOString()}`,
    '',
    `phrases heard: ${heard.length}`,
    `matched: ${heard.filter((e) => !e.detail.includes('REJECTED')).length}`,
    `errors: ${errors.length ? errors.join(', ') : '(none)'}`,
    `sessions ended: ${ends}  (while tab hidden: ${hiddenEnds})`,
    `auto-restarts: ${restarts}`,
    '',
    '--- timeline (t = ms since start) ---',
    ...entries.map((e) => `${String(e.t).padStart(7)}ms  ${e.kind.padEnd(10)} ${e.detail}`),
  ].join('\n');
}
