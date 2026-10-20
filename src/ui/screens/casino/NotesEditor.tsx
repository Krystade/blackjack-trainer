import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { casinoById, loadCasinoLog, setCasinoNotes, type CasinoLog } from '../../../store/casinoLog';

/**
 * Wave K: a casino's notes, edited in place on its page and saved as you go
 * -- after a short pause in typing, on leaving the box, and when the page
 * closes. Each save moves the casino's `updatedAt`, so an import keeps
 * whichever copy was written last.
 *
 * THE MID-INPUT TRAP. A save updates the log, the log re-renders this box,
 * and a store value pushed into a focused textarea mid-word erases what was
 * typed since. So while the box has focus its own text is the truth and the
 * stored value is ignored; it is read back only while the box is idle (an
 * import, another tab).
 */

const DEBOUNCE_MS = 700;

export function NotesEditor({ log, casinoId, commit }: { log: CasinoLog; casinoId: string; commit: (next: CasinoLog) => boolean }) {
  const stored = casinoById(log, casinoId)?.notes ?? '';
  const [text, setText] = useState(stored);
  const [status, setStatus] = useState<'idle' | 'pending' | 'saved'>('idle');
  const focused = useRef(false);
  const latest = useRef(stored);
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

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // From the stored log, not this render's copy: nothing else on the page is overwritten.
    const fresh = loadCasinoLog();
    const next = setCasinoNotes(fresh, casinoId, latest.current, Date.now());
    if (next !== fresh) commit(next);
    setStatus((st) => (st === 'idle' ? 'idle' : 'saved'));
  }, [casinoId, commit]);

  // Leaving the page with a save pending still saves it.
  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        const fresh = loadCasinoLog();
        const next = setCasinoNotes(fresh, casinoId, latest.current, Date.now());
        if (next !== fresh) commit(next);
      }
    },
    [casinoId, commit],
  );

  return (
    <section className="cas-section cas-notes" aria-labelledby="cas-notes-title" data-testid="casino-notes">
      <div className="cas-section-head">
        <h2 className="u-section-title" id="cas-notes-title">
          Notes
        </h2>
        <span className="cas-note cas-notes-status" aria-live="polite" data-testid="notes-status">
          {status === 'pending' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
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
            flush();
          }}
          onChange={(e) => {
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
