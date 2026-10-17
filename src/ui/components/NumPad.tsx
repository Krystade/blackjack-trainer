import { useEffect, useState } from 'react';
import { focusSwallowsKey } from '../keyboardFocus';
import { MINUS } from '../../drills/signed';
import './numPad.css';
import './numPadEmpty.css';

interface NumPadProps {
  label: string;
  onSubmit: (value: number) => void;
}

const DIGIT_ROWS = ['789', '456', '123'];

export function NumPad({ label, onSubmit }: NumPadProps) {
  const [value, setValue] = useState('');

  const appendDigit = (d: string) => setValue((v) => v + d);
  const toggleMinus = () => setValue((v) => (v.startsWith('-') ? v.slice(1) : '-' + v));
  const backspace = () => setValue((v) => v.slice(0, -1));
  // Wave A (s04/s05 high): nothing typed is no answer. OK on an empty pad
  // used to submit 0 -- a stray tap, or the second touch of a double-tap
  // landing on the next question, graded a phantom 0. A count of zero is
  // typed like any other number.
  const hasDigit = /\d/.test(value);
  const submit = () => {
    if (!hasDigit) return;
    onSubmit(parseInt(value, 10));
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
  }, [value, onSubmit]);

  return (
    <div className="numpad">
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
      <button type="button" className="numpad-ok" onClick={submit} disabled={!hasDigit}>
        OK
      </button>
    </div>
  );
}
