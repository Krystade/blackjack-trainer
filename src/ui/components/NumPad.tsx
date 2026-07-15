import { useState } from 'react';

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
  const submit = () => {
    const n = value === '' || value === '-' ? 0 : parseInt(value, 10);
    onSubmit(n);
    setValue('');
  };

  return (
    <div className="numpad">
      <div className="numpad-label">{label}</div>
      <div className="numpad-display">{value === '' ? '0' : value}</div>
      <div className="numpad-grid">
        {DIGIT_ROWS.map((row) =>
          row.split('').map((d) => (
            <button key={d} type="button" className="numpad-btn" onClick={() => appendDigit(d)}>
              {d}
            </button>
          )),
        )}
        <button type="button" className="numpad-btn" onClick={toggleMinus}>
          −
        </button>
        <button type="button" className="numpad-btn" onClick={() => appendDigit('0')}>
          0
        </button>
        <button type="button" className="numpad-btn" onClick={backspace}>
          ⌫
        </button>
      </div>
      <button type="button" className="numpad-ok" onClick={submit}>
        OK
      </button>
    </div>
  );
}
