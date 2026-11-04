import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  newId,
  toRouteSimInput,
  updateActiveRoute,
  type Station,
} from '../domain/types';
import {
  allocateStationCars,
  peersForFlow,
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

function pickup(
  id: string,
  name: string,
  itemsPerMin: number,
): Station {
  return {
    id,
    name,
    vehicleType: 'train',
    role: 'pickup',
    x: 0,
    y: 0,
    itemsPerMin,
  };
}

describe('allocateStationCars', () => {
  it('gives exclusive full cars then packs partials into one shared car', () => {
    // 1440×3 + 1080 = 5400 on 16 cars
    // shares: 4.266, 4.266, 4.266, 3.2 → floors 4+4+4+3=15, partials → 1 shared
    const peers = [
      pickup('a', 'Alpha', 1440),
      pickup('b', 'Bravo', 1440),
      pickup('c', 'Charlie', 1440),
      pickup('d', 'Delta', 1080),
    ];
    const alloc = allocateStationCars(peers, 16);
    expect(alloc.get('a')).toMatchObject({
      exclusiveCars: 4,
      exclusiveRange: { from: 1, to: 4 },
      sharedCars: [16],
      loadingPlatforms: 5,
    });
    expect(alloc.get('a')!.partialFraction).toBeCloseTo(0.2666, 2);
    expect(alloc.get('a')!.sharedWith).toEqual(
      expect.arrayContaining(['Bravo', 'Charlie', 'Delta']),
    );
    expect(alloc.get('d')).toMatchObject({
      exclusiveCars: 3,
      exclusiveRange: { from: 13, to: 15 },
      sharedCars: [16],
      loadingPlatforms: 4,
    });
  });

  it('keeps a solo station on the full dock with no sharing', () => {
    const alloc = allocateStationCars([pickup('a', 'Only', 5400)], 16);
    expect(alloc.get('a')).toMatchObject({
      exclusiveCars: 16,
      exclusiveRange: { from: 1, to: 16 },
      sharedCars: [],
      loadingPlatforms: 16,
      partialFraction: 0,
    });
  });
});

describe('peersForFlow', () => {
  it('orders pickups starting just after the dropoff', () => {
    const a = pickup('a', 'Alpha', 1440);
    const b = pickup('b', 'Bravo', 1440);
    const drop: Station = {
      id: 'd',
      name: 'Drop',
      vehicleType: 'train',
      role: 'dropoff',
      x: 0,
      y: 0,
      itemsPerMin: 2880,
    };
    // Route listed Alpha before drop, but after-drop order is Bravo then Alpha
    const stations = [a, b, drop];
    const route = [
      { kind: 'station' as const, stationId: 'a' },
      { kind: 'station' as const, stationId: 'd' },
      { kind: 'station' as const, stationId: 'b' },
    ];
    const peers = peersForFlow(a, stations, route);
    expect(peers.map((s) => s.id)).toEqual(['b', 'a']);
  });
});

describe('platformsForStation', () => {
  it('assigns lower car numbers to the first station after drop', () => {
    const a = pickup('a', 'Alpha', 1440);
    const b = pickup('b', 'Bravo', 3960);
    const drop: Station = {
      id: 'd',
      name: 'Drop',
      vehicleType: 'train',
      role: 'dropoff',
      x: 0,
      y: 0,
      itemsPerMin: 5400,
    };
    const stations = [a, b, drop];
    // Alpha appears first in the array, but Bravo is first after drop
    const route = [
      { kind: 'station' as const, stationId: 'a' },
      { kind: 'station' as const, stationId: 'd' },
      { kind: 'station' as const, stationId: 'b' },
    ];
    const bravo = platformsForStation(b, 16, 5, stations, route);
    const alpha = platformsForStation(a, 16, 5, stations, route);
    // Bravo 3960/5400*16 = 11.733 → cars 1–11 exclusive
    expect(bravo!.exclusiveRange).toEqual({ from: 1, to: 11 });
    // Alpha 1440/5400*16 = 4.266 → cars 12–15 exclusive
    expect(alpha!.exclusiveRange).toEqual({ from: 12, to: 15 });
    expect(bravo!.sharedCars).toEqual(alpha!.sharedCars);
  });

  it('returns null for passthrough, drones, or missing sizing', () => {
    const base = pickup('s', 'S', 100);
    expect(
      platformsForStation({ ...base, role: 'passthrough' }, 16),
    ).toBeNull();
    expect(
      platformsForStation({ ...base, vehicleType: 'drone' }, 16),
    ).toBeNull();
    expect(platformsForStation(base, null)).toBeNull();
  });
});
