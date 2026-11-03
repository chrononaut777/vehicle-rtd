import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  getActiveRoute,
  newId,
  toRouteSimInput,
  updateActiveRoute,
  type Project,
  type VehicleType,
} from '../domain/types';
import { DRONE } from './constants';
import { simulateDrone } from './simulateDrone';
import { formatDuration, simulateTrip } from './simulateTrip';

function projectWithTwoStations(
  distM: number,
  vehicleType: VehicleType = 'train',
): Project {
  let p = createEmptyProject('test');
  p = updateActiveRoute(p, { vehicleType });
  const a = newId('st');
  const b = newId('st');
  p.stations = [
    {
      id: a,
      name: 'A',
      vehicleType,
      role: 'pickup',
      x: 0,
      y: 0,
      z: 50,
    },
    {
      id: b,
      name: 'B',
      vehicleType,
      role: 'dropoff',
      x: distM,
      y: 0,
      z: 50,
    },
  ];
  p = updateActiveRoute(p, {
    route: [
      { kind: 'station', stationId: a },
      { kind: 'station', stationId: b },
    ],
    flags: {
      ...getActiveRoute(p).flags,
      flatTrack: true,
      closedLoop: true,
      cruiseHeight: 50,
    },
  });
  return p;
}

function sim(project: Project) {
  return toRouteSimInput(project);
}

describe('simulateTrip', () => {
  it('returns not-ok without enough stations', () => {
    const r = simulateTrip(sim(createEmptyProject()));
    expect(r.ok).toBe(false);
  });

  it('estimates positive RT time on a flat closed loop', () => {
    const r = simulateTrip(sim(projectWithTwoStations(2000)));
    expect(r.ok).toBe(true);
    expect(r.totalDistanceM).toBeGreaterThan(3900);
    expect(r.totalTravelSeconds).toBeGreaterThan(60);
    expect(r.totalDwellSeconds).toBeGreaterThan(20);
    expect(r.totalRoundTripSeconds).toBe(
      r.totalTravelSeconds + r.totalDwellSeconds,
    );
  });

  it('longer routes take more travel time', () => {
    const short = simulateTrip(sim(projectWithTwoStations(1000)));
    const long = simulateTrip(sim(projectWithTwoStations(4000)));
    expect(long.totalTravelSeconds).toBeGreaterThan(short.totalTravelSeconds);
  });

  it('passthrough stations can skip default dwell', () => {
    let p = projectWithTwoStations(1500);
    p.stations[1].role = 'passthrough';
    p = updateActiveRoute(p, {
      flags: { ...getActiveRoute(p).flags, closedLoop: false },
    });
    const r = simulateTrip(sim(p));
    expect(r.ok).toBe(true);
    // open route: start dwell (pickup default) + dest passthrough 0
    expect(r.legs.some((l) => l.dwellSeconds === 0)).toBe(true);
  });
});

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(65)).toBe('1m 5s');
    expect(formatDuration(3661)).toBe('1h 1m 1s');
  });
});

describe('simulateDrone', () => {
  it('returns not-ok without enough ports', () => {
    let p = createEmptyProject();
    p = updateActiveRoute(p, { vehicleType: 'drone' });
    expect(simulateDrone(sim(p)).ok).toBe(false);
  });

  it('uses constant cruise on horizontal distance', () => {
    const dist = 2500;
    const r = simulateDrone(sim(projectWithTwoStations(dist, 'drone')));
    expect(r.ok).toBe(true);
    // Closed loop: out + back
    expect(r.totalDistanceM).toBeCloseTo(dist * 2, 0);
    expect(r.totalTravelSeconds).toBeCloseTo((dist * 2) / DRONE.cruiseSpeedMps, 1);
    expect(r.avgSpeedKmh).toBeCloseTo(DRONE.cruiseSpeedMps * 3.6, 1);
  });
});
