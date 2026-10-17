import { expect, it } from 'vitest';
import { setProfileLaunch, takeProfileLaunch } from './profileLaunch';
it('is handed across one navigation and cleared as read', () => {
  expect(takeProfileLaunch()).toBeNull();
  setProfileLaunch({ section: 'ramp', returnTo: 'table' });
  expect(takeProfileLaunch()).toEqual({ section: 'ramp', returnTo: 'table' });
  expect(takeProfileLaunch()).toBeNull();
});
