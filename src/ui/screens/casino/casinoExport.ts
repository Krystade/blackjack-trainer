import {
  exportFileName,
  keepUnreadable,
  loadCasinoLog,
  markExported,
  mergeImport,
  serializeExport,
  type CasinoLog,
  type ImportRuleChoice,
  type NameChoice,
} from '../../../store/casinoLog';
import { diag } from '../../../diag/diagnosticLog';
import { saveTextFile } from '../../saveFile';

/**
 * The casino log's file round trip, shared by the backup nudge and the
 * directory's Import / Paste / Copy / Export (Wave W moved it here from
 * CasinoHome so the two places run one code path).
 */

export type ExportResult = 'shared' | 'downloaded' | 'cancelled';

/**
 * Hand the export file over, and remember when -- but only once it really
 * was handed over (review S3).
 *
 * The hand-over itself is `ui/saveFile.ts`, shared with the training backup.
 * Where the browser can share a file (iOS: the share sheet, with Save to
 * Files) that is the path, and the log counts as exported only when the share
 * completes: a dismissed sheet saved nothing, and marking it would hide the
 * backup nudge for 30 days with no backup. Elsewhere it is a download, which
 * a desktop browser completes without asking.
 */
export async function exportLog(log: CasinoLog, commit: (next: CasinoLog) => boolean): Promise<ExportResult> {
  const now = Date.now();
  const r = await saveTextFile(serializeExport(log, now), exportFileName(now));
  if (r === 'shared') {
    // Re-read: the sheet was up for a while, and this must not save a stale copy.
    commit(markExported(loadCasinoLog(), now));
    return 'shared';
  }
  if (r === 'downloaded') {
    commit(markExported(log, now));
    return 'downloaded';
  }
  // A dismissed sheet or a failed hand-over saved nothing: not marked.
  return 'cancelled';
}

/** Wave W (review S3): what an import would do, worked out without saving anything: the screen shows it, then commits it. */
export type ImportPlan = Extract<ReturnType<typeof mergeImport>, { ok: true }>;

/**
 * Read an export's text and work out the merge, saving nothing. The file
 * picker and the paste box both come here: one validator, one merge
 * (store/casinoLog.ts `mergeImport`). `names` answers each casino named as
 * one here under another id (merged by default).
 */
export function planImport(
  log: CasinoLog,
  text: string,
  names: Readonly<Record<string, NameChoice>> = {},
  rules: Readonly<Record<string, ImportRuleChoice>> = {},
  restore: Readonly<Record<string, boolean>> = {},
): { ok: true; plan: ImportPlan } | { ok: false; message: string } {
  const r = mergeImport(log, text, names, rules, restore);
  if (!r.ok) return { ok: false, message: `Import failed: ${r.error}` };
  return { ok: true, plan: r };
}

/**
 * Wave X (item 5): every import leaves a `casino import` line in the
 * diagnostic log -- the counts when it saved, the reason when it did not -- so
 * a failed import shows in an exported log. Never a casino's name or rules:
 * the counts are numbers and the reasons are this file's own fixed messages.
 */
export function logCasinoImport(
  from: 'file' | 'paste',
  outcome: { ok: true; report: ImportPlan['report'] } | { ok: false; stage: 'read' | 'check' | 'save'; reason: string },
): void {
  if (outcome.ok) {
    const p = outcome.report;
    diag('set', 'casino import', {
      ok: true,
      from,
      casinosAdded: p.casinosAdded,
      casinosUpdated: p.casinosUpdated,
      sessionsAdded: p.sessionsAdded,
      sessionsUpdated: p.sessionsUpdated,
      kept: p.kept,
      skipped: p.skipped,
      extraRunning: p.extraRunning,
    });
    return;
  }
  diag('set', 'casino import', { ok: false, from, stage: outcome.stage, reason: outcome.reason });
}

/** Save a planned import, once confirmed, and say what happened, in one line. */
export function applyImport(plan: ImportPlan, commit: (next: CasinoLog) => boolean): { ok: boolean; message: string } {
  // The red save-failed banner says why; claiming "Imported" beside it would contradict it.
  if (!commit(plan.log)) return { ok: false, message: 'Import not saved: storage is full or unavailable.' };
  // Bytes the file carried from a corrupt blob: kept aside here too, not dropped.
  if (plan.unreadable !== null) keepUnreadable(plan.unreadable);
  const p = plan.report;
  const parts = [
    `${p.casinosAdded} casino${p.casinosAdded === 1 ? '' : 's'} added`,
    `${p.casinosUpdated} updated`,
    `${p.sessionsAdded} session${p.sessionsAdded === 1 ? '' : 's'} added`,
    `${p.sessionsUpdated} updated`,
  ];
  if (p.kept > 0) parts.push(`${p.kept} already up to date`);
  if (p.skipped > 0) parts.push(`${p.skipped} unreadable skipped`);
  const extra =
    p.extraRunning > 0
      ? ` ${p.extraRunning} running session${p.extraRunning === 1 ? '' : 's'} from the file left open: end ${p.extraRunning === 1 ? 'it' : 'them'} from history.`
      : '';
  return { ok: true, message: `Imported: ${parts.join(', ')}.${extra}` };
}
