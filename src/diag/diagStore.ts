/**
 * WHERE THE DIAGNOSTIC LOG LIVES IN localStorage (Wave G, G5).
 *
 * It used to be one key holding one JSON array, and every flush -- once a
 * second while anything was happening -- read that array back, parsed it,
 * appended the new lines, stringified the lot and wrote it again. At the cap
 * that is about 1.2MB parsed, 1.2MB stringified and 1.2MB handed to a
 * synchronous `setItem`, every second, on the main thread of the session
 * being diagnosed: the logger costing what it measures, which is the third of
 * its design constraints.
 *
 * Now the log is a run of SEGMENTS, each its own key holding a JSON array:
 *
 *   bjtrainer.diagnostics.v1        the legacy single key. Read first (it is
 *                                   the oldest), never written by this
 *                                   version, and folded into numbered
 *                                   segments on the first flush that sees it.
 *   bjtrainer.diagnostics.v1.<n>    one segment per flush, n an integer,
 *                                   read in numeric order.
 *
 * A flush writes only its own new entries, as a new segment. Small segments
 * are merged now and then (compaction) so the key count stays bounded, and
 * the caps trim the oldest segments, so a trim rewrites at most one segment
 * rather than the log.
 *
 * Shared by the log itself and by the storage-full guard (F24), which has to
 * find the log to make room by shrinking it.
 *
 * NOT A NEW STORAGE KEY for the backup and cross-tab inventories
 * (storageKeyScan.ts): the segment names are the base key plus a suffix, and
 * they are covered by the base key's classification there -- not backed up
 * (cabin speech, device names), not synced (append-only, per page load).
 */
export const DIAG_BASE_KEY = 'bjtrainer.diagnostics.v1';

/** Every numbered segment's key starts with this. */
export const DIAG_SEGMENT_PREFIX = `${DIAG_BASE_KEY}.`;

/** The key of segment `seq`. */
export function segmentKey(seq: number): string {
  return `${DIAG_SEGMENT_PREFIX}${seq}`;
}

/** The sequence number of a segment key, or null for anything else. */
export function segmentSeq(key: string): number | null {
  if (!key.startsWith(DIAG_SEGMENT_PREFIX)) return null;
  const tail = key.slice(DIAG_SEGMENT_PREFIX.length);
  if (!/^-?\d{1,15}$/.test(tail)) return null;
  return Number(tail);
}

/** The least a store must offer for the log to find itself in it. */
export type DiagKeyStore = Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'key' | 'length'>>;

/**
 * Every key holding part of the log, OLDEST FIRST: the legacy key, then the
 * numbered segments in numeric order.
 *
 * A store that cannot be enumerated (some test doubles) can only be asked
 * about the legacy key by name, so that is all it reports.
 */
export function listDiagKeys(s: DiagKeyStore): string[] {
  if (typeof s.key !== 'function' || typeof s.length !== 'number') {
    return s.getItem(DIAG_BASE_KEY) !== null ? [DIAG_BASE_KEY] : [];
  }
  let base = false;
  const segs: { key: string; seq: number }[] = [];
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const k = s.key(i);
    if (k === null) continue;
    if (k === DIAG_BASE_KEY) {
      base = true;
      continue;
    }
    const seq = segmentSeq(k);
    if (seq !== null) segs.push({ key: k, seq });
  }
  segs.sort((a, b) => a.seq - b.seq);
  const out = segs.map((x) => x.key);
  return base ? [DIAG_BASE_KEY, ...out] : out;
}
