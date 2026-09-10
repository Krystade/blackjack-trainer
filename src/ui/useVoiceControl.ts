import { useEffect, useRef, useState } from 'react';
import {
  createVoiceController,
  browserRecognition,
  type ListenState,
  type HeardVerdict,
  type VoiceController,
} from '../audio/voiceControl';
import { setSpeechActivityListener } from '../audio/speech';
import { onDeviceStatus, prefersOnDevice, shouldProcessLocally } from '../audio/onDeviceSpeech';
import { recordHeard } from '../audio/voiceHistory';
import type { VoiceAction } from '../audio/voiceRecognition';

/**
 * Speech recognition, wired to a screen.
 *
 * Two things live here that the controller deliberately does not know about:
 * React's render cycle, and the app's own voice. The second is the important
 * one -- this hook subscribes to `speak()` so that every utterance the app
 * makes deafens the microphone for its duration, and the drill screens do not
 * each have to remember to do it at every call site.
 */

export interface VoiceStatus {
  state: ListenState;
  /** The last thing the microphone heard, matched or not. */
  heard: string | null;
  verdict: HeardVerdict | null;
}

const IDLE: VoiceStatus = { state: 'off', heard: null, verdict: null };

export function useVoiceControl({
  enabled,
  onAction,
  onTranscript,
  biasPhrases,
  context,
}: {
  enabled: boolean;
  onAction: (action: VoiceAction) => void;
  /** First refusal on every transcript, for a modal that owns the
   * microphone -- a count check asking for a number the command vocabulary
   * does not contain. Return a label to consume it, null to pass it on. */
  onTranscript?: (heard: string, offered: readonly string[]) => string | null;
  /** Words to bias the engine toward, where the browser supports it. */
  biasPhrases?: string[];
  /**
   * Which screen is listening, recorded with every utterance. A word means
   * different things in each -- "yes" deals a hand at the table and confirms
   * a count in the prompt -- so a log without it cannot be read back.
   */
  context: string;
}): { status: VoiceStatus; cycleIfStale: () => void } {
  // Resolved once, asynchronously, then applied to every session this hook
  // starts. Both halves are required: the operator asked for it AND a model
  // is actually installed.
  const [processLocally, setProcessLocally] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    // Nobody who has not opted in is worth asking about. The query kills the
    // renderer on some builds (see onDeviceSpeech), and for someone who never
    // turned this on the answer could only ever have been "stay on the
    // network" -- which is what not asking already does.
    if (!prefersOnDevice()) return;

    let cancelled = false;
    void onDeviceStatus().then((status) => {
      if (!cancelled) setProcessLocally(shouldProcessLocally(status, true));
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const [status, setStatus] = useState<VoiceStatus>(IDLE);

  // The handler closes over drill state that changes every render. Holding
  // the latest one in a ref means the recogniser is never torn down and
  // rebuilt just because a card changed -- a rebuild costs a real gap in
  // listening, and would land in the middle of an answer.
  const actionRef = useRef(onAction);
  actionRef.current = onAction;

  // Same reasoning: this closes over the prompt's own state, and rebuilding
  // the recogniser whenever that changes would cost a deaf gap at exactly the
  // moment an answer is due.
  const transcriptRef = useRef(onTranscript);
  transcriptRef.current = onTranscript;

  const controllerRef = useRef<VoiceController | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const controller = createVoiceController({
      createRecognition: browserRecognition,
      now: () => Date.now(),
      schedule: (fn, ms) => window.setTimeout(fn, ms),
      cancel: (handle) => window.clearTimeout(handle),
      onAction: (action) => actionRef.current(action),
      onTranscript: (heard, offered) => transcriptRef.current?.(heard, offered) ?? null,
      biasPhrases,
      processLocally,
      onState: (state) => setStatus((prev) => ({ ...prev, state })),
      onHeard: (heard, verdict) => {
        setStatus((prev) => ({ ...prev, heard, verdict }));
        // Kept so the vocabulary can grow from evidence rather than from a
        // lucky glance at the screen mid-drill, which is how "stant" was
        // found and is not a method that works while driving.
        recordHeard(heard, verdict, context);
      },
    });
    controllerRef.current = controller;

    // Deafen the microphone whenever the app talks. Registered only while
    // listening, so nothing pays for this when voice is off.
    setSpeechActivityListener((ms) => controller.suppressFor(ms));
    controller.start();

    return () => {
      setSpeechActivityListener(null);
      controller.stop();
      controllerRef.current = null;
      setStatus(IDLE);
    };
    // `biasPhrases` is intentionally absent: callers build the list inline, so
    // a fresh array every render would tear the recogniser down and rebuild it
    // continuously. The vocabulary is fixed for a session's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, processLocally]);

  return {
    status,
    // Called at a moment the screen knows is quiet -- just after an answer,
    // while feedback is showing -- so the restart gap lands there instead of
    // over the next answer. The gap cannot be removed: one microphone session
    // exists per page, so a spare recogniser would end this one rather than
    // cover for it.
    cycleIfStale: () => controllerRef.current?.cycleIfStale(),
  };
}
