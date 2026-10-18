import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../store/types';
import { driveTarget, recordDrive, setDriveAutoStart, takeDriveAutoStart } from './driveLaunch';

describe('Home Drive button (C-R3)', () => {
  it('no history, no Drive', () => {
    expect(driveTarget(DEFAULT_SETTINGS)).toBeNull();
  });

  it('names the last eyes-free or voice drill', () => {
    const s = { ...DEFAULT_SETTINGS, lastDrive: { mode: 'truecount', voice: true } };
    expect(driveTarget(s)).toEqual({ mode: 'truecount', voice: true, label: 'True count drill' });
  });

  it('ignores a stored mode it cannot drive (old or hand-edited data)', () => {
    expect(driveTarget({ ...DEFAULT_SETTINGS, lastDrive: { mode: 'mastery', voice: false } })).toBeNull();
    expect(
      driveTarget({ ...DEFAULT_SETTINGS, lastDrive: 'flash' as unknown as { mode: string; voice: boolean } }),
    ).toBeNull();
  });

  it('records a drivable drill, and returns the same object when nothing changed', () => {
    const once = recordDrive(DEFAULT_SETTINGS, 'flash', false);
    expect(once.lastDrive).toEqual({ mode: 'flash', voice: false });
    expect(recordDrive(once, 'flash', false)).toBe(once);
    expect(recordDrive(once, 'flash', true).lastDrive).toEqual({ mode: 'flash', voice: true });
    // A drill with no eyes-free mode is not recorded.
    expect(recordDrive(once, 'mastery', false)).toBe(once);
  });

  it('H3: Speed and Bet sizing run eyes-free are Drive drills, named as the picker names them', () => {
    const speed = recordDrive(DEFAULT_SETTINGS, 'speed', false);
    expect(speed.lastDrive).toEqual({ mode: 'speed', voice: false });
    expect(driveTarget(speed)).toEqual({ mode: 'speed', voice: false, label: 'Speed' });
    const bet = recordDrive(DEFAULT_SETTINGS, 'betsizing', false);
    expect(bet.lastDrive).toEqual({ mode: 'betsizing', voice: false });
    expect(driveTarget(bet)).toEqual({ mode: 'betsizing', voice: false, label: 'Bet sizing' });
  });

  it('H3: they have no microphone, so voice alone does not record them and Drive leaves it off', () => {
    // Voice on but eyes-free off: nothing to drive.
    expect(recordDrive(DEFAULT_SETTINGS, 'speed', true, false)).toBe(DEFAULT_SETTINGS);
    expect(recordDrive(DEFAULT_SETTINGS, 'betsizing', true, false)).toBe(DEFAULT_SETTINGS);
    // Eyes-free with the microphone left on elsewhere: recorded voice-off.
    expect(recordDrive(DEFAULT_SETTINGS, 'speed', true, true).lastDrive).toEqual({ mode: 'speed', voice: false });
    // A drill that has a microphone keeps the voice-only route.
    expect(recordDrive(DEFAULT_SETTINGS, 'flash', true, false).lastDrive).toEqual({ mode: 'flash', voice: true });
  });

  it('the auto-start is handed over once', () => {
    setDriveAutoStart();
    expect(takeDriveAutoStart()).toBe(true);
    expect(takeDriveAutoStart()).toBe(false);
  });
});
