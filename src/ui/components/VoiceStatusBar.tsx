import type { ReactNode } from 'react';
import { micSessionCostPaid } from '../../audio/micSessionCost';
import type { VoiceStatus } from '../useVoiceControl';
import { VOICE_STATE_LABEL, VOICE_WORDS, describeVerdict } from '../voiceLabels';

/**
 * The listening strip: what the microphone is doing, what it last heard, and
 * what may be said to it.
 *
 * `hint` replaces only the last line, because the vocabulary differs per
 * screen -- "yes" deals a hand at the table and confirms a count in a drill
 * -- while the state and the last-heard readout never do.
 *
 * The earpiece line appears only once a session has actually opened, which is
 * why it is read here rather than passed in: seven screens render this strip
 * and the cost belongs to the page, not to any of them. It is not a warning to
 * act on -- there is no action -- it is the answer to "why has it gone quiet",
 * which otherwise arrives as a mystery mid-drive. See audio/micSessionCost.ts.
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
      {micSessionCostPaid() && (
        <span className="voice-status-earpiece">
          If the sound moved to the earpiece, the microphone did it &mdash; Settings,
          &ldquo;Sound with the mic on&rdquo;.
        </span>
      )}
    </div>
  );
}
