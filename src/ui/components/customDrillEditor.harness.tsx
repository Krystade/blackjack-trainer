import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../app.css';
import { CustomDrillEditor } from './CustomDrillEditor';
import { loadSettings, saveSettings } from '../../store/persist';
import { applyTheme, normalizeTheme } from '../theme';
import type { Settings } from '../../store/types';

/**
 * e2e harness for the Custom drill editor (e2e/custom-drill-editor.spec.ts),
 * loaded only by e2e/harness/custom-drill-editor.html on the dev server.
 * Nothing in the app imports it, so it is never in the build; it lives under
 * src so `tsc -b` checks it with the app's own settings.
 * Settings round-trip through the real store, exactly as a host screen's
 * would; Start and Back are recorded on `window` for the spec to read.
 */
declare global {
  interface Window {
    __customStarts?: string[];
    __customBacks?: number;
  }
}

const theme = new URLSearchParams(window.location.search).get('theme');
applyTheme(normalizeTheme(theme ?? loadSettings().theme));

export function Harness() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  return (
    <CustomDrillEditor
      settings={settings}
      onSettingsChange={(next) => {
        saveSettings(next);
        setSettings(next);
      }}
      onStart={(mode) => {
        window.__customStarts = [...(window.__customStarts ?? []), mode];
      }}
      onBack={() => {
        window.__customBacks = (window.__customBacks ?? 0) + 1;
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
