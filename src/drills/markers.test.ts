import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../store/types';
import type { MarkerColour } from '../store/types';
import { markerOf, withMarker } from './markers';

describe('#31 markers', () => {
  it('sets, recolours and clears one cell, leaving the others', () => {
    const a = withMarker(DEFAULT_SETTINGS, 'hard-16-v-10', 'red');
    const b = withMarker(a, 'pair-8-v-A', 'blue');
    const c = withMarker(b, 'hard-16-v-10', 'green');
    expect(c.drill.markers).toEqual({ 'hard-16-v-10': 'green', 'pair-8-v-A': 'blue' });
    const d = withMarker(c, 'hard-16-v-10', null);
    expect(d.drill.markers).toEqual({ 'pair-8-v-A': 'blue' });
    expect(markerOf(d.drill, 'hard-16-v-10')).toBeUndefined();
    expect(markerOf(d.drill, 'pair-8-v-A')).toBe('blue');
  });

  it('never mutates the settings it was given', () => {
    const a = withMarker(DEFAULT_SETTINGS, 'hard-16-v-10', 'red');
    withMarker(a, 'hard-16-v-10', null);
    expect(a.drill.markers).toEqual({ 'hard-16-v-10': 'red' });
    expect(DEFAULT_SETTINGS.drill.markers).toBeUndefined();
  });

  it('ignores an unknown colour from an old or hand-edited blob', () => {
    const drill = { markers: { 'hard-16-v-10': 'purple' as MarkerColour } };
    expect(markerOf(drill, 'hard-16-v-10')).toBeUndefined();
  });
});
