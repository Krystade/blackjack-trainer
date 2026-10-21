import { useState } from 'react';
import {
  DEFAULT_EXIT_FIND_MINUTES,
  DEFAULT_EXIT_WAIT_MINUTES,
  DEFAULT_SESSION_HOURS,
  EXIT_MINUTES_MAX,
  makeCasinoId,
  setCasinoSettings,
  type CasinoLog,
} from '../../../store/casinoLog';
import {
  describeMethod,
  duplicateOf,
  ENTRY_RANGE,
  EXIT_RANGE,
  methodsFor,
  normMethod,
  RAMP_START_RANGE,
  type BetMethod,
} from '../../../engine/betMethods';
import { Choice, Field, FieldGroup } from './fields';
import { useActiveProfile } from './useGameStats';

/**
 * Wave K: the Casino tab's settings -- how long a visit lasts (for EV per
 * trip hour), what leaving a table costs (review B1), and the betting
 * methods added to the default set, which can be edited and removed (review
 * N4). Saved in the casino log's settings, so they travel with its export.
 */

const range = ([lo, hi]: readonly [number, number]) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
const tcLabel = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

type BetKind = 'ramp' | 'flat' | 'start';

interface MethodForm {
  bet: BetKind;
  start: number;
  entryOn: boolean;
  entry: number;
  exitOn: boolean;
  exit: number;
  label: string;
}

const BLANK_FORM: MethodForm = { bet: 'ramp', start: 2, entryOn: false, entry: 2, exitOn: true, exit: -1, label: '' };

function formOf(m: BetMethod): MethodForm {
  return {
    bet: m.flat ? 'flat' : m.rampStartTc !== null ? 'start' : 'ramp',
    start: m.rampStartTc ?? 2,
    entryOn: m.entryTc !== null,
    entry: m.entryTc ?? 2,
    exitOn: m.exitTc !== null,
    exit: m.exitTc ?? -1,
    label: m.label ?? '',
  };
}

function minutesOk(text: string): number | null {
  const n = Number(text);
  return text.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= EXIT_MINUTES_MAX ? n : null;
}

export function CasinoSettings({ log, commit }: { log: CasinoLog; commit: (next: CasinoLog) => boolean }) {
  const profile = useActiveProfile();
  const [hours, setHours] = useState(() => String(log.settings.sessionHours ?? DEFAULT_SESSION_HOURS));
  const [hoursMsg, setHoursMsg] = useState<string | null>(null);
  const [find, setFind] = useState(() => String(log.settings.exitFindMinutes ?? DEFAULT_EXIT_FIND_MINUTES));
  const [wait, setWait] = useState(() => String(log.settings.exitWaitMinutes ?? DEFAULT_EXIT_WAIT_MINUTES));
  const [exitMsg, setExitMsg] = useState<string | null>(null);
  const [form, setForm] = useState<MethodForm>(BLANK_FORM);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [methodMsg, setMethodMsg] = useState<string | null>(null);
  const custom = log.settings.methods ?? [];
  const patch = (p: Partial<MethodForm>) => setForm((f) => ({ ...f, ...p }));

  const saveHours = () => {
    const n = Number(hours);
    if (!Number.isFinite(n) || n < 0.25 || n > 24) {
      setHoursMsg('Enter hours between 0.25 and 24.');
      return;
    }
    commit(setCasinoSettings(log, { sessionHours: n }, Date.now()));
    setHoursMsg(`Saved: ${n} h a visit.`);
  };

  const saveExits = () => {
    const f = minutesOk(find);
    const w = minutesOk(wait);
    if (f === null || w === null) {
      setExitMsg(`Enter minutes from 0 to ${EXIT_MINUTES_MAX}.`);
      return;
    }
    commit(setCasinoSettings(log, { exitFindMinutes: f, exitWaitMinutes: w }, Date.now()));
    setExitMsg(`Saved: ${f} min to find a table, ${w} min to wait for a shoe.`);
  };

  const saveMethod = () => {
    const m = normMethod({
      id: editing ?? makeCasinoId('m'),
      label: form.label,
      flat: form.bet === 'flat',
      entryTc: form.entryOn ? form.entry : null,
      exitTc: form.exitOn ? form.exit : null,
      rampStartTc: form.bet === 'start' ? form.start : null,
    });
    if (!m) {
      setError('The entry count has to be above the exit count.');
      return;
    }
    setError(null);
    const next = editing ? custom.map((x) => (x.id === editing ? m : x)) : [...custom, m];
    commit(setCasinoSettings(log, { methods: next }, Date.now()));
    const dup = duplicateOf(profile, next, m);
    // Review S4: a new name alone changes no figure (the name is not in the cache key).
    const was = editing ? custom.find((x) => x.id === editing) : undefined;
    const renamedOnly = was !== undefined && JSON.stringify({ ...was, label: undefined }) === JSON.stringify({ ...m, label: undefined });
    setMethodMsg(
      dup
        ? `Saved. It plays exactly like “${describeMethod(dup)}”, so it is worked out once, under that one.`
        : renamedOnly
          ? 'Saved. Only its name changed, so the figures stand.'
          : editing
            ? 'Saved. Games worked out with the old version update on their own.'
            : 'Added. Every game is worked out again with it, on its own.',
    );
    setEditing(null);
    setForm(BLANK_FORM);
  };

  const startEdit = (m: BetMethod) => {
    setEditing(m.id);
    setForm(formOf(m));
    setError(null);
    setMethodMsg(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm(BLANK_FORM);
    setError(null);
  };

  const remove = (id: string) => {
    if (editing === id) cancelEdit();
    commit(setCasinoSettings(log, { methods: custom.filter((m) => m.id !== id) }, Date.now()));
  };

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

      <section className="cas-section" aria-labelledby="cs-exit-title">
        <div className="cas-section-head">
          <h2 className="u-section-title" id="cs-exit-title">
            Leaving a table
          </h2>
        </div>
        <div className="cas-pad-x cas-stack">
          <p className="cas-note">
            Every wong-out, and every back-counter leaving at its exit count, costs this much table time before the next shoe. 0 makes leaving
            free.
          </p>
          <div className="cas-pair cas-cs-exits">
            <Field label="Find a new table, min" hint="Mid-shoe entry allowed or unknown.">
              <input className="cas-input" name="exitFindMinutes" inputMode="decimal" autoComplete="off" value={find} onChange={(e) => setFind(e.target.value)} />
            </Field>
            <Field label="Wait for a fresh shoe, min" hint="Mid-shoe entry barred.">
              <input className="cas-input" name="exitWaitMinutes" inputMode="decimal" autoComplete="off" value={wait} onChange={(e) => setWait(e.target.value)} />
            </Field>
          </div>
          <button type="button" className="u-btn cas-wide" onClick={saveExits} data-testid="save-exit-minutes">
            Save leaving times
          </button>
          {exitMsg && (
            <p className="cas-message" role="status">
              {exitMsg}
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
            {custom.map((m: BetMethod) => {
              const dup = duplicateOf(profile, custom, m);
              return (
                <li key={m.id} className="cas-cs-item cas-cs-custom" data-testid="custom-method" data-editing={editing === m.id ? 'true' : undefined}>
                  <span className="cas-cs-custom-text">
                    <span>{describeMethod(m)}</span>
                    {dup && (
                      <span className="cas-cs-dup" data-testid="custom-duplicate">
                        Same play as &ldquo;{describeMethod(dup)}&rdquo;: worked out once.
                      </span>
                    )}
                  </span>
                  <span className="cas-cs-actions">
                    <button type="button" className="cas-link" onClick={() => startEdit(m)} aria-label={`Edit ${describeMethod(m)}`}>
                      Edit
                    </button>
                    <button type="button" className="cas-link" onClick={() => remove(m.id)} aria-label={`Remove ${describeMethod(m)}`}>
                      Remove
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {methodMsg && (
            <p className="cas-message" role="status" data-testid="method-message">
              {methodMsg}
            </p>
          )}

          <h3 className="cas-group-title cas-cs-add-title">{editing ? 'Edit your method' : 'Add a method'}</h3>
          <FieldGroup label="Bet">
            <Choice
              label="Bet"
              value={form.bet}
              options={[
                { value: 'ramp', label: 'Profile ramp' },
                { value: 'start', label: 'Min, then ramp' },
                { value: 'flat', label: 'Flat min' },
              ]}
              onChange={(v) => patch({ bet: v })}
            />
          </FieldGroup>
          {form.bet === 'start' && (
            <Field label="Ramp starts at TC" hint="Min bet below it; your ramp's steps from there.">
              <select className="cas-input" name="rampStart" value={form.start} onChange={(e) => patch({ start: Number(e.target.value) })}>
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
                value={form.entryOn ? 'tc' : 'top'}
                options={[
                  { value: 'top', label: 'At shuffle' },
                  { value: 'tc', label: 'Back-count' },
                ]}
                onChange={(v) => patch({ entryOn: v === 'tc' })}
              />
            </FieldGroup>
            <FieldGroup label="Leave">
              <Choice
                label="Leave"
                value={form.exitOn ? 'tc' : 'never'}
                options={[
                  { value: 'never', label: 'Never' },
                  { value: 'tc', label: 'Wong out' },
                ]}
                onChange={(v) => patch({ exitOn: v === 'tc' })}
              />
            </FieldGroup>
          </div>
          {(form.entryOn || form.exitOn) && (
            <div className="cas-pair">
              {form.entryOn ? (
                <Field label="Enter at TC ≥">
                  <select className="cas-input" name="entryTc" value={form.entry} onChange={(e) => patch({ entry: Number(e.target.value) })}>
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
              {form.exitOn ? (
                <Field label="Leave at TC ≤">
                  <select className="cas-input" name="exitTc" value={form.exit} onChange={(e) => patch({ exit: Number(e.target.value) })}>
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
            <input
              className="cas-input"
              name="methodLabel"
              autoComplete="off"
              maxLength={40}
              value={form.label}
              onChange={(e) => patch({ label: e.target.value })}
            />
          </Field>
          {error && (
            <p className="cas-field-error" role="alert">
              {error}
            </p>
          )}
          {editing ? (
            <div className="cas-pair">
              <button type="button" className="u-btn" onClick={cancelEdit}>
                Cancel
              </button>
              <button type="button" className="u-btn u-btn-primary" onClick={saveMethod} data-testid="save-method">
                Save method
              </button>
            </div>
          ) : (
            <button type="button" className="u-btn u-btn-primary cas-wide" onClick={saveMethod} data-testid="add-method">
              Add method
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
