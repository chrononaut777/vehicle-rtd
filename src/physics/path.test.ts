import { describe, expect, it } from 'vitest';
import { MIN_BLUE_CURVE_RADIUS_M } from './constants';
import { densifyPath, type ResolvedPoint } from './path';

function pt(x: number, y: number, z = 0): ResolvedPoint {
  return { x, y, z };
}

describe('densifyPath curve radius', () => {
  it('clamps polyline kinks to blue-track minimum radius', () => {
    // Right-angle corner: raw circumradius of adjacent samples is far below 17 m.
    const samples = densifyPath([pt(0, 0), pt(100, 0), pt(100, 100)], 8);
    const finite = samples
      .map((s) => s.curveRadiusM)
      .filter((r) => Number.isFinite(r));
    expect(finite.length).toBeGreaterThan(0);
    expect(Math.min(...finite)).toBe(MIN_BLUE_CURVE_RADIUS_M);
  });

  it('preserves gentler curves larger than the blue minimum', () => {
    // Shallow kink: circumradius well above the blue-track floor.
    const samples = densifyPath([pt(0, 0), pt(100, 0), pt(200, 20)], 8);
    const finite = samples
      .map((s) => s.curveRadiusM)
      .filter((r) => Number.isFinite(r) && r < 1e5);
    expect(finite.length).toBeGreaterThan(0);
    expect(Math.min(...finite)).toBeGreaterThan(MIN_BLUE_CURVE_RADIUS_M * 2);
  });

  it('keeps straight segments as infinite radius', () => {
    const samples = densifyPath([pt(0, 0), pt(200, 0)], 8);
    expect(samples.every((s) => s.curveRadiusM === Infinity)).toBe(true);
  });
});
