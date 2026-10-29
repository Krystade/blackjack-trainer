import { Fragment, useState } from 'react';
import type { CustomSelection, Settings } from '../../store/types';
import { saveSettings } from '../../store/persist';
import { ALL_PAINT_CELL_IDS, tierOf } from '../../drills/cellSelection';
import {
  MAX_NAME,
  deleteList,
  listById,
  matchingList,
  overwriteList,
  renameList,
  saveAs,
  sameSelection,
  sortedLists,
  unsavedPainting,
  updateCustomLists,
  withListLoaded,
  type NameProblem,
  type SavedCustomList,
} from '../../drills/customLists';
import { useCustomLists } from '../useCustomLists';
import './savedCustomLists.css';

/**
 * Wave W: the Custom editor's saved lists -- Save as, Load, Overwrite,
 * Rename, Delete. The painting above is the working copy the drills deal
 * from; a list is a named copy of it, changed only by an explicit save.
 * Every question is asked inline (no browser dialog), two taps for anything
 * that destroys.
 */

/**
 * "12 Focus · 40 Regular", what the list deals: the tiers it uses (review
 * S8: at 320 all three, zeros too, wrapped to a second and third line).
 */
function listCounts(sel: CustomSelection): string[] {
  const c = { focus: 0, regular: 0, rare: 0 };
  for (const id of ALL_PAINT_CELL_IDS) {
    const t = tierOf(sel, id);
    if (t !== 'off') c[t] += 1;
  }
  const parts = [
    c.focus > 0 ? `${c.focus} Focus` : null,
    c.regular > 0 ? `${c.regular} Regular` : null,
    c.rare > 0 ? `${c.rare} Rare` : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) parts.push('Nothing painted');
  if (sel.favourMissed) parts.push('favour missed');
  return parts;
}

/** Each part whole, " · " between: a line breaks between parts, never inside "40 Regular". */
function Parts({ parts }: { parts: string[] }) {
  return parts.map((p, i) => (
    <Fragment key={p}>
      {i > 0 && ' · '}
      <span className="scl-part">{p}</span>
    </Fragment>
  ));
}

/** A list name with each word kept whole ("3-6" never breaks at its hyphen); a word wider than the line still wraps. */
function WholeWords({ text }: { text: string }) {
  return text.split(/(\s+)/).map((t, i) => (/^\s*$/.test(t) ? t : <span key={i} className="scl-word">{t}</span>));
}

const PROBLEM: Record<NameProblem, string> = {
  empty: 'Give the list a name.',
  taken: 'A list already has that name.',
  full: 'That is the most lists this keeps. Delete one first.',
};

type Row = { id: string; mode: 'menu' | 'rename' | 'delete' | 'load' | 'overwrite' };

export function SavedCustomLists({
  settings,
  selection,
  onSettingsChange,
}: {
  settings: Settings;
  /** The working selection as the editor shows it. */
  selection: CustomSelection;
  onSettingsChange: (next: Settings) => void;
}) {
  const doc = useCustomLists();
  const lists = sortedLists(doc);
  const current = matchingList(doc, selection, settings.drill.customListId);
  const origin = listById(doc, settings.drill.customListId);
  // Review S6: only while the painting is in no list. When it now matches
  // another list, the status names that one, and a one-tap "Save to" the
  // first would overwrite it with the second's cells unasked.
  const changedFromOrigin = origin !== undefined && current === undefined;

  const [naming, setNaming] = useState<{ name: string; problem: NameProblem | null; existing?: SavedCustomList } | null>(null);
  const [row, setRow] = useState<Row | null>(null);
  const [renameText, setRenameText] = useState('');
  const [renameProblem, setRenameProblem] = useState<NameProblem | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const commitSettings = (next: Settings) => {
    saveSettings(next);
    onSettingsChange(next);
  };
  const remember = (id: string) => commitSettings({ ...settings, drill: { ...settings.drill, customListId: id } });
  const failed = () => setMessage('Not saved: this phone’s storage is full.');

  const doSaveAs = () => {
    if (!naming) return;
    const r = updateCustomLists((d) => {
      const s = saveAs(d, naming.name, selection, Date.now());
      return { doc: s.ok ? s.doc : null, result: s };
    });
    if (!r.result.ok) {
      setNaming({ ...naming, problem: r.result.problem, existing: r.result.existing });
      return;
    }
    if (!r.saved) return failed();
    setNaming(null);
    remember(r.result.list.id);
    setMessage(`Saved “${r.result.list.name}”.`);
  };

  const doOverwrite = (target: SavedCustomList) => {
    const r = updateCustomLists((d) => {
      const there = listById(d, target.id) !== undefined;
      return { doc: there ? overwriteList(d, target.id, selection, Date.now()) : null, result: there };
    });
    if (!r.result) {
      // Review S6: deleted meanwhile (another tab), which is not a full phone.
      setNaming(null);
      setRow(null);
      setMessage(`“${target.name}” is no longer a list (deleted, perhaps in another tab). Save as… to keep the painting.`);
      return;
    }
    if (!r.saved) return failed();
    setNaming(null);
    setRow(null);
    remember(target.id);
    setMessage(`Saved over “${target.name}”.`);
  };

  const doLoad = (list: SavedCustomList) => {
    setRow(null);
    commitSettings(withListLoaded(settings, list));
    setMessage(`Loaded “${list.name}”.`);
  };

  const doRename = (list: SavedCustomList) => {
    const r = updateCustomLists((d) => {
      const s = renameList(d, list.id, renameText);
      return { doc: s.ok ? s.doc : null, result: s };
    });
    if (!r.result.ok) return setRenameProblem(r.result.problem);
    if (!r.saved) return failed();
    setRow(null);
    setMessage(`Renamed to “${listById(r.result.doc, list.id)?.name ?? renameText}”.`);
  };

  const doDelete = (list: SavedCustomList) => {
    const r = updateCustomLists((d) => ({ doc: deleteList(d, list.id), result: null }));
    if (!r.saved) return failed();
    setRow(null);
    setMessage(`Deleted “${list.name}”. The painting above is unchanged.`);
  };

  const status = current
    ? `This is “${current.name}”.`
    : changedFromOrigin
      ? `Changed since “${origin!.name}”.`
      : 'Not saved as a list.';

  return (
    <section className="cde-panel scl" aria-labelledby="scl-title" data-testid="saved-lists">
      <h2 className="u-section-title" id="scl-title">
        Saved lists
      </h2>
      <p className="scl-status" data-testid="scl-status" data-current={current?.id}>
        {status}
      </p>
      {naming ? (
        <div className="scl-form" data-testid="scl-save-form">
          <label className="scl-field">
            <span className="u-note">Save the painting above as</span>
            <input
              className="scl-input"
              name="listName"
              autoComplete="off"
              enterKeyHint="done"
              maxLength={MAX_NAME + 10}
              placeholder="e.g. Soft doubles"
              value={naming.name}
              autoFocus
              onChange={(e) => setNaming({ name: e.target.value, problem: null })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doSaveAs();
              }}
            />
          </label>
          {naming.problem && (
            <p className="scl-problem" role="alert">
              {naming.problem === 'taken' && naming.existing ? `“${naming.existing.name}” is already a list.` : PROBLEM[naming.problem]}
            </p>
          )}
          <div className="scl-btns">
            {naming.problem === 'taken' && naming.existing ? (
              <button type="button" className="u-btn u-btn-primary" onClick={() => doOverwrite(naming.existing!)}>
                Save over it
              </button>
            ) : (
              <button type="button" className="u-btn u-btn-primary" onClick={doSaveAs}>
                Save
              </button>
            )}
            <button type="button" className="u-btn" onClick={() => setNaming(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="scl-btns">
          <button
            type="button"
            className="u-btn"
            onClick={() => {
              setRow(null);
              setMessage(null);
              setNaming({ name: '', problem: null });
            }}
          >
            Save as…
          </button>
          {changedFromOrigin && (
            <button type="button" className="u-btn" data-testid="scl-save-origin" onClick={() => doOverwrite(origin!)}>
              Save to “{origin!.name}”
            </button>
          )}
        </div>
      )}
      {message && (
        <p className="u-note scl-message" role="status">
          {message}
        </p>
      )}
      {lists.length === 0 ? (
        <p className="u-note">No saved lists yet. Paint the chart, then Save as… to keep it under a name.</p>
      ) : (
        <ul className="scl-list">
          {lists.map((l) => {
            const open = row?.id === l.id ? row.mode : null;
            const isCurrent = current?.id === l.id;
            return (
              <li key={l.id} className="scl-row" data-testid="scl-row" data-list={l.name} data-current={isCurrent ? 'true' : undefined}>
                <div className="scl-row-main">
                  <span className="scl-row-text">
                    <span className="scl-row-name">
                      <WholeWords text={l.name} />
                      {isCurrent && <span className="scl-badge">loaded</span>}
                    </span>
                    <span className="scl-row-meta" data-testid="scl-row-counts">
                      <Parts parts={listCounts(l.selection)} />
                    </span>
                  </span>
                  <button
                    type="button"
                    className="u-btn scl-load"
                    disabled={isCurrent}
                    onClick={() => {
                      setNaming(null);
                      if (unsavedPainting(settings.drill, doc) && !sameSelection(l.selection, selection)) setRow({ id: l.id, mode: 'load' });
                      else doLoad(l);
                    }}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    className="u-btn scl-more"
                    aria-expanded={open === 'menu'}
                    aria-label={`More for ${l.name}`}
                    onClick={() => setRow(open === 'menu' ? null : { id: l.id, mode: 'menu' })}
                  >
                    ⋯
                  </button>
                </div>
                {open === 'load' && (
                  <div className="scl-ask" role="group" aria-label="Confirm load">
                    <p className="scl-ask-q">The painting above is not saved as a list. Replace it with “{l.name}”?</p>
                    <div className="scl-btns">
                      <button type="button" className="u-btn" onClick={() => setRow(null)}>
                        Keep painting
                      </button>
                      <button type="button" className="u-btn u-btn-primary" onClick={() => doLoad(l)}>
                        Load “{l.name}”
                      </button>
                    </div>
                  </div>
                )}
                {open === 'menu' && (
                  <div className="scl-btns scl-menu">
                    <button type="button" className="u-btn" disabled={isCurrent} onClick={() => setRow({ id: l.id, mode: 'overwrite' })}>
                      Save painting here
                    </button>
                    <button
                      type="button"
                      className="u-btn"
                      onClick={() => {
                        setRenameText(l.name);
                        setRenameProblem(null);
                        setRow({ id: l.id, mode: 'rename' });
                      }}
                    >
                      Rename
                    </button>
                    <button type="button" className="u-btn u-btn-danger" onClick={() => setRow({ id: l.id, mode: 'delete' })}>
                      Delete
                    </button>
                  </div>
                )}
                {open === 'overwrite' && (
                  <div className="scl-ask" role="group" aria-label="Confirm save over">
                    <p className="scl-ask-q">Replace what “{l.name}” deals with the painting above?</p>
                    <div className="scl-btns">
                      <button type="button" className="u-btn" onClick={() => setRow(null)}>
                        Cancel
                      </button>
                      <button type="button" className="u-btn u-btn-primary" onClick={() => doOverwrite(l)}>
                        Replace
                      </button>
                    </div>
                  </div>
                )}
                {open === 'rename' && (
                  <div className="scl-form">
                    <label className="scl-field">
                      <span className="u-sr-only">New name for {l.name}</span>
                      <input
                        className="scl-input"
                        name="renameList"
                        autoComplete="off"
                        enterKeyHint="done"
                        maxLength={MAX_NAME + 10}
                        value={renameText}
                        autoFocus
                        onChange={(e) => {
                          setRenameText(e.target.value);
                          setRenameProblem(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') doRename(l);
                        }}
                      />
                    </label>
                    {renameProblem && (
                      <p className="scl-problem" role="alert">
                        {PROBLEM[renameProblem]}
                      </p>
                    )}
                    <div className="scl-btns">
                      <button type="button" className="u-btn u-btn-primary" onClick={() => doRename(l)}>
                        Rename
                      </button>
                      <button type="button" className="u-btn" onClick={() => setRow(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {open === 'delete' && (
                  <div className="scl-ask" role="group" aria-label="Confirm delete">
                    <p className="scl-ask-q">Delete the list “{l.name}”? The painting above stays.</p>
                    <div className="scl-btns">
                      <button type="button" className="u-btn" onClick={() => setRow(null)}>
                        Keep it
                      </button>
                      <button type="button" className="u-btn u-btn-danger" onClick={() => doDelete(l)}>
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
