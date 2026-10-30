import { useState } from 'react';
import { exportAll } from '../../store/persist';
import { answersOnPhone, backupIsDue, lastBackupAt, noteBackupHandedOver } from '../../store/backupStatus';
import { backupFileName, saveTextFile, type SaveResult } from '../../platform/saveFile';
import { lastBackupText } from '../screens/backupText';
import './backupNudge.css';

/**
 * B7: the training data's backup reminder, the casino log's 30-day nudge
 * generalised. Shown on Home once there is something worth keeping and no
 * backup in 30 days; gone as soon as a file is actually handed over (R9: a
 * download rests it for a week rather than counting as the backup).
 */
export function BackupNudge({ now = Date.now() }: { now?: number }) {
  const [due, setDue] = useState(() => backupIsDue(now, answersOnPhone()));
  const [said, setSaid] = useState<SaveResult | null>(null);
  if (!due) return null;
  const run = () => {
    const at = new Date();
    void saveTextFile(exportAll(), backupFileName(at)).then((r) => {
      if (r === 'shared' || r === 'downloaded') {
        noteBackupHandedOver(r, at);
        setDue(false);
      } else setSaid(r);
    });
  };
  return (
    <section className="backup-nudge" aria-label="Back up" data-testid="backup-nudge">
      <p className="backup-nudge-text">
        <strong>Back up</strong> &middot; {lastBackupText(lastBackupAt(), now)}
        {said && <span className="backup-nudge-said"> &middot; not saved, try again</span>}
      </p>
      <button type="button" className="u-btn backup-nudge-btn" onClick={run}>
        Export now
      </button>
    </section>
  );
}
