/**
 * Should a keystroke be left to the focused control instead of being graded
 * as a drill answer?
 *
 * Every drill attaches its `keydown` listener to `window`, so it sees keys
 * that were really meant for whatever has focus. The original guard was
 *
 *     if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
 *
 * repeated at eight call sites. That is right for a text field and wrong for
 * a checkbox: a checkbox IS an `<input>`, it keeps focus after being clicked,
 * and it does not consume character keys at all. So ticking any of the 17
 * checkboxes in this app (e.g. "Dim screen") killed keyboard drilling
 * outright -- every later keypress hit the guard and returned, with no
 * visible reason, until the user happened to click somewhere else.
 *
 * The rule here is "does this control actually consume THIS key", which is
 * the question the call sites meant to ask all along.
 *
 * Takes a structural shape rather than an `Element` so it is testable under
 * this repo's DOM-less `environment: 'node'` vitest config.
 */
export interface FocusedControl {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

/** Input types that take free text, and so want every keystroke. */
const TEXT_ENTRY_TYPES = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
]);

/** Input types that are activated by a key rather than typed into. */
const ACTIVATED_TYPES = new Set(['checkbox', 'radio']);

/** The keys that activate a focused checkbox or radio. */
const ACTIVATION_KEYS = new Set([' ', 'Enter', 'Spacebar']);

export function swallowsKey(el: FocusedControl | null | undefined, key: string): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;

  switch (el.tagName?.toUpperCase()) {
    case 'TEXTAREA':
      return true;

    // A <select> really does use both typing (jump to an option by its first
    // letters) and the arrow keys, so it keeps every key. The stranding the
    // index select caused is fixed by releasing focus once a choice is made
    // -- see `blurAfterChange` -- rather than by taking its keys away.
    case 'SELECT':
      return true;

    case 'INPUT': {
      const type = el.type?.toLowerCase();
      // An <input> with no type attribute is a text field.
      if (type === undefined || type === '') return true;
      if (TEXT_ENTRY_TYPES.has(type)) return true;
      if (ACTIVATED_TYPES.has(type)) return ACTIVATION_KEYS.has(key);
      // Unknown or future input types are far likelier to be text variants
      // than buttons, so bias toward leaving their keys alone.
      return true;
    }

    // BUTTON deliberately absent: it was never in the original guard, and
    // drills rely on Enter/Space still reaching them after a click.
    default:
      return false;
  }
}

/**
 * Read the live focus and ask the same question. Call sites pass the event's
 * key; `document.activeElement` is what the original guard inspected.
 */
export function focusSwallowsKey(key: string): boolean {
  if (typeof document === 'undefined') return false;
  return swallowsKey(document.activeElement as FocusedControl | null, key);
}

/**
 * Release focus from a `<select>` (or any control) once its value is chosen.
 *
 * Without this the index select keeps focus indefinitely after a choice, and
 * because a select legitimately swallows every key, keyboard drilling stays
 * dead until the user clicks elsewhere -- the same dead-keyboard symptom as
 * the checkbox bug, reached by a different route and needing a different fix.
 */
export function blurAfterChange(target: EventTarget | null): void {
  if (target && 'blur' in target && typeof (target as HTMLElement).blur === 'function') {
    (target as HTMLElement).blur();
  }
}
