import { useEffect } from 'react';
import { loadProgress, streakNow, habitNow, checkAchievementsNow } from '../../habits/progressStore';
import { addDays, effectiveToday, goalFraction, goalFor, weekView } from '../../habits/progress';
import type { Settings } from '../../store/types';
import './streakCard.css';

/** After this local hour an unmet goal on a live streak is "at risk". */
export const AT_RISK_HOUR = 18;

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Largest arc drawn for an unmet goal (see GoalRing). */
export const RING_UNMET_MAX = 0.9;

/** A small ring: today's progress toward the goal. */
export function GoalRing({ fraction, size = 52, label }: { fraction: number; size?: number; label: string }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  // Round caps add half the stroke at each end, so an arc past ~95% draws as
  // a closed ring. Until the goal is met the arc stops short enough that the
  // gap always shows.
  const drawn = fraction >= 1 ? 1 : Math.min(fraction, RING_UNMET_MAX);
  return (
    <svg className="streak-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <circle cx={size / 2} cy={size / 2} r={r} className="streak-ring-track" />
      {fraction > 0 && (
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        className={`streak-ring-fill${fraction >= 1 ? ' is-met' : ''}`}
        strokeDasharray={`${c * drawn} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      )}
    </svg>
  );
}

export function FlameIcon({ lit }: { lit: boolean }) {
  return (
    <svg className={`streak-flame${lit ? ' is-lit' : ''}`} viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-6 1-9.5z" />
    </svg>
  );
}

/**
 * Wave N: Home's streak card -- flame and streak, today's ring, freezes held,
 * this week's dots. Tapping it opens Progress.
 */
export function StreakCard({ settings, onOpen }: { settings: Settings; onOpen: () => void }) {
  // Achievements that move without an answer (a casino session logged) are
  // toasted on the way back to Home rather than at some later answer.
  useEffect(() => checkAchievementsNow(), []);
  const now = habitNow();
  const progress = loadProgress();
  // B34: the same today the streak was walked to, after a flight west.
  const today = effectiveToday(progress.days, now);
  const streak = streakNow(progress, now);
  const goal = goalFor(settings.habits?.goal);
  const day = progress.days[today];
  const fraction = goalFraction(day, goal);
  const week = weekView(progress.days, today, streak.frozen);
  const mins = Math.floor((day?.activeMs ?? 0) / 60_000);
  const answers = day?.answers ?? 0;
  const freezeUsed = streak.frozen.has(addDays(today, -1));
  const atRisk = !streak.todayMet && streak.current > 0 && new Date(now).getHours() >= AT_RISK_HOUR;
  const fresh = Object.keys(progress.days).length === 0;

  return (
    <button type="button" className="streak-card" data-testid="streak-card" onClick={onOpen} aria-label={`Streak ${streak.current} days. Open progress`}>
      <span className="streak-main">
        <FlameIcon lit={streak.todayMet} />
        <span className="streak-count">
          <span className="streak-num" data-testid="streak-count">{streak.current}</span>
          <span className="streak-unit">{streak.current === 1 ? 'day' : 'days'}</span>
        </span>
        <span className="streak-today">
          <GoalRing fraction={fraction} label={`Today ${Math.round(fraction * 100)}% of goal`} />
          <span className="streak-today-text" data-testid="streak-today">
            {streak.todayMet ? (
              <strong>Goal met</strong>
            ) : (
              <>
                {mins}/{goal.minutes} min
                <br />
                {answers}/{goal.answers} answers
              </>
            )}
          </span>
        </span>
      </span>
      <span className="streak-foot">
        <span className="streak-week" aria-label={`${week.met} of ${week.target} days this week`} data-testid="streak-week">
          {week.dots.map((d, i) => (
            <span key={d.key} className={`streak-dot is-${d.state}`} title={d.key} data-state={d.state}>
              <span className="streak-dot-day" aria-hidden="true">{d.state === 'frozen' ? '❄' : DOW[i]}</span>
            </span>
          ))}
          <span className="streak-week-text">
            {week.met}/{week.target}
          </span>
        </span>
        <span className="streak-freezes" data-testid="streak-freezes" aria-label={`${streak.freezes} streak freezes held`}>
          {'❄'} {streak.freezes}
        </span>
      </span>
      {fresh && <span className="streak-note">Daily goal: {goal.minutes} minutes or {goal.answers} answers, any drill, Play or Drive.</span>}
      {freezeUsed && (
        <span className="streak-note is-freeze" data-testid="streak-freeze-used">
          Freeze used &ndash; streak safe
        </span>
      )}
      {atRisk && (
        <span className="streak-note is-risk" data-testid="streak-at-risk">
          Streak at risk &ndash; today&rsquo;s goal isn&rsquo;t met yet
        </span>
      )}
    </button>
  );
}
