import type { Screen } from '../App';
import type { Settings } from '../../store/types';
import { loadStats } from '../../store/persist';
import { loadProgress, contextFor, habitNow } from '../../habits/progressStore';
import { goalFor, heatmap } from '../../habits/progress';
import { evaluateAchievements } from '../../habits/achievements';
import { localDayKey } from '../../store/practiceDays';
import './progress.css';

const GROUPS = ['Habit', 'Drills', 'Counting', 'Drive', 'Play', 'Casino'] as const;

function fmtDate(iso: string): string {
  if (iso === '') return 'from history';
  const t = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtMinutes(ms: number): string {
  const min = Math.floor(ms / 60_000);
  return min >= 120 ? `${Math.floor(min / 60)} h ${min % 60} m` : `${min} min`;
}

/** Wave N: streaks, the last 12 weeks and the achievements. */
export function Progress({ settings, onNavigate }: { settings: Settings; onNavigate: (s: Screen) => void }) {
  const now = habitNow();
  const today = localDayKey(new Date(now));
  const progress = loadProgress();
  const stats = loadStats();
  const ctx = contextFor(stats, progress, now);
  const goal = goalFor(settings.habits?.goal);
  const cols = heatmap(progress.days, today, goal, ctx.streak.frozen);
  const statuses = evaluateAchievements(ctx);
  const earnedCount = statuses.filter((s) => s.earned).length;
  const days = Object.values(progress.days);
  const daysMet = days.filter((d) => d.met).length;
  const activeMs = days.reduce((a, d) => a + d.activeMs, 0);

  return (
    <div className="progress-screen" data-testid="progress-screen">
      <header className="progress-head">
        <button type="button" className="u-btn progress-back" onClick={() => onNavigate('home')}>
          &lsaquo; Home
        </button>
        <h1 className="progress-title">Progress</h1>
      </header>

      <section className="progress-card progress-streaks" aria-label="Streaks">
        <div className="progress-fig">
          <span className="progress-fig-num" data-testid="progress-current">{ctx.streak.current}</span>
          <span className="progress-fig-label">current</span>
        </div>
        <div className="progress-fig">
          <span className="progress-fig-num" data-testid="progress-longest">{ctx.streak.longest}</span>
          <span className="progress-fig-label">longest</span>
        </div>
        <div className="progress-fig">
          <span className="progress-fig-num">{'❄'} {ctx.streak.freezes}</span>
          <span className="progress-fig-label">freezes</span>
        </div>
      </section>

      <section className="progress-card" aria-label="Last 12 weeks">
        <h2 className="progress-h2">Last 12 weeks</h2>
        <div className="heatmap" role="img" aria-label={`${daysMet} days with the goal met`}>
          {cols.map((col, i) => (
            <div className="heatmap-col" key={i}>
              {col.map((c) => (
                <span
                  key={c.key}
                  className={`heat-cell l${c.level}${c.frozen ? ' is-frozen' : ''}${c.future ? ' is-future' : ''}${c.key === today ? ' is-today' : ''}`}
                  title={c.key}
                />
              ))}
            </div>
          ))}
        </div>
        <p className="heatmap-legend">
          <span className="heat-cell l0" /> none <span className="heat-cell l2" /> some <span className="heat-cell l4" /> goal met{' '}
          <span className="heat-cell l0 is-frozen" /> freeze
        </p>
        <dl className="progress-totals">
          <div><dt>Days met</dt><dd>{daysMet}</dd></div>
          <div><dt>Active time</dt><dd>{fmtMinutes(activeMs)}</dd></div>
          <div><dt>Answers</dt><dd>{progress.answersTotal.toLocaleString()}</dd></div>
          <div><dt>Driven</dt><dd>{fmtMinutes(progress.drive.totalMs)}</dd></div>
        </dl>
      </section>

      <section className="progress-card" aria-label="Achievements">
        <h2 className="progress-h2">
          Achievements <span className="progress-h2-count" data-testid="achievements-count">{earnedCount}/{statuses.length}</span>
        </h2>
        {GROUPS.map((g) => {
          const items = statuses.filter((s) => s.def.group === g);
          return (
            <div key={g} className="ach-group">
              <h3 className="ach-group-title">{g}</h3>
              <ul className="ach-grid">
                {items.map((s) => {
                  const hidden = s.def.secret && !s.earned;
                  return (
                    <li
                      key={s.def.id}
                      className={`ach tier-${s.def.tier}${s.earned ? ' is-earned' : ''}`}
                      data-testid={`ach-${s.def.id}`}
                      data-earned={s.earned ? '1' : '0'}
                    >
                      <span className="ach-medal" aria-hidden="true" />
                      <span className="ach-body">
                        <span className="ach-title">{hidden ? 'Secret' : s.def.title}</span>
                        <span className="ach-how">{hidden ? 'Keep practising to find this one.' : s.def.how}</span>
                        {s.earned ? (
                          <span className="ach-date">Earned{s.earnedAt !== undefined && s.earnedAt !== '' ? ` ${fmtDate(s.earnedAt)}` : s.earnedAt === '' ? ' from history' : ''}</span>
                        ) : hidden ? null : (
                          <span className="ach-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.fraction * 100)}>
                            <span className="ach-bar-fill" style={{ width: `${Math.round(s.fraction * 100)}%` }} />
                          </span>
                        )}
                        {!s.earned && !hidden && (
                          <span className="ach-note">
                            {s.note ?? `${Math.floor(s.value).toLocaleString()} / ${s.target.toLocaleString()}`}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
}
