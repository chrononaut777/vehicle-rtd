/** Wiki-derived train physics constants (Electric Locomotive / Freight Car). */

export const G = 9.81; // m/s²

export const LOCO = {
  massTons: 300,
  forceKN: 2000,
  maxSpeedMps: 120 / 3.6, // 120 km/h
  approachSpeedMps: 15 / 3.6,
  /** Force taper above this speed (wiki: dial back above ~60 km/h). */
  forceTaperStartMps: 60 / 3.6,
  dragAtMaxKN: 15,
  rollKN: 4.4,
  airBrakeKN: 900,
  regenBrakeHighKN: 600, // above 80 km/h
  regenBrakeLowKN: 2000, // below 80 km/h
  regenBrakeThresholdMps: 80 / 3.6,
} as const;

export const FREIGHT = {
  emptyTons: 30,
  fullTons: 100,
  dragAtMaxKN: 5.4,
  rollEmptyKN: 0.4,
  rollFullKN: 1.5,
  airBrakeKN: 200,
} as const;

/** Practical max rail grade ratios (rise:run inverted → run/rise). */
export const MAX_GRADE_RATIO = {
  foundations: 1 / 3.375,
  ramps2m: 1 / 2.7,
  beams: 1 / 2.25,
} as const;

export const SAMPLE_STEP_M = 8;

/**
 * Drone transport MVP constants.
 * Cruise ~90 km/h (community / wiki ballpark); dock dwell matches train freight dock.
 * Source: approximate Satisfactory wiki / community figures — not high-fidelity.
 */
export const DRONE = {
  /** Horizontal cruise speed (m/s) ≈ 90 km/h. */
  cruiseSpeedMps: 25,
  /** Port dock / transfer dwell when role is not passthrough (s). */
  dockSeconds: 27.08,
} as const;

/**
 * Sharpest Railway curve that stays "blue" (no in-game "Turning Radius too tight" warning).
 * Wiki: ~17 m centerline radius for a perfect 90° foundation turn.
 * Planner polylines may kink tighter; assume the player lays at least this radius in-game.
 */
export const MIN_BLUE_CURVE_RADIUS_M = 17;
