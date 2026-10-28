import { useRef, useState, type ChangeEvent } from 'react';
import { serializeExport, type CasinoLog } from '../../../store/casinoLog';
import { agoText, daysBetween, localDateKey } from '../../casinoFigures';
import { exportLog, importText } from './casinoExport';

/**
 * Wave W: the casino log as a file, four ways. Export JSON (a file, or the
 * share sheet) and Import JSON (a file) as before, and beside them Copy JSON
 * (the same text onto the clipboard) and Paste JSON (a box to paste a file's
 * text into: Jack keeps his casinos in a JSON file and wanted to paste it).
 * Paste runs the file import's own validator and merge.
 */
export function DirectoryFile({ log, commit }: { log: CasinoLog; commit: (next: CasinoLog) => boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [copyText, setCopyText] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setMessage(importText(log, String(reader.result ?? ''), commit).message);
    reader.onerror = () => setMessage('Import failed: the file could not be read.');
    reader.readAsText(file);
  };

  const importPasted = () => {
    if (pasted.trim() === '') {
      setMessage('Paste the text of a casino log file first.');
      return;
    }
    const r = importText(log, pasted, commit);
    setMessage(r.message);
    if (r.ok) {
      setPasted('');
      setPasting(false);
    }
  };

  const copy = () => {
    const text = serializeExport(log, Date.now());
    setPasting(false);
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard?.writeText) {
      // No clipboard here: show the text to select by hand rather than claim a copy.
      setCopyText(text);
      setMessage('Copy failed here: select the text below and copy it.');
      return;
    }
    clipboard.writeText(text).then(
      () => {
        setCopyText(null);
        setMessage(`Copied: ${log.casinos.length} casino${log.casinos.length === 1 ? '' : 's'} and ${log.sessions.length} session${log.sessions.length === 1 ? '' : 's'}, as JSON.`);
      },
      () => {
        setCopyText(text);
        setMessage('Copy failed here: select the text below and copy it.');
      },
    );
  };

  return (
    <section className="cas-section cas-backup" aria-labelledby="cas-file-title" data-testid="casino-file">
      <div className="cas-section-head">
        <h2 className="u-section-title" id="cas-file-title">
          Import and export
        </h2>
      </div>
      <div className="cas-pad-x cas-stack">
        <div className="cas-btn-row">
          <button
            type="button"
            className="u-btn"
            onClick={() =>
              void exportLog(log, commit).then((r) => {
                if (r === 'cancelled') setMessage('Export cancelled: nothing was saved.');
              })
            }
          >
            Export JSON
          </button>
          <button type="button" className="u-btn" onClick={copy}>
            Copy JSON
          </button>
        </div>
        <div className="cas-btn-row">
          <button type="button" className="u-btn" onClick={() => fileRef.current?.click()}>
            Import JSON
          </button>
          <button
            type="button"
            className="u-btn"
            aria-expanded={pasting}
            onClick={() => {
              setCopyText(null);
              setPasting((p) => !p);
            }}
          >
            Paste JSON
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="cas-file"
          data-testid="casino-import-file"
          onChange={onFile}
        />
        {pasting && (
          <div className="cas-stack cas-paste" data-testid="casino-paste">
            <label className="cas-field">
              <span className="cas-field-label">Paste a casino log file&rsquo;s text</span>
              <textarea
                className="cas-input cas-textarea cas-paste-text"
                name="pasteJson"
                data-testid="casino-paste-text"
                rows={6}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                placeholder='{"app": "bjtrainer-casino-log", "casinos": [ ... ] }'
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
            </label>
            <div className="cas-btn-row">
              <button type="button" className="u-btn" onClick={() => setPasting(false)}>
                Cancel
              </button>
              <button type="button" className="u-btn u-btn-primary" onClick={importPasted} data-testid="casino-paste-import">
                Import pasted
              </button>
            </div>
          </div>
        )}
        {message && (
          <p className="cas-message" role="status">
            {message}
          </p>
        )}
        {copyText !== null && (
          <textarea
            className="cas-input cas-textarea cas-paste-text"
            readOnly
            rows={6}
            aria-label="Casino log as JSON"
            data-testid="casino-copy-text"
            value={copyText}
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
        <p className="cas-note">
          {log.lastExportAt
            ? `Last exported ${agoText(daysBetween(localDateKey(Date.parse(log.lastExportAt)), localDateKey(Date.now())))}. `
            : ''}
          The casino log stays on this phone. It is not in the Stats backup and is never sent anywhere. Import and Paste
          merge into what is here: the newer copy of each casino or session wins, and nothing is deleted.
        </p>
      </div>
    </section>
  );
}
