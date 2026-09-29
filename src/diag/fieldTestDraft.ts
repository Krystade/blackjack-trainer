/**
 * The half-typed note, kept where a dead page cannot take it.
 *
 * A note is free text for what the answer stack has no word for, and every
 * one of the first four drives produced something in that class. The screen
 * saves whatever is in the box when the step is left -- from an effect
 * cleanup, which covers the next step, Back, Pause and Finish.
 *
 * WHAT IT CANNOT COVER is a page that stops existing: a reload (the update
 * check does one by itself, mid-drive, unasked) and an iOS kill both run no
 * cleanup at all. So a note typed in traffic and not yet submitted was gone,
 * and the operator had no way to know until they read the log in the car
 * park. That is exactly the note most worth having: it was written while the
 * thing was happening.
 *
 * Written on every keystroke, and deliberately NOT part of `FieldTestRun`.
 * Two costs, neither of them worth paying per character: `write` there
 * persists the whole run blob and notifies every subscriber, which re-renders
 * the screen from the parent that holds the run in state; and the run's key
 * is cross-tab synced (`OWNED_KEYS`), so each keystroke would fire a storage
 * event in every other copy of the app and bump its external-write version.
 * This key has no subscribers and is not synced, so a keystroke costs one
 * `setItem`.
 *
 * The step, the condition AND THE RUN travel with the text. The pointer can
 * move while the page is away -- a condition change at the gate snaps it --
 * so a note belongs to the step it was typed on rather than to wherever the
 * run resumes; and the run id is what stops a draft from a dead leg being
 * offered to the next one. `car` twice in a row is two legs at the same step
 * under the same condition, and without the run id the second leg's box
 * opened holding the first leg's text.
 *
 * WHO WRITES IT OUT: the gate (`FieldTest`), on the boot that finds it,
 * beside the lock probe's own boot scoring and for the same reason -- it has
 * to land whether or not the operator resumes. See that effect.
 */

const STORAGE_KEY = 'bjtrainer.fieldTestDraft.v1';

export interface FieldTestDraft {
  step: string;
  condition: string;
  /** The run it was typed in, so a later leg cannot inherit it. */
  run: string;
  text: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The draft in storage, or undefined when there is none worth restoring. */
export function readFieldTestDraft(): FieldTestDraft | undefined {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return undefined;
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    // EVERY FIELD CHECKED, not just the text. A draft whose `step` is not a
    // string goes straight into a `note` row as whatever it is, and the row is
    // then filed against a step that does not exist. `run` is allowed to be
    // missing, because a draft left by the build that shipped without it is
    // still a note -- read as belonging to no run, which is what makes the
    // seed refuse it rather than offering it to the current one.
    if (typeof d.step !== 'string' || typeof d.condition !== 'string') return undefined;
    if (typeof d.text !== 'string') return undefined;
    // An empty draft is not a draft. Written as one by the box being cleared,
    // and restoring it would put a note row of nothing into the log.
    //
    // TRIMMED TO DECIDE, RETURNED AS TYPED: the operator stopped mid-sentence
    // and the trailing space is part of where they stopped.
    if (!d.text.trim()) return undefined;
    return {
      step: d.step,
      condition: d.condition,
      run: typeof d.run === 'string' ? d.run : '',
      text: d.text,
    };
  } catch {
    return undefined;
  }
}

/** Keep what is in the box. Clearing the box clears the draft. */
export function writeFieldTestDraft(draft: FieldTestDraft): void {
  const s = storage();
  if (!s) return;
  try {
    if (!draft.text.trim()) {
      s.removeItem(STORAGE_KEY);
      return;
    }
    s.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // A full or blocked store must not take the keystroke down with it: the
    // box still holds the text, and the exit still writes the note row.
  }
}

/** Forget it -- the note has been written, or the run has moved on. */
export function clearFieldTestDraft(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do; a stale draft is recovered as a note on the next boot.
  }
}
