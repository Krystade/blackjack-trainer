import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App.tsx';
import { startUpdateWatch } from './updateCheck.ts';
import { fieldTestRunIsLive } from './diag/fieldTestRun.ts';
import { primeVoices } from './audio/speech.ts';
import { dropRetiredKeys } from './store/persist.ts';
import { registerOfflineWorker } from './offline/registerOffline.ts';

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Keep an installed home-screen app on the current build (see updateCheck.ts).
// Skipped under ?e2e=1: the e2e harness drives a dev server whose version.json
// does not exist, and a navigation mid-spec would be indistinguishable from a
// bug in whatever that spec was testing.
if (!new URLSearchParams(window.location.search).has('e2e')) {
  startUpdateWatch({
    // NOT WHILE SOMEBODY IS IN THE MIDDLE OF A RUN. The reload fires from a
    // visibility change, so answering a phone call mid-protocol was enough to
    // restart the app and drop the operator on Home. The update is not lost:
    // the next foreground event after the run goes quiet picks it up.
    deferWhile: fieldTestRunIsLive,
  });
}
