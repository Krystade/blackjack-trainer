import { useState } from 'react';
import { getActiveProfile } from '../../store/profiles';
import { resumeBankroll, storeBankrollNow } from '../playBankroll';

/**
 * #42: the carried Play bankroll for the active profile, and the way back to
 * its starting stake. Reads storage when shown, because the table writes the
 * bankroll there and nowhere else (see playBankroll.ts).
 */
export function ResetBankrollRow() {
  const [profile] = useState(() => getActiveProfile());
  const [bankroll, setBankroll] = useState(() => resumeBankroll(profile));
  const carried = bankroll !== profile.bankrollStart;

  const reset = () => {
    storeBankrollNow(profile.id, undefined);
    setBankroll(resumeBankroll(profile));
  };

  return (
    <>
      <div className="settings-row">
        <span className="settings-label">Bankroll</span>
        <span className="settings-value" data-testid="play-bankroll">
          {bankroll}
          {carried ? ` (starts at ${profile.bankrollStart})` : ''}
        </span>
      </div>
      <div className="settings-row">
        <button type="button" className="settings-mini-btn" disabled={!carried} onClick={reset}>
          Reset bankroll
        </button>
      </div>
      <p className="settings-note">
        Play carries your bankroll from session to session on {profile.name}. Reset puts it back
        to the starting bankroll.
      </p>
    </>
  );
}
