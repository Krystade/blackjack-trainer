import { useRef, useState, type ChangeEvent } from 'react';
import { serializeExport, type CasinoLog, type ImportRuleChoice, type NameChoice } from '../../../store/casinoLog';
import { agoText, daysBetween, localDateKey } from '../../casinoFigures';
import { applyImport, exportLog, planImport, type ImportPlan } from './casinoExport';
import { ImportPreview } from './ImportPreview';

/**
 * Wave W: the casino log as a file, four ways. Export JSON (a file, or the
 * share sheet) and Import JSON (a file) as before, and beside them Copy JSON
 * (the same text onto the clipboard) and Paste JSON (a box to paste a file's
 * text into: Jack keeps his casinos in a JSON file and wanted to paste it).
 * Paste runs the file import's own validator and merge.
 *
 * Review S3: neither saves at once. Each shows what it would do first (the
 * casinos added, updated and already here, the sessions, and any casino
 * named as one here under another record, to merge or add), and saves on
 * Import.
 */
export function DirectoryFile({ log, commit }: { log: CasinoLog; commit: (next: CasinoLog) => boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [copyText, setCopyText] = useState<string | null>(null);
  // Review S3: the import worked out and shown, waiting for Import; `from` is where its text came from.
  const [pending, setPending] = useState<{
    text: string;
    names: Record<string, NameChoice>;
    rules: Record<string, ImportRuleChoice>;
    from: 'file' | 'paste';
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Worked out against the log as it is now, so a change made meanwhile (another tab) is in what Import saves.
  const planned = pending ? planImport(log, pending.text, pending.names, pending.rules) : null;
  const plan: ImportPlan | null = planned?.ok ? planned.plan : null;

  const preview = (text: string, from: 'file' | 'paste') => {
    const r = planImport(log, text);
    if (!r.ok) {
      setPending(null);
      setMessage(r.message);
      return;
    }
    setMessage(null);
    setPending({ text, names: {}, rules: {}, from });
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => preview(String(reader.result ?? ''), 'file');
    reader.onerror = () => setMessage('Import failed: the file could not be read.');
    reader.readAsText(file);
  };

  const importPasted = () => {
    if (pasted.trim() === '') {
      setMessage('Paste the text of a casino log file first.');
      return;
    }
    preview(pasted, 'paste');
  };

  const confirm = () => {
    if (!pending) return;
    if (!plan) {
      setMessage(planned && !planned.ok ? planned.message : 'Import failed.');
      setPending(null);
      return;
    }
    const r = applyImport(plan, commit);
    setMessage(r.message);
    if (r.ok) {
      if (pending.from === 'paste') {
        setPasted('');
        setPasting(false);
      }
      setPending(null);
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
          <button
            type="button"
            className="u-btn"
            onClick={() => {
              setPending(null);
              fileRef.current?.click();
            }}
          >
            Import JSON
          </button>
          <button
            type="button"
            className="u-btn"
            aria-expanded={pasting}
            onClick={() => {
              setCopyText(null);
              setPending(null);
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
        {pasting && !pending && (
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
                Preview import
              </button>
            </div>
          </div>
        )}
        {plan && pending && (
          <ImportPreview
            plan={plan}
            onName={(id, choice) => setPending((p) => (p ? { ...p, names: { ...p.names, [id]: choice } } : p))}
            onRule={(key, choice) => setPending((p) => (p ? { ...p, rules: { ...p.rules, [key]: choice } } : p))}
            onCancel={() => setPending(null)}
            onImport={confirm}
          />
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
          show what they would change and save only on Import. They merge into what is here: the newer copy of a casino or
          session wins its own details, and every game, version and note on either copy is kept.
        </p>
      </div>
    </section>
  );
}
