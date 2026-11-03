import { FREIGHT, LOCO } from './constants';
import type { TrainConsist } from '../domain/types';

export interface ConsistPhysics {
  massTons: number;
  massKg: number;
  maxForceKN: number;
  dragCoeff: number; // kN at max speed, scales with v²
  rollKN: number;
  brakeKN: (speedMps: number) => number;
}

export function resolveConsist(consist: TrainConsist): ConsistPhysics {
  const fill = Math.min(1, Math.max(0, consist.fillFraction));
  const carTons = FREIGHT.emptyTons + (FREIGHT.fullTons - FREIGHT.emptyTons) * fill;
  const massTons =
    consist.locomotives * LOCO.massTons + consist.freightCars * carTons;
  const rollKN =
    consist.locomotives * LOCO.rollKN +
    consist.freightCars *
      (FREIGHT.rollEmptyKN + (FREIGHT.rollFullKN - FREIGHT.rollEmptyKN) * fill);
  const dragAtMax =
    consist.locomotives * LOCO.dragAtMaxKN +
    consist.freightCars * FREIGHT.dragAtMaxKN;

  return {
    massTons,
    massKg: massTons * 1000,
    maxForceKN: consist.locomotives * LOCO.forceKN,
    dragCoeff: dragAtMax / (LOCO.maxSpeedMps * LOCO.maxSpeedMps),
    rollKN,
    brakeKN(speedMps: number) {
      const air =
        consist.locomotives * LOCO.airBrakeKN +
        consist.freightCars * FREIGHT.airBrakeKN;
      const regenPerLoco =
        speedMps > LOCO.regenBrakeThresholdMps
          ? LOCO.regenBrakeHighKN
          : LOCO.regenBrakeLowKN;
      return air + consist.locomotives * regenPerLoco;
    },
  };
}

export function locoForceAtSpeedKN(maxForceKN: number, speedMps: number): number {
  if (speedMps <= LOCO.forceTaperStartMps) return maxForceKN;
  if (speedMps >= LOCO.maxSpeedMps) return maxForceKN * 0.15;
  const t =
    (speedMps - LOCO.forceTaperStartMps) /
    (LOCO.maxSpeedMps - LOCO.forceTaperStartMps);
  return maxForceKN * (1 - 0.85 * t);
}
