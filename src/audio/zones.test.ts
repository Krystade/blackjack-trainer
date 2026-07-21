import { describe, it, expect } from 'vitest';
import { hitTestZone } from './zones';

const W = 400, H = 800;

describe('hitTestZone — action mode quadrants', () => {
  it('maps each corner to its fixed action', () => {
    expect(hitTestZone(10, 10, W, H)).toBe('hit');          // top-left
    expect(hitTestZone(390, 10, W, H)).toBe('stand');       // top-right
    expect(hitTestZone(10, 790, W, H)).toBe('double');      // bottom-left
    expect(hitTestZone(390, 790, W, H)).toBe('split');      // bottom-right
  });
  it('maps the exact center to surrender', () => {
    expect(hitTestZone(200, 400, W, H)).toBe('surrender');
  });
  it('gives the center circle priority over the quadrant it sits in', () => {
    // radius = 0.22 * min(400,800) = 88; a point 80px above center is inside it
    expect(hitTestZone(200, 320, W, H)).toBe('surrender');
    // 100px above center is outside the circle -> quadrant rules apply
    expect(hitTestZone(199, 300, W, H)).toBe('hit');
  });
  it('is stable at the quadrant boundaries (no gap, no overlap)', () => {
    expect(hitTestZone(0, 0, W, H)).toBe('hit');
    expect(hitTestZone(W, H, W, H)).toBe('split');
  });
});

describe('hitTestZone — insurance mode halves', () => {
  it('splits left/right with no center circle', () => {
    expect(hitTestZone(10, 400, W, H, 'insurance')).toBe('take');
    expect(hitTestZone(390, 400, W, H, 'insurance')).toBe('decline');
    expect(hitTestZone(200, 400, W, H, 'insurance')).toBe('decline'); // center is not special here
  });
});
