import {
  stationsOnRoute,
  type RouteSimInput,
  type Station,
  type TrainConsist,
} from '../domain/types';
import {
  CARS_PER_LOCOMOTIVE,
  carCapacityItems,
  platformBeltCeiling,
  type BeltMk,
} from './belts';

export interface StationPlatforms {
  /** Platforms to plan at this station (max of dock length and belt need). */
  platforms: number;
  /** Freight-car dock length from route consist sizing. */
  dockPlatforms: number;
  /** Platforms implied by this station's items/min ÷ dual-port belt ceiling. */
  beltPlatforms: number;
  /** True when belts alone need more platforms than the train dock. */
  beltBound: boolean;
}

export interface ConsistSizing {
  freightCars: number;
  locomotives: number;
  /** Freight platforms needed at each cargo station (= cars). */
  platforms: number;
  fillFraction: number;
  itemsPerTrip: number;
  carCapacity: number;
  /** Governing station throughput used (items/min). */
  targetItemsPerMin: number;
  /** True when target exceeds dual-belt ceiling × cars for station belt mk. */
  warnings: string[];
}

/** Throughput target from stations linked on this route (falls back to all). */
export function resolveTargetItemsPerMin(input: RouteSimInput): number {
  const linked = stationsOnRoute(input.stations, input.route);
  const pool = linked.length > 0 ? linked : input.stations;
  let max = 0;
  for (const s of pool) {
    if (s.role === 'passthrough') continue;
    if (s.itemsPerMin != null && s.itemsPerMin > max) max = s.itemsPerMin;
  }
  return max;
}

/**
 * Wiki: n_cars = ceil(T_desired × t_round_trip / V_cargo)
 * with T in items/s → itemsPerMin/60.
 * Fill % = needed / (cars × capacity) after rounding cars up.
 * Engines = ceil(cars / 3) (1:3 ratio).
 */
export function sizeConsistFromThroughput(
  input: RouteSimInput,
  roundTripSeconds: number,
): ConsistSizing | null {
  const targetItemsPerMin = resolveTargetItemsPerMin(input);
  if (targetItemsPerMin <= 0 || !(roundTripSeconds > 0)) return null;

  const stackSize = input.cargo?.stackSize ?? 100;
  const carCapacity = carCapacityItems(stackSize);
  const itemsPerTrip = (targetItemsPerMin * roundTripSeconds) / 60;

  const freightCars = Math.max(1, Math.ceil(itemsPerTrip / carCapacity));
  const locomotives = Math.max(1, Math.ceil(freightCars / CARS_PER_LOCOMOTIVE));
  const platforms = freightCars;
  const fillFraction = Math.min(1, itemsPerTrip / (freightCars * carCapacity));

  const linked = stationsOnRoute(input.stations, input.route);
  const pool = linked.length > 0 ? linked : input.stations;
  const mk = (input.cargo.beltMk ?? 5) as BeltMk;
  const warnings: string[] = [];
  for (const s of pool) {
    if (s.role === 'passthrough') continue;
    if (s.itemsPerMin == null || s.itemsPerMin <= 0) continue;
    const ceiling = platformBeltCeiling(mk) * freightCars;
    if (s.itemsPerMin > ceiling + 1e-6) {
      warnings.push(
        `${s.name}: ${s.itemsPerMin}/min exceeds ~${Math.round(ceiling)}/min with ${freightCars}× dual Mk.${mk} platform ports.`,
      );
    }
  }

  return {
    freightCars,
    locomotives,
    platforms,
    fillFraction,
    itemsPerTrip,
    carCapacity,
    targetItemsPerMin,
    warnings,
  };
}

export function applySizingToConsist(sizing: ConsistSizing): TrainConsist {
  return {
    locomotives: sizing.locomotives,
    freightCars: sizing.freightCars,
    fillFraction: sizing.fillFraction,
  };
}

export function consistChanged(a: TrainConsist, b: TrainConsist): boolean {
  return (
    a.locomotives !== b.locomotives ||
    a.freightCars !== b.freightCars ||
    Math.abs(a.fillFraction - b.fillFraction) > 0.001
  );
}

/**
 * Platforms to show on a station popup for a train cargo stop.
 * Dock length (= route freight cars) when the full consist stops here,
 * raised if this station's belts alone need more platforms.
 * Returns null for drones, passthrough, or when route sizing is unavailable.
 */
export function platformsForStation(
  station: Station,
  routePlatforms: number | null | undefined,
  beltMk: BeltMk = 5,
): StationPlatforms | null {
  if (station.vehicleType === 'drone' || station.role === 'passthrough') {
    return null;
  }
  if (routePlatforms == null || !(routePlatforms > 0)) return null;

  const dockPlatforms = Math.max(1, Math.ceil(routePlatforms));
  const mk = beltMk;
  const ceiling = platformBeltCeiling(mk);
  const rate = station.itemsPerMin;
  const beltPlatforms =
    rate != null && rate > 0 && ceiling > 0
      ? Math.max(1, Math.ceil(rate / ceiling))
      : 0;
  const platforms = Math.max(dockPlatforms, beltPlatforms);
  return {
    platforms,
    dockPlatforms,
    beltPlatforms,
    beltBound: beltPlatforms > dockPlatforms,
  };
}
