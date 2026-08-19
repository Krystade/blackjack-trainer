import { describe, it, expect } from 'vitest';
import { swallowsKey } from './keyboardFocus';

describe('swallowsKey', () => {
  it('lets keys through when nothing is focused', () => {
    expect(swallowsKey(null, '1')).toBe(false);
    expect(swallowsKey(undefined, '1')).toBe(false);
  });

  it('lets keys through for ordinary non-control elements', () => {
    expect(swallowsKey({ tagName: 'DIV' }, '1')).toBe(false);
    expect(swallowsKey({ tagName: 'SPAN' }, 'Enter')).toBe(false);
  });

  // The reported bug: every drill guarded on `tagName === 'INPUT'`, and a
  // checkbox IS an <input>. Ticking "Dim screen" left it focused, so every
  // later keypress was swallowed and drilling went dead until the user
  // clicked elsewhere. A checkbox does not consume character keys at all.
  describe('checkboxes and radios', () => {
    it('does NOT swallow answer keys', () => {
      for (const key of ['1', '2', '5', '0', '-', '+', 'h', 's']) {
        expect(swallowsKey({ tagName: 'INPUT', type: 'checkbox' }, key)).toBe(false);
        expect(swallowsKey({ tagName: 'INPUT', type: 'radio' }, key)).toBe(false);
      }
    });

    // Space and Enter DO activate a focused checkbox, so letting those through
    // would toggle the setting AND advance the drill from one press.
    it('swallows the keys that activate the control', () => {
      expect(swallowsKey({ tagName: 'INPUT', type: 'checkbox' }, ' ')).toBe(true);
      expect(swallowsKey({ tagName: 'INPUT', type: 'checkbox' }, 'Enter')).toBe(true);
      expect(swallowsKey({ tagName: 'INPUT', type: 'radio' }, ' ')).toBe(true);
    });

    it('is case-insensitive about the type attribute', () => {
      expect(swallowsKey({ tagName: 'INPUT', type: 'CheckBox' }, '1')).toBe(false);
    });
  });

  describe('text-entry controls still take every key', () => {
    it('swallows for text-like input types', () => {
      for (const type of ['text', 'number', 'search', 'tel', 'url', 'email', 'password']) {
        expect(swallowsKey({ tagName: 'INPUT', type }, '1')).toBe(true);
      }
    });

    it('swallows for an input with no type at all (defaults to text)', () => {
      expect(swallowsKey({ tagName: 'INPUT' }, '1')).toBe(true);
    });

    it('swallows for textarea and contenteditable', () => {
      expect(swallowsKey({ tagName: 'TEXTAREA' }, '1')).toBe(true);
      expect(swallowsKey({ tagName: 'DIV', isContentEditable: true }, 'a')).toBe(true);
    });

    // An input type this helper has never heard of is far more likely to be a
    // text variant than a button, so bias toward not stealing its keys.
    it('swallows for an unrecognised input type', () => {
      expect(swallowsKey({ tagName: 'INPUT', type: 'some-future-type' }, '1')).toBe(true);
    });
  });

  // A <select> genuinely uses typing to jump options and arrows to move
  // between them, so it must keep swallowing. The stranding it caused is
  // fixed by releasing focus after a change, not by stealing its keys.
  it('swallows every key for a select', () => {
    expect(swallowsKey({ tagName: 'SELECT' }, '1')).toBe(true);
    expect(swallowsKey({ tagName: 'SELECT' }, 'ArrowDown')).toBe(true);
  });

  // Buttons were never in the original guard, and drills rely on Enter/Space
  // reaching them after a click. Pinned so the fix does not silently widen.
  it('leaves buttons alone', () => {
    expect(swallowsKey({ tagName: 'BUTTON' }, ' ')).toBe(false);
    expect(swallowsKey({ tagName: 'BUTTON' }, '1')).toBe(false);
  });
});
