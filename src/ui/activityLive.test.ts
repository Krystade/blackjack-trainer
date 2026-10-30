import { describe, it, expect, afterEach } from 'vitest';
import { holdActivity, activityIsLive, updateMustWait, resetActivityForTest } from './activityLive';
import { setLeaveGuard } from './leaveGuard';

afterEach(() => resetActivityForTest());

describe('the shared "activity live" flag', () => {
  it('is idle with nothing held', () => {
    expect(activityIsLive()).toBe(false);
  });

  it('is live while any holder holds it, and idle once every holder lets go', () => {
    const releaseTable = holdActivity('table');
    const releaseDrill = holdActivity('drill:flash');
    expect(activityIsLive()).toBe(true);
    releaseTable();
    expect(activityIsLive(), 'the drill still holds it').toBe(true);
    releaseDrill();
    expect(activityIsLive()).toBe(false);
  });

  it('counts two holds under the same key separately (StrictMode mounts twice)', () => {
    const a = holdActivity('drills');
    const b = holdActivity('drills');
    a();
    expect(activityIsLive()).toBe(true);
    b();
    expect(activityIsLive()).toBe(false);
  });

  it('ignores a release called twice', () => {
    const a = holdActivity('table');
    const b = holdActivity('table');
    a();
    a();
    expect(activityIsLive(), 'a double release must not free the other holder').toBe(true);
    b();
  });
});

describe('updateMustWait', () => {
  it('waits for a live field-test run even when nothing else is live', () => {
    expect(updateMustWait(() => true)).toBe(true);
  });

  it('waits while the table or a drill is live', () => {
    const release = holdActivity('table');
    expect(updateMustWait(() => false)).toBe(true);
    release();
    expect(updateMustWait(() => false)).toBe(false);
  });
});

describe('unsaved work holds an update reload (B14)', () => {
  it('waits while a leave guard is installed, and not after it is removed', () => {
    resetActivityForTest();
    expect(updateMustWait(() => false)).toBe(false);
    const remove = setLeaveGuard(() => true);
    expect(updateMustWait(() => false)).toBe(true);
    remove();
    expect(updateMustWait(() => false)).toBe(false);
  });
});
