import { useCallback, useEffect, useState } from 'react';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { OFFLINE_CACHE, warmForFlight } from '../../offline/warmForFlight';
import { clipsBaseUrl, loadClipIndex, loadVoiceManifest } from '../../audio/clips';
import { diag } from '../../diag/diagnosticLog';
import { onStoragePersistence, storagePersistence } from '../../store/backupStatus';

/**
 * SAVE THE FLIGHT BEFORE THE DOOR CLOSES.
 *
 * The service worker answers out of a cache, but it only holds what the app
 * has already asked for -- so without pressing this, a drill at 35,000 feet
 * plays the handful of clips that happened to come up on the ground. One voice
 * is around 9.5MB, which is nothing to store and far too much to download
 * where there is no signal.
 *
 * The count is the point of the display: "617 of 617" is what says it is safe
 * to board, and a number that stopped at 600 says the opposite out loud rather
 * than being discovered mid-hand.
 */
type Phase = 'unsupported' | 'idle' | 'saving' | 'done';

function megabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** B25: what navigator.storage.persist() answered, in words. */
export function persistenceText(p: boolean | null | undefined): string {
  if (p === true) return 'Protected from clearing';
  if (p === false) return 'The phone may clear it: keep a backup';
  if (p === null) return 'The browser cannot say: keep a backup';
  return 'Checking…';
}

export function OfflineSection({ clipVoice }: { clipVoice: string }) {
  const [phase, setPhase] = useState<Phase>(() =>
    typeof caches === 'undefined' ? 'unsupported' : 'idle',
  );
  const [held, setHeld] = useState<number | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ cached: number; failed: number; bytes: number } | null>(
    null,
  );

  // What is already saved, so the button is not the only way to find out.
  const refreshHeld = useCallback(() => {
    if (typeof caches === 'undefined') return;
    void caches
      .open(OFFLINE_CACHE)
      .then((c) => c.keys())
      .then((keys) => setHeld(keys.length))
      .catch(() => setHeld(null));
  }, []);

  useEffect(refreshHeld, [refreshHeld]);

  // B25: whether the phone promised to keep this app's data.
  const [persisted, setPersisted] = useState(() => storagePersistence());
  useEffect(() => onStoragePersistence(() => setPersisted(storagePersistence())), []);

  const save = async (): Promise<void> => {
    if (typeof caches === 'undefined') return;
    setPhase('saving');
    setProgress({ done: 0, total: 0 });
    setResult(null);
    try {
      const cache = await caches.open(OFFLINE_CACHE);
      // The running page already fetched exactly the files this build needs,
      // hashed names and all, so it is asked rather than guessed at.
      const resources = [
        ...(typeof performance === 'undefined' ? [] : performance.getEntriesByType('resource').map((e) => e.name)),
        // F11: and every chunk of this build, including the lazy screens'
        // ones this page has not opened yet -- the build names them all in
        // the document as <link rel="precache"> (vite.config.ts).
        ...[...document.querySelectorAll<HTMLLinkElement>('link[rel="precache"]')].map((l) => l.href),
      ];
      const voiceId = clipVoice || (await loadClipIndex())?.default || null;

      const warmed = await warmForFlight({
        documentUrl: window.location.href,
        origin: window.location.origin,
        resources,
        clipsBase: clipsBaseUrl(),
        voiceId,
        loadManifest: (id) => loadVoiceManifest(id),
        cache,
        fetchFn: (url) => fetch(url),
        onProgress: (p) => setProgress({ done: p.done, total: p.total }),
      });

      setResult({ cached: warmed.cached, failed: warmed.failed.length, bytes: warmed.bytes });
      diag('offline', 'saved', {
        voice: voiceId ?? 'none',
        cached: warmed.cached,
        failed: warmed.failed.length,
        bytes: warmed.bytes,
      });
    } catch (e) {
      diag('offline', 'save-failed', { error: String(e) });
      setResult(null);
    } finally {
      setPhase('done');
      refreshHeld();
    }
  };

  return (
    <CollapsibleSection title={<>Offline &mdash; planes and tunnels</>} defaultOpen={false}>
      <div className="settings-note-row u-note">
        Saves the app and every recording of the current clip voice onto this phone, so a
        drill runs with no signal at all. About 10 MB. Do it <strong>before</strong> you
        board.
        <br />
        The drill, the charts and the recorded voice work offline. Anything that asks a
        server does not &mdash; the log records what the microphone said when it was tried.
      </div>

      <div className="settings-row">
        <span className="settings-label">Saved on this phone</span>
        <span className="settings-value" data-testid="offline-held">
          {phase === 'unsupported'
            ? 'not available here'
            : held === null
              ? '—'
              : held === 0
                ? 'nothing yet'
                : `${held} files`}
        </span>
      </div>

      {phase === 'saving' && (
        <div className="settings-row">
          <span className="settings-label">Saving</span>
          <span className="settings-value" data-testid="offline-progress">
            {progress.total === 0 ? 'working out the list…' : `${progress.done} / ${progress.total}`}
          </span>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="settings-row">
          <span className="settings-label">Last save</span>
          <span className="settings-value" data-testid="offline-result">
            {result.failed === 0
              ? `${result.cached} files, ${megabytes(result.bytes)} downloaded`
              : `${result.cached} saved, ${result.failed} failed — try again on better signal`}
          </span>
        </div>
      )}

      <div className="settings-row">
        <span className="settings-label">Your progress</span>
        <span className="settings-value" data-testid="storage-persisted">
          {persistenceText(persisted)}
        </span>
      </div>

      <div className="settings-row">
        <button
          type="button"
          className="settings-mini-btn"
          data-testid="offline-save"
          disabled={phase === 'saving' || phase === 'unsupported'}
          onClick={() => void save()}
        >
          {phase === 'saving' ? 'Saving…' : 'Save for offline'}
        </button>
        <button
          type="button"
          className="settings-mini-btn"
          data-testid="offline-clear"
          disabled={phase === 'saving' || phase === 'unsupported' || !held}
          onClick={() => {
            void caches.delete(OFFLINE_CACHE).then(() => {
              diag('offline', 'cleared');
              setResult(null);
              setPhase('idle');
              refreshHeld();
            });
          }}
        >
          Clear
        </button>
      </div>
    </CollapsibleSection>
  );
}
