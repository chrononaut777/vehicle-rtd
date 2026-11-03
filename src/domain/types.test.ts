import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  getActiveRoute,
  normalizeProject,
  toRouteSimInput,
} from './types';

describe('normalizeProject multi-route migration', () => {
  it('creates a v2 project with one active route by default', () => {
    const p = createEmptyProject('Demo');
    expect(p.version).toBe(2);
    expect(p.routes).toHaveLength(1);
    expect(p.activeRouteId).toBe(p.routes[0].id);
    expect(getActiveRoute(p).vehicleType).toBe('train');
  });

  it('migrates legacy v1 single-route projects without data loss', () => {
    const legacy = {
      version: 1,
      name: 'Old line',
      vehicleType: 'drone',
      stations: [
        {
          id: 'st_a',
          name: 'Port A',
          vehicleType: 'drone',
          role: 'pickup',
          x: 10,
          y: 20,
        },
        {
          id: 'st_b',
          name: 'Port B',
          vehicleType: 'drone',
          role: 'dropoff',
          x: 100,
          y: 20,
        },
      ],
      waypoints: [{ id: 'wp_1', x: 50, y: 40 }],
      route: [
        { kind: 'station', stationId: 'st_a' },
        { kind: 'waypoint', waypointId: 'wp_1' },
        { kind: 'station', stationId: 'st_b' },
      ],
      consist: { locomotives: 2, freightCars: 6, fillFraction: 0.8 },
      flags: { flatTrack: false, cruiseHeight: 80, closedLoop: false },
      cargo: { stackSize: 200, autoSizeConsist: false },
    };

    const p = normalizeProject(legacy);
    expect(p.version).toBe(2);
    expect(p.name).toBe('Old line');
    expect(p.stations).toHaveLength(2);
    expect(p.routes).toHaveLength(1);

    const route = getActiveRoute(p);
    expect(route.vehicleType).toBe('drone');
    expect(route.waypoints).toEqual(legacy.waypoints);
    expect(route.route).toEqual(legacy.route);
    expect(route.consist.locomotives).toBe(2);
    expect(route.flags.cruiseHeight).toBe(80);
    expect(route.cargo.stackSize).toBe(200);
    expect(p.activeRouteId).toBe(route.id);

    const sim = toRouteSimInput(p);
    expect(sim.route).toHaveLength(3);
    expect(sim.vehicleType).toBe('drone');
  });

  it('keeps multi-route v2 projects intact', () => {
    const raw = {
      version: 2,
      name: 'Network',
      stations: [],
      activeRouteId: 'rt_b',
      routes: [
        {
          id: 'rt_a',
          name: 'Train A',
          vehicleType: 'train',
          waypoints: [],
          route: [],
          consist: { locomotives: 1, freightCars: 2, fillFraction: 1 },
          flags: { flatTrack: true, cruiseHeight: 50, closedLoop: true },
          cargo: { stackSize: 100, autoSizeConsist: true },
        },
        {
          id: 'rt_b',
          name: 'Drone B',
          vehicleType: 'drone',
          waypoints: [],
          route: [],
          consist: { locomotives: 1, freightCars: 0, fillFraction: 1 },
          flags: { flatTrack: true, cruiseHeight: 50, closedLoop: true },
          cargo: { stackSize: 500, autoSizeConsist: true },
        },
      ],
    };
    const p = normalizeProject(raw);
    expect(p.routes).toHaveLength(2);
    expect(p.activeRouteId).toBe('rt_b');
    expect(getActiveRoute(p).name).toBe('Drone B');
    expect(getActiveRoute(p).cargo.stackSize).toBe(500);
  });
});
