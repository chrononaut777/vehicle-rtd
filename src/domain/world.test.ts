import { describe, expect, it } from 'vitest';
import { gameToLatLng, latLngToGame, SCIM } from './world';

describe('SCIM projection', () => {
  it('round-trips origin meters', () => {
    const [lat, lng] = gameToLatLng(0, 0);
    const back = latLngToGame(lat, lng);
    expect(back.x).toBeCloseTo(0, 1);
    expect(back.y).toBeCloseTo(0, 1);
  });

  it('round-trips a known inland point', () => {
    const [lat, lng] = gameToLatLng(1833.5, -1200);
    const back = latLngToGame(lat, lng);
    expect(back.x).toBeCloseTo(1833.5, 1);
    expect(back.y).toBeCloseTo(-1200, 1);
  });

  it('uses SCIM zoom ratio 8', () => {
    expect(SCIM.zoomRatio).toBe(8);
    expect(SCIM.backgroundSize).toBe(40960);
  });
});
