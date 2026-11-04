import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  newId,
  toRouteSimInput,
  updateActiveRoute,
} from '../domain/types';
import {
  platformsForStation,
  sizeConsistFromThroughput,
} from './sizeConsist';

describe('sizeConsistFromThroughput', () => {
  it('sizes cars/engines/fill for a known RT and ore stacks', () => {
    let p = createEmptyProject();
    const a = newId('st');
    const b = newId('st');
    p.stations = [
      {
        id: a,
        name: 'Mine',
        vehicleType: 'train',
        role: 'pickup',
        x: 0,
        y: 0,
        itemsPerMin: 780,
      },
      {
        id: b,
        name: 'Sink',
        vehicleType: 'train',
        role: 'dropoff',
        x: 1000,
        y: 0,
        itemsPerMin: 780,
      },
    ];
    p = updateActiveRoute(p, {
      cargo: { stackSize: 100, autoSizeConsist: true, beltMk: 5 },
      route: [
        { kind: 'station', stationId: a },
        { kind: 'station', stationId: b },
      ],
    });
    // 780/min × 300s / 60 = 3900 items/trip → ceil(3900/3200)=2 cars
    const sizing = sizeConsistFromThroughput(toRouteSimInput(p), 300);
    expect(sizing).not.toBeNull();
    expect(sizing!.freightCars).toBe(2);
    expect(sizing!.locomotives).toBe(1); // ceil(2/3)
    expect(sizing!.platforms).toBe(2);
    expect(sizing!.fillFraction).toBeCloseTo(3900 / 6400, 3);
  });

  it('uses 1:3 engine ratio for longer consists', () => {
    let p = createEmptyProject();
    p.stations = [
      {
        id: 'a',
        name: 'A',
        vehicleType: 'train',
        role: 'pickup',
        x: 0,
        y: 0,
        itemsPerMin: 2400,
      },
    ];
    p = updateActiveRoute(p, {
      cargo: { stackSize: 100, autoSizeConsist: true, beltMk: 5 },
      route: [{ kind: 'station', stationId: 'a' }],
    });
    // 2400/min × 600s / 60 = 24000 → ceil(24000/3200)=8 cars → 3 locos
    const sizing = sizeConsistFromThroughput(toRouteSimInput(p), 600);
    expect(sizing!.freightCars).toBe(8);
    expect(sizing!.locomotives).toBe(3);
  });
});

describe('platformsForStation', () => {
  const base = {
    id: 's',
    name: 'S',
    vehicleType: 'train' as const,
    role: 'pickup' as const,
    x: 0,
    y: 0,
  };

  it('uses dock length for a low-rate station', () => {
    // Mk.5 dual ports = 1560/min → 200/min needs 1 belt platform; dock 16 wins
    const result = platformsForStation(
      { ...base, itemsPerMin: 200 },
      16,
      5,
    );
    expect(result).toEqual({
      platforms: 16,
      dockPlatforms: 16,
      beltPlatforms: 1,
      beltBound: false,
    });
  });

  it('raises platforms when belts alone need more than the dock', () => {
    // 5000/min ÷ 1560 ≈ 3.2 → 4 belt platforms vs dock 2
    const result = platformsForStation(
      { ...base, itemsPerMin: 5000 },
      2,
      5,
    );
    expect(result).toEqual({
      platforms: 4,
      dockPlatforms: 2,
      beltPlatforms: 4,
      beltBound: true,
    });
  });

  it('falls back to dock length when items/min is unset', () => {
    const result = platformsForStation({ ...base }, 8);
    expect(result).toEqual({
      platforms: 8,
      dockPlatforms: 8,
      beltPlatforms: 0,
      beltBound: false,
    });
  });

  it('returns null for passthrough, drones, or missing sizing', () => {
    expect(
      platformsForStation({ ...base, role: 'passthrough' }, 16),
    ).toBeNull();
    expect(
      platformsForStation({ ...base, vehicleType: 'drone' }, 16),
    ).toBeNull();
    expect(platformsForStation(base, null)).toBeNull();
  });
});
