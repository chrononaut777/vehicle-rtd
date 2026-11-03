/** Conveyor belt rates (items/min). Mk.6 included for 1.0+. */
export const BELT_RATES: Record<number, number> = {
  1: 60,
  2: 120,
  3: 270,
  4: 480,
  5: 780,
  6: 1200,
};

export type BeltMk = 1 | 2 | 3 | 4 | 5 | 6;

export const BELT_MK_OPTIONS: BeltMk[] = [1, 2, 3, 4, 5, 6];

/** Freight car inventory slots (solids). */
export const FREIGHT_SLOTS = 32;

/** Community rule of thumb: 1 locomotive per 3 freight cars. */
export const CARS_PER_LOCOMOTIVE = 3;

/** Freight platform dual belt ports. */
export const PLATFORM_BELT_PORTS = 2;

export function beltRate(mk: number): number {
  return BELT_RATES[mk] ?? BELT_RATES[5];
}

export function carCapacityItems(stackSize: number): number {
  return Math.max(1, stackSize) * FREIGHT_SLOTS;
}

/**
 * Max sustained items/min into one freight platform for a given belt mk
 * using both ports (ignores dock lockout — planning ceiling).
 */
export function platformBeltCeiling(mk: BeltMk): number {
  return beltRate(mk) * PLATFORM_BELT_PORTS;
}
