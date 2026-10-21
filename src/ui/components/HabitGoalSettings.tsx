import type { Settings } from '../../store/types';
import { GOALS, type GoalLevel } from '../../habits/progress';
import { CollapsibleSection } from './CollapsibleSection';
import './habitGoalSettings.css';

const LEVELS: { id: GoalLevel; name: string }[] = [
  { id: 'easy', name: 'Easy' },
  { id: 'normal', name: 'Normal' },
  { id: 'hard', name: 'Hard' },
];

/** Wave N: Settings > Daily goal. */
export function HabitGoalSettings({ settings, onChange }: { settings: Settings; onChange: (next: Settings) => void }) {
  const current = settings.habits?.goal ?? 'normal';
  return (
    <CollapsibleSection title={<>Daily goal</>} defaultOpen={false}>
      <div className="habit-goal" role="radiogroup" aria-label="Daily goal">
        {LEVELS.map((l) => {
          const g = GOALS[l.id];
          const on = current === l.id;
          return (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={on}
              data-goal={l.id}
              className={`habit-goal-option${on ? ' is-on' : ''}`}
              onClick={() => onChange({ ...settings, habits: { ...settings.habits, goal: l.id } })}
            >
              <span className="habit-goal-name">{l.name}</span>
              <span className="habit-goal-note">
                {g.minutes} min or {g.answers} answers
              </span>
            </button>
          );
        })}
      </div>
      <div className="settings-note-row u-note">
        A day counts once either is reached, from any mix of drills, Play and Drive. Active time stops
        when a minute goes by with no answer. A change applies from the next answer; days already met stay met.
      </div>
    </CollapsibleSection>
  );
}
