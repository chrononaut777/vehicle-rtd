import {
  stationsOnRoute,
  type RouteSimInput,
  type TrainConsist,
} from '../domain/types';
import {
  CARS_PER_LOCOMOTIVE,
  carCapacityItems,
  platformBeltCeiling,
  type BeltMk,
} from './belts';

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
  const warnings: string[] = [];
  for (const s of pool) {
    if (s.role === 'passthrough') continue;
    if (s.itemsPerMin == null || s.itemsPerMin <= 0) continue;
    const mk = (s.beltMk ?? 5) as BeltMk;
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
