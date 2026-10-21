import './sideBetControl.css';
import { BET_NAMES, BET_RULES, SIDE_BET_IDS, payTableOf, payTablesFor } from '../../engine/sideBets/payTables';
import type { SideBetId } from '../../engine/sideBets/payTables';
import { sidePlan } from '../../engine/sideBets/plan';
import type { Profile, ProfileSideBet } from '../../store/types';
import { Stepper } from '../screens/Settings';
import { defaultSideBet, DEFAULT_SIDE_STAKE } from '../sideBetConfig';
import { sideSummary } from '../sideBetSummary';

/**
 * Wave L: the profile's side bet -- on or off, which bet, which pay table,
 * the stake -- and what the app knows about it at this profile's game.
 */
export function SideBetControl({
  profile,
  onChange,
  onReference,
}: {
  profile: Profile;
  onChange: (patch: Partial<Profile>) => void;
  /** Opens the Side bets reference page. */
  onReference?: () => void;
}) {
  const s: ProfileSideBet = profile.sideBet ?? { ...defaultSideBet(), enabled: false };
  const set = (patch: Partial<ProfileSideBet>) => onChange({ sideBet: { ...s, ...patch } });
  const table = payTableOf(s.bet, s.payTable);
  const plan = table ? sidePlan(s.bet, s.payTable, profile.rules.decks, profile.rules.s17) : null;
  const sum = plan ? sideSummary(plan, s.stake || DEFAULT_SIDE_STAKE) : null;
  return (
    <div className="side-bet-control" data-testid="profile-side-bet">
      <label className="settings-toggle-row">
        <span className="settings-label">Play a side bet</span>
        <input
          type="checkbox"
          className="settings-toggle"
          checked={s.enabled}
          data-testid="side-bet-enabled"
          onChange={(e) => set({ enabled: e.target.checked })}
        />
      </label>
      {s.enabled && (
        <>
          <div className="settings-row">
            <span className="settings-label">Bet</span>
            <select
              className="settings-select"
              value={s.bet}
              data-testid="side-bet-bet"
              onChange={(e) => {
                const bet = e.target.value as SideBetId;
                set({ bet, payTable: payTablesFor(bet)[0]!.id });
              }}
            >
              {SIDE_BET_IDS.map((id) => (
                <option key={id} value={id}>
                  {BET_NAMES[id]}
                </option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <span className="settings-label">Pay table</span>
            <select
              className="settings-select"
              value={s.payTable}
              data-testid="side-bet-table"
              onChange={(e) => set({ payTable: e.target.value })}
            >
              {payTablesFor(s.bet).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <Stepper
            label="Side stake"
            value={s.stake}
            min={1}
            max={500}
            step={5}
            format={(v) => `$${v}`}
            onChange={(v) => set({ stake: v })}
          />
          <p className="stats-detail side-bet-rule">{BET_RULES[s.bet]}</p>
          {sum ? (
            <dl className="side-bet-facts" data-testid="side-bet-facts">
              <dt>{profile.rules.decks} deck{profile.rules.decks > 1 ? 's' : ''}</dt>
              <dd>{sum.edge}</dd>
              <dt>Count</dt>
              <dd>
                {sum.count}
                {sum.tags && <span className="side-bet-tags">{sum.tags}</span>}
              </dd>
              <dt>Bet it</dt>
              <dd>{sum.trigger}{sum.freq && ` · ${sum.freq}`}</dd>
              <dt>Counted</dt>
              <dd>{sum.per100}</dd>
            </dl>
          ) : (
            <p className="stats-detail">No figures for this pay table at {profile.rules.decks} decks.</p>
          )}
        </>
      )}
      {onReference && (
        <button type="button" className="side-bet-ref-link" data-testid="side-bets-reference-link" onClick={onReference}>
          All side bets and their counts
        </button>
      )}
    </div>
  );
}
