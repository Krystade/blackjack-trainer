import { markMicSessionOpened } from './micSessionCost';

/**
 * `navigator.mediaDevices.getUserMedia`, plus the bookkeeping that every
 * caller needs: once a microphone has been opened in this page load iOS keeps
 * <audio> elements on the earpiece, so clips and chimes must move to Web
 * Audio (see micSessionCost.ts). Marking only when the recogniser reached
 * 'listening' missed every other capture path (ambient measurement, spectrum,
 * input logging, the test kit recorder). Marked on resolve, since a refused
 * permission opens nothing. Callers keep their own guards for a missing
 * `getUserMedia`; this throws like the original if it is absent.
 */
export async function openMicStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  markMicSessionOpened();
  return stream;
}
