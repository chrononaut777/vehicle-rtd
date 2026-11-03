import { DRONE_CARGO_STACKS, type RouteSimInput } from '../domain/types';
import { resolveTargetItemsPerMin } from './sizeConsist';

export interface DroneSizing {
  /** Drones needed to hit target throughput at this RT time. */
  drones: number;
  /** Items carried per drone trip (stacks × stack size). */
  capacity: number;
  itemsPerTrip: number;
  targetItemsPerMin: number;
  fillFraction: number;
  warnings: string[];
}

export function droneCapacityItems(stackSize: number): number {
  return DRONE_CARGO_STACKS * Math.max(1, stackSize);
}

/**
 * Simple fleet sizing: drones = ceil(items needed per RT / drone capacity).
 * Source: drone inventory = 9 stacks (Satisfactory).
 */
export function sizeDroneFromThroughput(
  input: RouteSimInput,
  roundTripSeconds: number,
): DroneSizing | null {
  const targetItemsPerMin = resolveTargetItemsPerMin(input);
  if (targetItemsPerMin <= 0 || !(roundTripSeconds > 0)) return null;

  const stackSize = input.cargo?.stackSize ?? 100;
  const capacity = droneCapacityItems(stackSize);
  const itemsPerTrip = (targetItemsPerMin * roundTripSeconds) / 60;
  const drones = Math.max(1, Math.ceil(itemsPerTrip / capacity));
  const fillFraction = Math.min(1, itemsPerTrip / (drones * capacity));

  const warnings: string[] = [];
  if (drones > 12) {
    warnings.push(
      `Estimated ${drones} drones for ${Math.round(targetItemsPerMin)}/min — consider more ports or higher stack size.`,
    );
  }

  return {
    drones,
    capacity,
    itemsPerTrip,
    targetItemsPerMin,
    fillFraction,
    warnings,
  };
}
