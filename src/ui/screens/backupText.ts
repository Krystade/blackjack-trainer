import { getStorage, type BackupSnapshot, type BackupSummary } from '../../store/persist';
import { agoText, daysBetween, localDateKey } from '../casinoFigures';

/**
 * B4/B22: the words around a training-backup import. Pure, so the sentence
 * Jack reads before his history is replaced is tested, not eyeballed.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "28 Oct 2026, 19:30" in local time. */
export function backupDateText(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

export function summaryText(s: BackupSummary): string {
  const parts = [
    plural(s.answers, 'answer'),
    plural(s.sessions, 'table session'),
    plural(s.profiles, 'profile'),
    plural(s.reviewCards, 'review card'),
  ];
  if (s.newest) parts.push(`newest practice ${backupDateText(s.newest)}`);
  return parts.join(', ');
}

/** "a, b and c". */
function listText(xs: readonly string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

export function importConfirmText(
  file: { exportedAt: string | null; summary: BackupSummary; replaces: readonly string[]; deviceNote?: string },
  phone: BackupSummary,
  undoKept: boolean,
): string {
  const made = file.exportedAt ? `made ${backupDateText(file.exportedAt)}` : 'no date (an older version made it)';
  const lines = [
    'Import this backup?',
    '',
    `The file: ${made}. ${summaryText(file.summary)}.`,
    `This phone: ${summaryText(phone)}.`,
  ];
  const older =
    file.summary.answers < phone.answers ||
    (file.summary.newest !== null && phone.newest !== null && file.summary.newest < phone.newest);
  if (older) {
    lines.push('', 'The file is older than this phone: what you practised since it was made will be replaced.');
  }
  lines.push('', `It replaces your ${listText(file.replaces)}.`);
  if (file.deviceNote) lines.push(file.deviceNote);
  lines.push(
    undoKept
      ? 'You can undo this until you practise or for 24 hours.'
      : 'There is no undo: export this phone first if you might want it back.',
  );
  return lines.join('\n');
}

/** The undo kept across screens (not reloads of the tab): sessionStorage has its own quota. */
export const IMPORT_UNDO_KEY = 'bjtrainer.importUndo.v1';

export interface ImportUndo {
  at: string;
  snap: BackupSnapshot;
  /**
   * R1: practiceMark() as the import left the phone. An undo restores every
   * backed-up key, so once an answer has been recorded on top of the import
   * it would throw that practice (and the SR schedule) away with it.
   */
  mark?: string;
}

/** R1: how long an import can be undone, at most. */
export const UNDO_FOR_MS = 24 * 60 * 60 * 1000;

/** The keys every recorded answer writes: stats, and both review schedules. */
const PRACTICE_KEYS = ['bjtrainer.stats.v1', 'bjtrainer.flashsr.v1', 'bjtrainer.quizsr.v1'] as const;

/** R1: a fingerprint of the practice keys' bytes; any recorded answer changes it. */
export function practiceMark(): string {
  const store = getStorage();
  return PRACTICE_KEYS.map((k) => {
    const v = store.getItem(k);
    if (v === null) return '-';
    let h = 0x811c9dc5;
    for (let i = 0; i < v.length; i++) h = Math.imul(h ^ v.charCodeAt(i), 0x01000193);
    return `${v.length}:${(h >>> 0).toString(36)}`;
  }).join('|');
}

/**
 * R1: the undo, while it can still be used: under 24 hours old and nothing
 * practised since the import. A lapsed undo is dropped here, so its button
 * goes and its snapshot with it.
 */
export function liveUndo(now: number = Date.now()): ImportUndo | null {
  const u = readUndo();
  if (!u) return null;
  const age = now - Date.parse(u.at);
  if (!(age >= 0 && age < UNDO_FOR_MS) || u.mark === undefined || u.mark !== practiceMark()) {
    clearUndo();
    return null;
  }
  return u;
}

/** R2: whether an undo could be kept at all (sessionStorage writable), asked BEFORE the import touches anything. */
export function canKeepUndo(): boolean {
  try {
    sessionStorage.setItem(`${IMPORT_UNDO_KEY}.probe`, '1');
    sessionStorage.removeItem(`${IMPORT_UNDO_KEY}.probe`);
    return true;
  } catch {
    return false;
  }
}

export function storeUndo(u: ImportUndo): boolean {
  try {
    sessionStorage.setItem(IMPORT_UNDO_KEY, JSON.stringify(u));
    return true;
  } catch {
    return false;
  }
}

export function readUndo(): ImportUndo | null {
  try {
    const raw = sessionStorage.getItem(IMPORT_UNDO_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as ImportUndo;
    return typeof u?.at === 'string' && typeof u.snap === 'object' && u.snap !== null ? u : null;
  } catch {
    return null;
  }
}

export function clearUndo(): void {
  try {
    sessionStorage.removeItem(IMPORT_UNDO_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** "Last backup 34 days ago" / "Never backed up", from the local calendar. */
export function lastBackupText(last: string | null, now: number): string {
  if (last === null) return 'Never backed up';
  return `Last backup ${agoText(daysBetween(localDateKey(Date.parse(last)), localDateKey(now)))}`;
}

/** B25: what navigator.storage.persist() answered, in words. */
export function persistenceText(p: boolean | null | undefined): string {
  if (p === true) return 'Protected from clearing';
  if (p === false) return 'The phone may clear it: keep a backup';
  if (p === null) return 'The browser cannot say: keep a backup';
  return 'Checking…';
}
