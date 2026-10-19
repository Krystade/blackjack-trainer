import { useCallback, useEffect, useState } from 'react';
import { loadCasinoLog, saveCasinoLog, subscribeCasinoLog, type CasinoLog } from '../../../store/casinoLog';

/**
 * The Casino tab's copy of the log, and the one way it changes: `commit`
 * saves first, then shows what was saved (or, when the save failed, what was
 * typed, with `saveFailed` set so the screen can say so).
 */
export function useCasinoLog(): { log: CasinoLog; commit: (next: CasinoLog) => boolean; saveFailed: boolean } {
  const [log, setLog] = useState<CasinoLog>(() => loadCasinoLog());
  const [saveFailed, setSaveFailed] = useState(false);
  // Another tab's write (or this tab's, via the store) re-reads the blob, so a
  // stale copy here can never be saved back over a newer one.
  useEffect(() => subscribeCasinoLog(() => setLog(loadCasinoLog())), []);
  const commit = useCallback((next: CasinoLog) => {
    const ok = saveCasinoLog(next);
    setSaveFailed(!ok);
    // Shown even when the save failed, with the warning, so what was typed is
    // still on screen to retry or export.
    setLog(next);
    return ok;
  }, []);
  return { log, commit, saveFailed };
}
