import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { casinoById, loadCasinoLog, setCasinoNotes, type CasinoLog } from '../../../store/casinoLog';

/**
 * Wave K: a casino's notes, edited in place on its page and saved as you go
 * -- after a short pause in typing, on leaving the box, when the screen
 * closes, and when the page is hidden or closed (review S6: an iOS web app
 * sent to the background never unmounts, and may be killed there). Each save
 * moves the casino's `updatedAt`, so an import keeps whichever copy was
 * written last.
 *
 * THE MID-INPUT TRAP. A save updates the log, the log re-renders this box,
 * and a store value pushed into a focused textarea mid-word erases what was
 * typed since. So while the box has focus its own text is the truth and the
 * stored value is ignored; it is read back only while the box is idle (an
 * import, another tab).
 *
 * ONLY WHAT WAS TYPED IS SAVED (review S5). Without a keystroke there is
 * nothing to save: tapping into the box and out again takes the stored value
 * (which another tab may have changed meanwhile) instead of writing back the
 * copy from when the box was focused.
 */

const DEBOUNCE_MS = 700;

type Status = 'idle' | 'pending' | 'saved' | 'failed';

export function NotesEditor({ log, casinoId, commit }: { log: CasinoLog; casinoId: string; commit: (next: CasinoLog) => boolean }) {
  const stored = casinoById(log, casinoId)?.notes ?? '';
  const [text, setText] = useState(stored);
  const [status, setStatus] = useState<Status>('idle');
  const focused = useRef(false);
  const latest = useRef(stored);
  /** Typed since the last save landed. */
  const dirty = useRef(false);
  const storedNow = useRef(stored);
  storedNow.current = stored;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focused.current) return;
    latest.current = stored;
    setText(stored);
  }, [stored]);

  // Grow with the text: no inner scrollbar on a phone.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 88)}px`;
  }, [text]);

  /** Write the typed text, if any. False when the write did not land. */
  const save = useCallback((): boolean => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current) return true;
    // From the stored log, not this render's copy: nothing else on the page is overwritten.
    const fresh = loadCasinoLog();
    const next = setCasinoNotes(fresh, casinoId, latest.current, Date.now());
    const ok = next === fresh || commit(next);
    if (ok) dirty.current = false;
    return ok;
  }, [casinoId, commit]);

  const flush = useCallback(() => {
    if (!dirty.current) return;
    // Review N9: "Saved" only when the write landed.
    setStatus(save() ? 'saved' : 'failed');
  }, [save]);

  // Leaving the screen, hiding the page or closing it with typing unsaved still saves it.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') save();
    };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onHide);
      save();
    };
  }, [save]);

  return (
    <section className="cas-section cas-notes" aria-labelledby="cas-notes-title" data-testid="casino-notes">
      <div className="cas-section-head">
        <h2 className="u-section-title" id="cas-notes-title">
          Notes
        </h2>
        <span className="cas-note cas-notes-status" aria-live="polite" data-testid="notes-status">
          {status === 'pending' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'failed' ? 'Not saved' : ''}
        </span>
      </div>
      <div className="cas-pad-x">
        <textarea
          ref={box}
          className="cas-input cas-textarea cas-notes-box"
          name="casinoNotes"
          aria-labelledby="cas-notes-title"
          placeholder="Pit names, shift changes, good dealers, comps…"
          value={text}
          rows={3}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            if (dirty.current) {
              flush();
              return;
            }
            // Nothing typed: show what is stored now (another tab may have changed it).
            latest.current = storedNow.current;
            setText(storedNow.current);
          }}
          onChange={(e) => {
            dirty.current = true;
            latest.current = e.target.value;
            setText(e.target.value);
            setStatus('pending');
            if (timer.current !== null) clearTimeout(timer.current);
            timer.current = setTimeout(flush, DEBOUNCE_MS);
          }}
        />
      </div>
    </section>
  );
}
