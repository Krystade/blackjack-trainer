import { describe, expect, it } from 'vitest';
import { setDrillLaunch, takeDrillLaunch } from './drillLaunch';

describe('drillLaunch (#28)', () => {
  it('hands one launch across, once', () => {
    expect(takeDrillLaunch()).toBeNull();
    setDrillLaunch('count');
    expect(takeDrillLaunch()).toBe('count');
    expect(takeDrillLaunch()).toBeNull();
  });
});
