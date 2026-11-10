import { useEffect, useState } from 'react';
import { focusSwallowsKey } from '../keyboardFocus';
import { MINUS } from '../../drills/signed';
import './numPad.css';
import './numPadEmpty.css';

interface NumPadProps {
  label: string;
  onSubmit: (value: number) => void;
  /**
   * #29: optional controlled value ('-3', '' = nothing typed). A screen that
   * also takes the answer by voice or the wheel holds it here, so the keypad
   * display IS the one answer state and OK submits what was said.
   */
  value?: string;
  onValueChange?: (value: string) => void;
  /**
   * Owner 2026-11-10: an Expert distraction's division, whose answer may end
   * in .5. Shows a .5 key (and takes '.' from a keyboard) that puts the half
   * on or takes it off; the value submitted is then 10.5, not 10.
   */
  halves?: boolean;
}

/** The half as typed: always last, so digits stop once it is on. */
const HALF = '.5';

const DIGIT_ROWS = ['789', '456', '123'];

export function NumPad({ label, onSubmit, value: controlled, onValueChange, halves = false }: NumPadProps) {
  const [own, setOwn] = useState('');
  const value = controlled ?? own;
  const setValue = (next: string | ((v: string) => string)) => {
    const v = typeof next === 'function' ? next(value) : next;
    if (controlled === undefined) setOwn(v);
    onValueChange?.(v);
  };

  // A digit after the half would make 10.55; the half stays the last thing typed.
  const appendDigit = (d: string) => setValue((v) => (v.endsWith(HALF) ? v : v + d));
  const toggleMinus = () => setValue((v) => (v.startsWith('-') ? v.slice(1) : '-' + v));
  const backspace = () => setValue((v) => (v.endsWith(HALF) ? v.slice(0, -HALF.length) : v.slice(0, -1)));
  // On its own the half is 0.5 ("-" first gives -0.5), and pressing it again
  // takes back the 0 it put there too.
  const toggleHalf = () =>
    setValue((v) => {
      if (v === '0' + HALF || v === '-0' + HALF) return v.slice(0, -('0' + HALF).length);
      if (v.endsWith(HALF)) return v.slice(0, -HALF.length);
      return /\d$/.test(v) ? v + HALF : v + '0' + HALF;
    });
  // Wave A (s04/s05 high): nothing typed is no answer. OK on an empty pad
  // used to submit 0 -- a stray tap, or the second touch of a double-tap
  // landing on the next question, graded a phantom 0. A count of zero is
  // typed like any other number.
  const hasDigit = /\d/.test(value);
  const submit = () => {
    if (!hasDigit) return;
    onSubmit(halves ? Number(value) : parseInt(value, 10));
    setValue('');
  };

  // Desktop keyboard input (operator request): digits/-/_/Backspace/Enter
  // drive the exact same appendDigit/toggleMinus/backspace/submit functions
  // the on-screen buttons call, so there is no parallel input path for the
  // value to drift out of sync with. Every current NumPad use site (count
  // drill, true count drill, Table's count-check modal) permits a negative
  // value, so the minus toggle is unconditional here too.
  //
  // Hygiene: one listener per mounted NumPad, removed on unmount; skipped
  // whenever a native input/select/textarea has focus so Settings/profile
  // text fields are unaffected. NumPad only ever mounts while its own
  // answer phase/modal is showing, so this is naturally gated to "only acts
  // while a NumPad is actually up" -- there is never more than one mounted
  // at a time.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (focusSwallowsKey(e.key)) return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        appendDigit(e.key);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        toggleMinus();
      } else if (halves && (e.key === '.' || e.key === ',')) {
        e.preventDefault();
        toggleHalf();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, onSubmit, onValueChange, halves]);

  return (
    <div className={halves ? 'numpad numpad-halves' : 'numpad'}>
      <div className="numpad-label">{label}</div>
      {/* Wave A: shown with a real minus sign (U+2212), like the − key and the
          strips; the value itself keeps its ASCII '-' for parseInt. */}
      <div className="numpad-display" data-empty={value === '' ? 'true' : undefined}>
        {/* Not a '0': that looked like a typed answer, and OK sent it. */}
        {value === '' ? <span className="numpad-placeholder">Type a number</span> : value.replace('-', MINUS)}
      </div>
      <div className="numpad-grid">
        {DIGIT_ROWS.map((row) =>
          row.split('').map((d) => (
            <button key={d} type="button" className="numpad-btn" onClick={() => appendDigit(d)}>
              {d}
            </button>
          )),
        )}
        <button type="button" className="numpad-btn" aria-label="Plus or minus" onClick={toggleMinus}>
          −
        </button>
        <button type="button" className="numpad-btn" onClick={() => appendDigit('0')}>
          0
        </button>
        <button type="button" className="numpad-btn" aria-label="Delete last digit" onClick={backspace}>
          ⌫
        </button>
      </div>
      {halves ? (
        <div className="numpad-foot">
          <button
            type="button"
            className="numpad-btn numpad-half"
            aria-label="Add or remove a half"
            aria-pressed={value.endsWith(HALF)}
            data-testid="numpad-half"
            onClick={toggleHalf}
          >
            .5
          </button>
          <button type="button" className="numpad-ok" onClick={submit} disabled={!hasDigit}>
            OK
          </button>
        </div>
      ) : (
        <button type="button" className="numpad-ok" onClick={submit} disabled={!hasDigit}>
          OK
        </button>
      )}
    </div>
  );
}
