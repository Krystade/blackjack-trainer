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
}: {
  enabled: boolean;
  onAction: (action: VoiceAction) => void;
}): { status: VoiceStatus; cycleIfStale: () => void } {
  const [status, setStatus] = useState<VoiceStatus>(IDLE);

  // The handler closes over drill state that changes every render. Holding
  // the latest one in a ref means the recogniser is never torn down and
  // rebuilt just because a card changed -- a rebuild costs a real gap in
  // listening, and would land in the middle of an answer.
  const actionRef = useRef(onAction);
  actionRef.current = onAction;

  const controllerRef = useRef<VoiceController | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const controller = createVoiceController({
      createRecognition: browserRecognition,
      now: () => Date.now(),
      schedule: (fn, ms) => window.setTimeout(fn, ms),
      cancel: (handle) => window.clearTimeout(handle),
      onAction: (action) => actionRef.current(action),
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
