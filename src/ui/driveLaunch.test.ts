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

  it('the auto-start is handed over once', () => {
    setDriveAutoStart();
    expect(takeDriveAutoStart()).toBe(true);
    expect(takeDriveAutoStart()).toBe(false);
  });
});
