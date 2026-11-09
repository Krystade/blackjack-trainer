import { BottomSheet } from './BottomSheet';
import { NumPad } from './NumPad';
import { withMinusSigns } from '../../drills/signed';

/**
 * T1-1B: a Play distraction, the same sheet-and-keypad as the count check.
 * The sum is answered, then (with count checks on) the running count is asked:
 * was it kept through the talk?
 */
export function PlayDistractionSheet({ prompt, onSubmit }: { prompt: string; onSubmit: (answer: number) => void }) {
  return (
    <BottomSheet title="Quick: what's this?">
      <p className="play-distraction-prompt" data-testid="play-distraction-prompt">
        {withMinusSigns(prompt)}
      </p>
      <NumPad label="Enter the answer" onSubmit={onSubmit} />
    </BottomSheet>
  );
}
