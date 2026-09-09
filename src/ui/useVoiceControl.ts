import { useEffect, useRef, useState } from 'react';
import {
  createVoiceController,
  browserRecognition,
  type ListenState,
  type HeardVerdict,
  type VoiceController,
} from '../audio/voiceControl';
import { setSpeechActivityListener } from '../audio/speech';
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
}: {
  enabled: boolean;
  onAction: (action: VoiceAction) => void;
  /** First refusal on every transcript, for a modal that owns the
   * microphone -- a count check asking for a number the command vocabulary
   * does not contain. Return a label to consume it, null to pass it on. */
  onTranscript?: (heard: string) => string | null;
  /** Words to bias the engine toward, where the browser supports it. */
  biasPhrases?: string[];
}): { status: VoiceStatus; cycleIfStale: () => void } {
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
      onTranscript: (heard) => transcriptRef.current?.(heard) ?? null,
      biasPhrases,
      onState: (state) => setStatus((prev) => ({ ...prev, state })),
      onHeard: (heard, verdict) => setStatus((prev) => ({ ...prev, heard, verdict })),
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
  }, [enabled]);

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
