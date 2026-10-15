import { describe, it, expect } from 'vitest';
import { flashOptionsFor } from './flashOptions';
import type { Settings } from '../store/types';

const drill = (extra: Partial<Settings['drill']>) => extra as Settings['drill'];

describe('flashOptionsFor', () => {
  it('reads the toggles; absent = off', () => {
    expect(flashOptionsFor(drill({}), false)).toEqual({ fallbacks: false, withCount: false });
    expect(flashOptionsFor(drill({ fallbacks: true, withCount: true }), false)).toEqual({ fallbacks: true, withCount: true });
  });
  it('eyes-free deals as before, whatever the toggles say', () => {
    expect(flashOptionsFor(drill({ fallbacks: true, withCount: true }), true)).toEqual({ fallbacks: false, withCount: false });
  });
});
