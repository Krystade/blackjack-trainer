import { useState } from 'react';
import { DEFAULT_SESSION_HOURS, makeCasinoId, setCasinoSettings, type CasinoLog } from '../../../store/casinoLog';
import { describeMethod, ENTRY_RANGE, EXIT_RANGE, methodsFor, normMethod, RAMP_START_RANGE, type BetMethod } from '../../../engine/betMethods';
import { Choice, Field, FieldGroup } from './fields';
import { useActiveProfile } from './useGameStats';

/**
 * Wave K: the Casino tab's settings -- how long a visit lasts (for EV per
 * trip hour) and the betting methods added to the default set. Saved in the
 * casino log's settings, so they travel with its export.
 */

const range = ([lo, hi]: readonly [number, number]) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
const tcLabel = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

type BetKind = 'ramp' | 'flat' | 'start';

export function CasinoSettings({ log, commit }: { log: CasinoLog; commit: (next: CasinoLog) => boolean }) {
  const profile = useActiveProfile();
  const [hours, setHours] = useState(() => String(log.settings.sessionHours ?? DEFAULT_SESSION_HOURS));
  const [hoursMsg, setHoursMsg] = useState<string | null>(null);
  const [bet, setBet] = useState<BetKind>('ramp');
  const [start, setStart] = useState(2);
  const [entryOn, setEntryOn] = useState(false);
  const [entry, setEntry] = useState(2);
  const [exitOn, setExitOn] = useState(true);
  const [exit, setExit] = useState(-1);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const custom = log.settings.methods ?? [];

  const saveHours = () => {
    const n = Number(hours);
    if (!Number.isFinite(n) || n < 0.25 || n > 24) {
      setHoursMsg('Enter hours between 0.25 and 24.');
      return;
    }
    commit(setCasinoSettings(log, { sessionHours: n }, Date.now()));
    setHoursMsg(`Saved: ${n} h a visit.`);
  };

  const add = () => {
    const m = normMethod({
      id: makeCasinoId('m'),
      label,
      flat: bet === 'flat',
      entryTc: entryOn ? entry : null,
      exitTc: exitOn ? exit : null,
      rampStartTc: bet === 'start' ? start : null,
    });
    if (!m) {
      setError('The entry count has to be above the exit count.');
      return;
    }
    setError(null);
    commit(setCasinoSettings(log, { methods: [...custom, m] }, Date.now()));
    setLabel('');
  };

  const remove = (id: string) => commit(setCasinoSettings(log, { methods: custom.filter((m) => m.id !== id) }, Date.now()));

  return (
    <div className="cas-form" data-testid="casino-settings">
      <section className="cas-section" aria-labelledby="cs-visit-title">
        <div className="cas-section-head">
          <h2 className="u-section-title" id="cs-visit-title">
            A visit
          </h2>
        </div>
        <div className="cas-pad-x cas-stack">
          <Field label="Session hours" hint="How long you play once you are there. EV per trip hour spreads it over the drive both ways.">
            <span className="cas-inline">
              <input className="cas-input" name="sessionHours" inputMode="decimal" autoComplete="off" value={hours} onChange={(e) => setHours(e.target.value)} />
              <button type="button" className="u-btn" onClick={saveHours}>
                Save
              </button>
            </span>
          </Field>
          {hoursMsg && (
            <p className="cas-message" role="status">
              {hoursMsg}
            </p>
          )}
        </div>
      </section>

      <section className="cas-section" aria-labelledby="cs-methods-title">
        <div className="cas-section-head">
          <h2 className="u-section-title" id="cs-methods-title">
            Betting methods
          </h2>
        </div>
        <div className="cas-pad-x cas-stack">
          <p className="cas-note">
            Every game is worked out with each of these, and ranked by its best. Ramps are {profile.name}&rsquo;s; methods that would play
            identically are listed once.
          </p>
          <ul className="cas-list cas-cs-list">
            {methodsFor(profile, [], 'allowed').map((m) => (
              <li key={m.id} className="cas-cs-item">
                {describeMethod(m)}
              </li>
            ))}
            {custom.map((m: BetMethod) => (
              <li key={m.id} className="cas-cs-item cas-cs-custom" data-testid="custom-method">
                <span>{describeMethod(m)}</span>
                <button type="button" className="cas-link" onClick={() => remove(m.id)} aria-label={`Remove ${describeMethod(m)}`}>
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <h3 className="cas-group-title cas-cs-add-title">Add a method</h3>
          <FieldGroup label="Bet">
            <Choice
              label="Bet"
              value={bet}
              options={[
                { value: 'ramp', label: 'Profile ramp' },
                { value: 'start', label: 'Min, then ramp' },
                { value: 'flat', label: 'Flat min' },
              ]}
              onChange={setBet}
            />
          </FieldGroup>
          {bet === 'start' && (
            <Field label="Ramp starts at TC" hint="Min bet below it; your ramp's steps from there.">
              <select className="cas-input" name="rampStart" value={start} onChange={(e) => setStart(Number(e.target.value))}>
                {range(RAMP_START_RANGE).map((n) => (
                  <option key={n} value={n}>
                    {tcLabel(n)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="cas-pair">
            <FieldGroup label="Sit down">
              <Choice
                label="Sit down"
                value={entryOn ? 'tc' : 'top'}
                options={[
                  { value: 'top', label: 'At shuffle' },
                  { value: 'tc', label: 'Back-count' },
                ]}
                onChange={(v) => setEntryOn(v === 'tc')}
              />
            </FieldGroup>
            <FieldGroup label="Leave">
              <Choice
                label="Leave"
                value={exitOn ? 'tc' : 'never'}
                options={[
                  { value: 'never', label: 'Never' },
                  { value: 'tc', label: 'Wong out' },
                ]}
                onChange={(v) => setExitOn(v === 'tc')}
              />
            </FieldGroup>
          </div>
          {(entryOn || exitOn) && (
            <div className="cas-pair">
              {entryOn ? (
                <Field label="Enter at TC ≥">
                  <select className="cas-input" name="entryTc" value={entry} onChange={(e) => setEntry(Number(e.target.value))}>
                    {range(ENTRY_RANGE).map((n) => (
                      <option key={n} value={n}>
                        {tcLabel(n)}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <span />
              )}
              {exitOn ? (
                <Field label="Leave at TC ≤">
                  <select className="cas-input" name="exitTc" value={exit} onChange={(e) => setExit(Number(e.target.value))}>
                    {range(EXIT_RANGE).map((n) => (
                      <option key={n} value={n}>
                        {tcLabel(n)}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <span />
              )}
            </div>
          )}
          <Field label="Name (optional)">
            <input className="cas-input" name="methodLabel" autoComplete="off" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          {error && (
            <p className="cas-field-error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="u-btn u-btn-primary cas-wide" onClick={add} data-testid="add-method">
            Add method
          </button>
        </div>
      </section>
    </div>
  );
}
