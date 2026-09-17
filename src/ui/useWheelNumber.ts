import { useEffect, useMemo, useRef } from 'react';
import { createWheelNumberEntry, type WheelNumberEntry } from '../audio/wheelNumber';

/**
 * `createWheelNumberEntry` bound to a screen's real clock and callbacks.
 *
 * The callbacks are held in refs and read at fire time for the same reason
 * `useWheelCommand` and `useVoiceControl` do it: they close over drill state
 * that changes on every render, and rebuilding the entry would throw away a
 * proposal the operator was halfway through pressing out.
 *
 * Unmounting abandons whatever was standing. A count committed into a screen
 * the driver has already left would be graded against a question nobody is
 * looking at.
 */
export function useWheelNumber(handlers: {
  readback: (value: number) => void;
  commit: (value: number) => void;
  clamp?: (value: number) => number;
}): WheelNumberEntry {
  const ref = useRef(handlers);
  ref.current = handlers;

  const entry = useMemo(
    () =>
      createWheelNumberEntry<ReturnType<typeof setTimeout>>({
        schedule: (fn, ms) => setTimeout(fn, ms),
        cancel: (handle) => clearTimeout(handle),
        readback: (value) => ref.current.readback(value),
        commit: (value) => ref.current.commit(value),
        clamp: (value) => (ref.current.clamp ? ref.current.clamp(value) : value),
      }),
    [],
  );

  useEffect(() => () => entry.reset(), [entry]);

  return entry;
}
