import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App.tsx';
import { startUpdateWatch } from './updateCheck.ts';
import { updateMustWait } from './ui/activityLive.ts';
import { primeVoices } from './audio/speech.ts';
import { dropRetiredKeys, loadSettings } from './store/persist.ts';
import { applyTheme, normalizeTheme } from './ui/theme.ts';
import { registerOfflineWorker } from './offline/registerOffline.ts';
import { requestPersistentStorage } from './store/storageHealth.ts';
import { watchViewportGap } from './ui/viewportGap.ts';

// OPEN THE VOICE LIST BEFORE ANYTHING WANTS TO SPEAK.
//
// WebKit populates `getVoices()` asynchronously on first access, so whichever
// utterance asks first is spoken against an empty list and dies silently --
// which in the car was always the first live line of the session (see
// `primeVoices` in audio/speech.ts for the run that proved it). Priming here
// costs nothing and takes the drill out of that position; speech.ts primes
// again on the first clip, because iOS may withhold the list until a gesture.
primeVoices();

// Storage nothing reads any more (see store/persist.ts).
dropRetiredKeys();

// Serve the app from a cache when there is no network -- a plane, a tunnel, a
// car park. Production only; see offline/registerOffline.ts.
registerOfflineWorker();

// Ask the browser to exempt this origin's storage from eviction (F24). Every
// answer the operator has given lives in localStorage; refusal is normal.
void requestPersistentStorage();

// The stored theme before React's first render (index.html does it even
// earlier, before the bundle loads; this covers a document served without it).
applyTheme(normalizeTheme(loadSettings().theme));

// Where a fixed bottom:0 bar really lands in the installed app (Wave I; see
// ui/viewportGap.ts). A no-op in a browser tab.
watchViewportGap();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Keep an installed home-screen app on the current build (see updateCheck.ts).
// Skipped under ?e2e=1: a navigation mid-spec would be indistinguishable from
// a bug in whatever that spec was testing. e2e/update-deferral.spec.ts loads
// plain `/` to test this call, deferWhile included, with version.json stubbed.
if (!new URLSearchParams(window.location.search).has('e2e')) {
  startUpdateWatch({
    // NOT WHILE SOMEBODY IS IN THE MIDDLE OF A RUN. The reload fires from a
    // visibility change, so answering a phone call mid-protocol was enough to
    // restart the app and drop the operator on Home. The update is not lost:
    // the next foreground event after the run goes quiet picks it up.
    // One shared flag covers the field test, the table and every drill
    // (ui/activityLive.ts); it used to cover only the field test (F2).
    deferWhile: () => updateMustWait(),
  });
}
