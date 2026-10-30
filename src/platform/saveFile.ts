/**
 * Hand one or more files to the person: the share sheet where the browser can
 * share files, a download anywhere else. Every export in the app goes through
 * here (training backup, crash-screen backup, casino log, Test Kit
 * recordings) so the iOS lessons below are learned once.
 *
 * - THE SHARE SHEET FIRST. In the installed iPhone app an `<a download>`
 *   opens a preview rather than saving (WebKit 275288); the share sheet's
 *   "Save to Files" is the route that actually lands a file. A dismissed
 *   sheet (AbortError) saved nothing and is reported as 'cancelled', so the
 *   caller can say so instead of "Backup exported.". Any other share error
 *   (no user activation left, a file type the target refuses) falls through
 *   to the download rather than giving up.
 * - THE BLOB URL OUTLIVES THE CLICK. Safari can still be reading the URL
 *   when a synchronous revoke runs, and saves an empty file. The revoke
 *   waits REVOKE_AFTER_MS (FileSaver.js uses 40 s; the cost of waiting is a
 *   few kilobytes of memory).
 * - THE ANCHOR IS ATTACHED before it is clicked: a detached anchor's click
 *   is ignored by some browsers.
 */

export type SaveResult = 'shared' | 'downloaded' | 'cancelled' | 'failed';

export interface SaveFile {
  name: string;
  /** Text (JSON, a log) or a Blob (a recording). */
  data: string | Blob;
  /** Defaults to application/json for text. */
  type?: string;
}

export const REVOKE_AFTER_MS = 40_000;

type ShareNav = Navigator & { canShare?: (data: ShareData) => boolean };

function toFile(f: SaveFile): File | null {
  const type = f.type ?? (typeof f.data === 'string' ? 'application/json' : f.data.type);
  try {
    return new File([f.data], f.name, { type });
  } catch {
    return null;
  }
}

export async function saveFiles(items: readonly SaveFile[], title?: string): Promise<SaveResult> {
  if (items.length === 0) return 'failed';
  const nav = (typeof navigator === 'undefined' ? undefined : navigator) as ShareNav | undefined;
  const files = items.map(toFile);
  if (
    nav &&
    files.every((f): f is File => f !== null) &&
    typeof nav.canShare === 'function' &&
    typeof nav.share === 'function'
  ) {
    let canShare = false;
    try {
      canShare = nav.canShare({ files });
    } catch {
      canShare = false;
    }
    if (canShare) {
      try {
        await nav.share(title ? { files, title } : { files });
        return 'shared';
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return 'cancelled';
        // Anything else: the download below still has a chance.
      }
    }
  }
  try {
    for (const item of items) {
      const type = item.type ?? (typeof item.data === 'string' ? 'application/json' : item.data.type);
      const blob = typeof item.data === 'string' ? new Blob([item.data], { type }) : item.data;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
    }
    return 'downloaded';
  } catch {
    return 'failed';
  }
}

/** One text file: the common case. */
export function saveTextFile(text: string, name: string, type = 'application/json'): Promise<SaveResult> {
  return saveFiles([{ name, data: text, type }]);
}

/** YYYY-MM-DD from LOCAL fields, plus -HHMM when `withTime`: what a person would call the date. */
export function localFileStamp(d: Date, withTime = false): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${day}-${p(d.getHours())}${p(d.getMinutes())}` : day;
}

/** B35: `2026-10-28T18-30-05`, local and file-safe, for a Test Kit recording's name. */
export function localRecordingStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${localFileStamp(d)}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** The training backup's file name: dated, local, to the minute, so several backups in Files can be told apart. */
export function backupFileName(d: Date): string {
  return `bjtrainer-backup-${localFileStamp(d, true)}.json`;
}
