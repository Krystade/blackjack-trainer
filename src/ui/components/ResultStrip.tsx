import { useEffect, useState, type ReactNode } from 'react';
import './resultStrip.css';

/**
 * B1 shell (spec 2026-10-13, "Shared building blocks"): the previous
 * answer's result, shown while the NEXT prompt is already on screen.
 *
 * Presentational only. The caller passes a snapshot of the answered prompt
 * in `children` -- never the live current prompt -- so nothing in the strip
 * can describe the new hand (#8/#10).
 *
 * - `tone="ok"` fades out after `fadeMs` (2.5s).
 * - `tone="miss"` stays until the caller replaces or clears it, which is on
 *   the next answer.
 * - `id` must change for every new result. A new id restarts the fade, even
 *   when two correct answers in a row render identical text.
 */
export function ResultStrip({
  id,
  tone,
  children,
  fadeMs = 2500,
}: {
  id: string | number;
  tone: 'ok' | 'miss';
  children: ReactNode;
  fadeMs?: number;
}) {
  const [fadedId, setFadedId] = useState<string | number | null>(null);

  useEffect(() => {
    if (tone !== 'ok') return;
    const t = setTimeout(() => setFadedId(id), fadeMs);
    return () => clearTimeout(t);
  }, [id, tone, fadeMs]);

  const faded = tone === 'ok' && fadedId === id;
  return (
    <div
      className={`result-strip result-strip--${tone}${faded ? ' result-strip--faded' : ''}`}
      role="status"
      aria-live="polite"
      data-testid="result-strip"
      data-tone={tone}
    >
      {children}
    </div>
  );
}
