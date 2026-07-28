/**
 * R7 (docs/BACKLOG.md, count-peek accountability): format the "this session's
 * accuracy was peek-assisted" flag from a session's peek count. The RC/TC peek
 * button is a legitimate training aid we deliberately keep available in both
 * modes (RT#5's fix is accountability, not removal) -- so instead of hiding the
 * button we surface a flag whenever peeks were used, making a test-mode
 * accuracy number impossible to mistake for an unassisted one.
 *
 * Returns `null` for the common, unassisted case (0 / undefined / any
 * non-positive count) so callers render nothing at all -- a "0 peeks" badge
 * would clutter the UI for the overwhelmingly common path. `undefined` is the
 * legacy shape: sessions persisted before R7 simply lack the field.
 */
export function assistedFlag(peeks: number | undefined): string | null {
  if (!peeks || peeks <= 0) return null;
  return `assisted — used ${peeks} peek${peeks === 1 ? '' : 's'}`;
}
