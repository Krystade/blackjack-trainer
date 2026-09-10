import type { ReactNode } from 'react';
import type { VoiceStatus } from '../useVoiceControl';
import { VOICE_STATE_LABEL, VOICE_WORDS, describeVerdict } from '../voiceLabels';

/**
 * The listening strip: what the microphone is doing, what it last heard, and
 * what may be said to it.
 *
 * `hint` replaces only the last line, because the vocabulary differs per
 * screen -- "yes" deals a hand at the table and confirms a count in a drill
 * -- while the state and the last-heard readout never do.
 */
export function VoiceStatusBar({ status, hint }: { status: VoiceStatus; hint?: ReactNode }) {
  return (
    <div className="voice-status" data-voice-state={status.state}>
      <span className="voice-status-state">{VOICE_STATE_LABEL[status.state]}</span>
      {status.heard && (
        <span className="voice-status-heard">
          &ldquo;{status.heard}&rdquo; &rarr; {describeVerdict(status.verdict)}
        </span>
      )}
      <span className="voice-status-words">{hint ?? <>Say: {VOICE_WORDS}</>}</span>
    </div>
  );
}
