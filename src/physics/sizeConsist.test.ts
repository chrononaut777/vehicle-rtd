import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  newId,
  toRouteSimInput,
  updateActiveRoute,
} from '../domain/types';
import { sizeConsistFromThroughput } from './sizeConsist';

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
        beltMk: 5,
        itemsPerMin: 780,
      },
      {
        id: b,
        name: 'Sink',
        vehicleType: 'train',
        role: 'dropoff',
        x: 1000,
        y: 0,
        beltMk: 5,
        itemsPerMin: 780,
      },
    ];
    p = updateActiveRoute(p, {
      cargo: { stackSize: 100, autoSizeConsist: true },
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
      cargo: { stackSize: 100, autoSizeConsist: true },
      route: [{ kind: 'station', stationId: 'a' }],
    });
    // 2400/min × 600s / 60 = 24000 → ceil(24000/3200)=8 cars → 3 locos
    const sizing = sizeConsistFromThroughput(toRouteSimInput(p), 600);
    expect(sizing!.freightCars).toBe(8);
    expect(sizing!.locomotives).toBe(3);
  });
});
