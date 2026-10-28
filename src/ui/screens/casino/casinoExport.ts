import {
  exportFileName,
  keepUnreadable,
  loadCasinoLog,
  markExported,
  mergeImport,
  serializeExport,
  type CasinoLog,
} from '../../../store/casinoLog';

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
 * Where the browser can share a file (iOS: the share sheet, with Save to
 * Files) that is the path, and the log counts as exported only when the share
 * completes: a dismissed sheet saved nothing, and marking it would hide the
 * backup nudge for 30 days with no backup. Elsewhere it is a download, which
 * a desktop browser completes without asking.
 */
export async function exportLog(log: CasinoLog, commit: (next: CasinoLog) => boolean): Promise<ExportResult> {
  const now = Date.now();
  const name = exportFileName(now);
  const text = serializeExport(log, now);
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  let file: File | null = null;
  try {
    file = new File([text], name, { type: 'application/json' });
  } catch {
    file = null;
  }
  if (file && typeof nav.canShare === 'function' && typeof nav.share === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
    } catch {
      return 'cancelled';
    }
    // Re-read: the sheet was up for a while, and this must not save a stale copy.
    commit(markExported(loadCasinoLog(), now));
    return 'shared';
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoked on a later turn: Safari can still be reading the URL when a
  // synchronous revoke runs, and saves an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  commit(markExported(log, now));
  return 'downloaded';
}

/**
 * Merge an export's text into the log and say what happened, in one line.
 * The file picker and the paste box both come here: one validator, one
 * merge (store/casinoLog.ts `mergeImport`), one report.
 */
export function importText(
  log: CasinoLog,
  text: string,
  commit: (next: CasinoLog) => boolean,
): { ok: boolean; message: string; log?: CasinoLog } {
  const r = mergeImport(log, text);
  if (!r.ok) return { ok: false, message: `Import failed: ${r.error}` };
  // The red save-failed banner says why; claiming "Imported" beside it would contradict it.
  if (!commit(r.log)) return { ok: false, message: 'Import not saved: storage is full or unavailable.' };
  // Bytes the file carried from a corrupt blob: kept aside here too, not dropped.
  if (r.unreadable !== null) keepUnreadable(r.unreadable);
  const p = r.report;
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
  return { ok: true, message: `Imported: ${parts.join(', ')}.${extra}`, log: r.log };
}
