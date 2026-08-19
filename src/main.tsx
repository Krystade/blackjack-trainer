import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App.tsx';
import { startUpdateWatch } from './updateCheck.ts';

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
  startUpdateWatch();
}
