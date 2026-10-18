/**
 * The "drive-checks" block of the exported diagnostic log.
 *
 * Every drive check writes one `test drive-check` line when it settles (see
 * driveChecks.ts). Those lines are already in the body of the export, in time
 * order among a few hundred others; this block pulls the latest run's results
 * together at the top, one row per check, so the drive can be read in ten
 * lines before the body is read at all.
 *
 * Its own module with TYPE-ONLY imports, because diagnosticLog.ts calls it
 * and driveChecks.ts imports `diag` from there: a value import either way
 * would be a cycle.
 */

import type { DiagEntry } from './diagnosticLog';

export const DRIVE_CHECK_EVENT = 'drive-check';

/** Keys that are the row's identity, not its evidence. */
const FRAME_KEYS = new Set(['run', 'check', 'n', 'status', 'title']);

function renderValue(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return /[\s"=]/.test(v) ? JSON.stringify(v) : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/**
 * The block, or nothing when no drive check has ever settled.
 *
 * THE LATEST RUN ONLY: an export can hold several runs, and a block mixing
 * Tuesday's pass with Thursday's fail under one heading would say neither.
 * Within the run, the LAST result per check wins -- a check re-run after a
 * skip replaces the skip.
 */
export function driveChecksBlock(entries: readonly DiagEntry[]): string[] {
  const rows = entries.filter((e) => e.category === 'test' && e.event === DRIVE_CHECK_EVENT && e.detail);
  if (rows.length === 0) return [];
  const lastRun = rows[rows.length - 1]!.detail!.run;
  const byCheck = new Map<string, DiagEntry>();
  for (const e of rows) {
    if (e.detail!.run !== lastRun) continue;
    byCheck.set(String(e.detail!.check), e);
  }
  const ordered = [...byCheck.values()].sort(
    (a, b) => Number(a.detail!.n ?? 0) - Number(b.detail!.n ?? 0),
  );
  const tally = { pass: 0, fail: 0, skipped: 0 };
  for (const e of ordered) {
    const s = e.detail!.status as keyof typeof tally;
    if (s in tally) tally[s] += 1;
  }
  return [
    `# --- drive-checks run=${renderValue(lastRun)} pass=${tally.pass} fail=${tally.fail} skipped=${tally.skipped} ---`,
    ...ordered.map((e) => {
      const d = e.detail!;
      const evidence = Object.entries(d)
        .filter(([k, v]) => !FRAME_KEYS.has(k) && v !== undefined && k !== 'context' && k !== 'step')
        .map(([k, v]) => `${k}=${renderValue(v)}`)
        .join(' ');
      return `# ${String(d.n ?? '?').padStart(2)} ${String(d.check).padEnd(13)} ${String(d.status).padEnd(7)}${evidence ? ' ' + evidence : ''}`;
    }),
    `# --- end drive-checks ---`,
  ];
}
