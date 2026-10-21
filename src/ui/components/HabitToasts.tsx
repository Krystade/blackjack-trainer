import { useEffect, useRef, useState } from 'react';
import { onHabitEvent, type HabitEvent } from '../../habits/progressStore';
import { ACHIEVEMENTS } from '../../habits/achievements';
import './habitToasts.css';

/** How long a habit banner stays up. */
export const HABIT_TOAST_MS = 4000;

function textFor(e: HabitEvent): string {
  if (e.kind === 'goal') return e.streak > 1 ? `Day ${e.streak} – goal met` : 'Daily goal met';
  if (e.kind === 'backfill') return `You’ve earned ${e.count} achievement${e.count === 1 ? '' : 's'} from your history`;
  const titles = e.ids.map((id) => ACHIEVEMENTS.find((a) => a.id === id)?.title ?? id);
  return titles.length === 1 ? `Achievement: ${titles[0]}` : `${titles.length} achievements: ${titles.join(', ')}`;
}

/**
 * Wave N: the goal-met banner and unlock toasts. Non-blocking by
 * construction: `pointer-events: none`, so a tap meant for an eyes-free zone
 * under it still lands there, and it goes away on its own.
 */
export function HabitToasts() {
  const [queue, setQueue] = useState<{ id: number; kind: HabitEvent['kind']; text: string }[]>([]);
  const seq = useRef(0);
  useEffect(
    () =>
      onHabitEvent((e) => {
        const id = ++seq.current;
        setQueue((q) => [...q, { id, kind: e.kind, text: textFor(e) }].slice(-3));
        window.setTimeout(() => setQueue((q) => q.filter((t) => t.id !== id)), HABIT_TOAST_MS);
      }),
    [],
  );
  if (queue.length === 0) return null;
  return (
    <div className="habit-toasts" role="status" aria-live="polite">
      {queue.map((t) => (
        <div key={t.id} className={`habit-toast is-${t.kind}`} data-testid={`habit-toast-${t.kind}`}>
          <span className="habit-toast-icon" aria-hidden="true">{t.kind === 'goal' ? '\u{1F525}' : '★'}</span>
          {t.text}
        </div>
      ))}
    </div>
  );
}
