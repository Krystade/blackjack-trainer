import type { Screen } from '../App';
import type { Settings } from '../../store/types';
import { loadStats } from '../../store/persist';
import { loadProgress, contextFor, habitNow } from '../../habits/progressStore';
import { effectiveToday, goalFor, heatmap } from '../../habits/progress';
import { evaluateAchievements, type AchievementStatus, type Ladder, type Tier } from '../../habits/achievements';
import { YouHeader } from '../components/YouHeader';
import './progress.css';
import './progressLadder.css';

const GROUPS = ['Habit', 'Drills', 'Counting', 'Drive', 'Play', 'Casino'] as const;

function fmtDate(iso: string): string {
  if (iso === '') return 'from history';
  const t = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const TIER_NAME: Record<Tier, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

/**
 * Wave T: one mastery achievement and its three tiers. Earned tiers keep
 * their date; the bar and its note are for the next tier up.
 */
function LadderTile({ ladder, tiers }: { ladder: Ladder; tiers: AchievementStatus[] }) {
  const earned = tiers.filter((t) => t.earned);
  const top = earned[earned.length - 1];
  const next = tiers.find((t) => !t.earned);
  const pct = next ? Math.round(next.fraction * 100) : 100;
  return (
    <li
      className={`ach is-ladder tier-${top?.def.tier ?? 'bronze'}${top ? ' is-earned' : ''}`}
      data-testid={`ach-${ladder.id}`}
      data-tier={top?.def.tier ?? 'none'}
    >
      <span className="ach-medal" aria-hidden="true" />
      <span className="ach-body">
        <span className="ach-title">{ladder.title}</span>
        <span className="ach-how">{ladder.how}</span>
        <ol className="ach-tiers">
          {tiers.map((t) => {
            const when = t.earned ? (t.earnedAt === undefined ? 'Earned' : t.earnedAt === '' ? 'From history' : fmtDate(t.earnedAt)) : '';
            return (
              <li
                key={t.def.id}
                className={`ach-tier tier-${t.def.tier}${t.earned ? ' is-earned' : ''}`}
                data-testid={`ach-${t.def.id}`}
                data-earned={t.earned ? '1' : '0'}
                aria-label={`${TIER_NAME[t.def.tier]}, ${t.def.pct}%: ${t.earned ? `earned${when === 'Earned' ? '' : ` ${when}`}` : 'not yet'}`}
              >
                <span className="ach-tier-medal" aria-hidden="true" />
                <span className="ach-tier-name">{TIER_NAME[t.def.tier]}</span>
                <span className="ach-tier-pct">{t.def.pct}%</span>
                <span className="ach-tier-when">{when}</span>
              </li>
            );
          })}
        </ol>
        {next && (
          <>
            <span className="ach-bar" role="progressbar" aria-label={`${TIER_NAME[next.def.tier]} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <span className="ach-bar-fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="ach-note" data-testid={`ach-${ladder.id}-next`}>
              {TIER_NAME[next.def.tier]}: {next.note ?? `${Math.floor(next.value).toLocaleString()} / ${next.target.toLocaleString()}`}
            </span>
          </>
        )}
      </span>
    </li>
  );
}

function fmtMinutes(ms: number): string {
  const min = Math.floor(ms / 60_000);
  return min >= 120 ? `${Math.floor(min / 60)} h ${min % 60} m` : `${min} min`;
}

/** Wave N: streaks, the last 12 weeks and the achievements. Wave W: one half of the You tab. */
export function Progress({ settings, onNavigate }: { settings: Settings; onNavigate: (s: Screen) => void }) {
  const now = habitNow();
  const progress = loadProgress();
  // B34: the same today the streak was walked to, after a flight west.
  const today = effectiveToday(progress.days, now);
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
    <div className="progress-screen you-screen" data-testid="progress-screen">
      {/* Wave W: the You tab's switch; Home is a tab away, so no Back. */}
      <YouHeader current="progress" onNavigate={onNavigate} />
      <h1 className="u-sr-only">Progress</h1>
      <div className="progress-body">
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
            <span className="heatmap-key"><span className="heat-cell l0" /> none</span>
            <span className="heatmap-key"><span className="heat-cell l2" /> some</span>
            <span className="heatmap-key"><span className="heat-cell l4" /> goal met</span>
            <span className="heatmap-key"><span className="heat-cell l0 is-frozen" /> freeze</span>
            <span className="heatmap-key"><span className="heat-cell l0 is-today" /> today</span>
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
                    // Wave T: a mastery ladder is one tile, drawn at its first tier.
                    if (s.def.ladder) {
                      const ladder = s.def.ladder;
                      if (items.find((x) => x.def.ladder?.id === ladder.id) !== s) return null;
                      return <LadderTile key={ladder.id} ladder={ladder} tiers={items.filter((x) => x.def.ladder?.id === ladder.id)} />;
                    }
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
    </div>
  );
}
