import type { CasinoGame } from '../../../store/casinoLog';

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

/** Wave K: a game's number fields as the form holds them, text until Save. */
export interface GameText {
  minBet: string;
  maxBet: string;
  cut: string;
  roundsPerHour: string;
  /** Wave M: a card room's commission, dollars per $100. */
  commission: string;
}

export function gameText(g: CasinoGame): GameText {
  const t = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
  return { minBet: t(g.minBet), maxBet: t(g.maxBet), cut: t(g.cutDecksLeft), roundsPerHour: t(g.roundsPerHour), commission: t(g.commissionPer100) };
}

/** Wave W review S2: the `unsure` field each number box of the form edits. */
const TEXT_FIELD: Record<keyof GameText, string | null> = {
  minBet: 'minBet',
  maxBet: 'maxBet',
  cut: 'cutDecksLeft',
  roundsPerHour: null,
  commission: 'commissionPer100',
};

/**
 * Wave W review S2: a game with a change applied, its "?" (not sure) marks
 * kept on every field but the ones the change set to something else --
 * entering a rule is saying what it is. A choice tapped again at the value
 * it has changes nothing, so it clears nothing; "Confirmed" (an explicit
 * `unsure` in the patch) still clears them all.
 */
export function withRuleChange(g: CasinoGame, patch: Partial<CasinoGame>): CasinoGame {
  const next = { ...g, ...patch };
  if ('unsure' in patch || !g.unsure) return next;
  const changed = new Set(Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== (g as unknown as Record<string, unknown>)[k]));
  return withUnsure(next, g.unsure.filter((f) => !changed.has(f)));
}

/** The same for a number box typed in: its field's "?" goes when its text changes. */
export function withTextChange(g: CasinoGame, before: GameText, patch: Partial<GameText>): CasinoGame {
  if (!g.unsure) return g;
  const changed = new Set(
    (Object.keys(patch) as (keyof GameText)[]).filter((k) => patch[k] !== before[k]).map((k) => TEXT_FIELD[k]),
  );
  return withUnsure(g, g.unsure.filter((f) => !changed.has(f)));
}

function withUnsure(g: CasinoGame, list: string[]): CasinoGame {
  if (list.length === (g.unsure?.length ?? 0)) return g;
  const { unsure: _drop, ...rest } = g;
  return list.length > 0 ? { ...rest, unsure: list } : rest;
}
