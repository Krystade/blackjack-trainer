import { BottomSheet } from './BottomSheet';
import { NumPad } from './NumPad';
import { withMinusSigns } from '../../drills/signed';

/**
 * T1-1B: a Play distraction, the same sheet-and-keypad as the count check.
 * The sum is answered, then (with count checks on) the running count is asked:
 * was it kept through the talk?
 */
export function PlayDistractionSheet({
  prompt,
  onSubmit,
  banner,
  halves = false,
}: {
  prompt: string;
  /** Expert's division: the keypad takes a .5. */
  halves?: boolean;
  onSubmit: (answer: number) => void;
  /** The settled round's result: the sheet covers the felt's copy, which is hidden while this shows. */
  banner: string | null;
}) {
  return (
    <BottomSheet title="Quick: what's this?">
      {banner !== null && (
        <p className="count-sheet-banner" data-testid="distraction-sheet-banner">
          {banner}
        </p>
      )}
      <p className="play-distraction-prompt" data-testid="play-distraction-prompt">
        {withMinusSigns(prompt)}
      </p>
      <NumPad label="Enter the answer" onSubmit={onSubmit} halves={halves} />
    </BottomSheet>
  );
}
