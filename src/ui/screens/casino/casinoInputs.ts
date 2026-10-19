/**
 * Converting between the log's values and the text in the Casino tab's form
 * fields. Kept apart from the components (fields.tsx) so that file exports
 * components only.
 */

/** An ISO instant as a `datetime-local` value (local time, minutes). */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A `datetime-local` value back to ISO; null when empty or unreadable. */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** An amount as the text a money field starts with. */
export function moneyText(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : String(n);
}
