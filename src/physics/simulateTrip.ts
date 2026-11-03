import {
  DEFAULT_DOCK_SECONDS,
  type RouteSimInput,
  type StationRole,
} from '../domain/types';
import { G, LOCO } from './constants';
import { locoForceAtSpeedKN, resolveConsist } from './consist';
import {
  densifyPath,
  resolveRoutePoints,
  stationStopDistances,
  type PathSample,
} from './path';
import { simulateDrone } from './simulateDrone';

export interface LegResult {
  fromStationId: string;
  toStationId: string;
  fromName: string;
  toName: string;
  distanceM: number;
  travelSeconds: number;
  dwellSeconds: number;
  avgSpeedKmh: number;
}

export interface PhaseTotals {
  accelerating: number;
  cruising: number;
  braking: number;
  stopped: number;
}

export interface TripResult {
  ok: boolean;
  reason?: string;
  totalDistanceM: number;
  totalTravelSeconds: number;
  totalDwellSeconds: number;
  totalRoundTripSeconds: number;
  avgSpeedKmh: number;
  phases: PhaseTotals;
  legs: LegResult[];
}

function dwellFor(station: {
  role: StationRole;
  dwellSeconds?: number;
}): number {
  if (station.dwellSeconds != null) return station.dwellSeconds;
  if (station.role === 'passthrough') return 0;
  return DEFAULT_DOCK_SECONDS;
}

function dragKN(coeff: number, v: number): number {
  return coeff * v * v;
}

function inclineKN(massTons: number, gradeRad: number): number {
  // Positive grade (uphill) resists forward motion.
  return massTons * G * Math.sin(gradeRad);
}

function curveResistKN(massTons: number, v: number, radiusM: number): number {
  if (!Number.isFinite(radiusM) || radiusM > 1e5) return 0;
  // Wiki approx: 0.4 * weight * velocity / radius (payload-ish); use total mass.
  return (0.4 * massTons * Math.max(v, 0)) / Math.max(radiusM, 1);
}

function sampleAt(samples: PathSample[], s: number): PathSample {
  if (s <= samples[0].s) return samples[0];
  const last = samples[samples.length - 1];
  if (s >= last.s) return last;
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].s <= s) lo = mid;
    else hi = mid;
  }
  return samples[lo];
}

/**
 * Integrate motion from distance 0 → targetS starting at speed 0, ending at 0.
 * Uses a simple forward Euler with look-ahead braking.
 */
function integrateLeg(
  samples: PathSample[],
  startS: number,
  endS: number,
  consistMassTons: number,
  maxForceKN: number,
  dragCoeff: number,
  rollKN: number,
  brakeKNFn: (v: number) => number,
  flatTrack: boolean,
): { seconds: number; phases: Omit<PhaseTotals, 'stopped'> } {
  const massKg = consistMassTons * 1000;
  const dt = 0.1;
  let s = startS;
  let v = 0;
  let t = 0;
  const phases = { accelerating: 0, cruising: 0, braking: 0 };
  const target = endS;
  const maxV = LOCO.maxSpeedMps;

  // Precompute remaining distance braking capability roughly each step.
  while (s < target - 0.05 && t < 3600 * 6) {
    const sample = sampleAt(samples, s);
    const grade = flatTrack ? 0 : sample.gradeRad;
    const remain = target - s;

    // Required deceleration to stop in remain (m/s²)
    const needDecel = v > 0.1 ? (v * v) / (2 * Math.max(remain, 0.5)) : 0;
    const brakeForceKN = brakeKNFn(v);
    const maxBrakeAccel =
      (brakeForceKN * 1000) / massKg + G * Math.sin(Math.max(grade, 0));

    // Stopping distance at current speed with available brake accel
    const stopDist =
      v > 0.05 ? (v * v) / (2 * Math.max(maxBrakeAccel, 0.2)) : 0;
    const shouldBrake =
      v > 0.05 && (remain <= stopDist * 1.15 || needDecel > maxBrakeAccel * 0.7);

    let forceKN = 0;
    let braking = false;

    if (shouldBrake) {
      braking = true;
      const incline = inclineKN(consistMassTons, grade);
      forceKN =
        -brakeForceKN -
        Math.sign(v) * (rollKN + dragKN(dragCoeff, v)) -
        incline;
    } else {
      // Coast/creep forward if nearly stopped but not at destination
      const loco = locoForceAtSpeedKN(maxForceKN, v);
      const incline = inclineKN(consistMassTons, grade);
      const resist =
        dragKN(dragCoeff, v) +
        rollKN +
        incline +
        curveResistKN(consistMassTons, v, sample.curveRadiusM);
      forceKN = loco - resist;
      // Cap approach speed when close
      if (remain < 60 && v > LOCO.approachSpeedMps) {
        braking = true;
        forceKN = -brakeForceKN * 0.5;
      }
    }

    const a = (forceKN * 1000) / massKg;
    let vNext = v + a * dt;
    if (!braking) vNext = Math.min(vNext, maxV);
    if (vNext < 0) vNext = 0;

    // Guarantee forward progress when crawling into the stop
    if (vNext < 0.3 && remain > 1 && !shouldBrake) {
      vNext = Math.max(vNext, Math.min(2, remain));
    }

    const ds = ((v + vNext) / 2) * dt;
    if (s + ds >= target || remain <= 0.5) {
      const frac = ds > 1e-6 ? Math.min(1, remain / ds) : 1;
      t += dt * frac;
      phases.braking += dt * frac;
      s = target;
      v = 0;
      break;
    }

    s += ds;
    v = vNext;
    t += dt;

    if (braking) phases.braking += dt;
    else if (Math.abs(a) < 0.15 && v > maxV * 0.85) phases.cruising += dt;
    else if (a > 0.05) phases.accelerating += dt;
    else phases.cruising += dt;
  }

  return { seconds: t, phases };
}

export function simulateTrip(input: RouteSimInput): TripResult {
  if (input.vehicleType === 'drone') {
    return simulateDrone(input);
  }

  const points = resolveRoutePoints(input);
  const empty: TripResult = {
    ok: false,
    reason: 'Need at least two stations on the route',
    totalDistanceM: 0,
    totalTravelSeconds: 0,
    totalDwellSeconds: 0,
    totalRoundTripSeconds: 0,
    avgSpeedKmh: 0,
    phases: { accelerating: 0, cruising: 0, braking: 0, stopped: 0 },
    legs: [],
  };

  const stops = stationStopDistances(input, points);
  if (stops.length < 2 && !(input.flags.closedLoop && stops.length === 1)) {
    return empty;
  }

  // Build stop list for legs including return for closed loop
  const stopList = [...stops];
  if (input.flags.closedLoop && stops.length >= 1) {
    const first = stops[0];
    const lastPoint = points[points.length - 1];
    const totalLen = lastPoint
      ? densifyPath(points).at(-1)?.s ??
        points.reduce(
          (acc, p, i) =>
            i === 0 ? 0 : acc + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y),
          0,
        )
      : 0;
    // Ensure closing stop at end distance
    const samplesProbe = densifyPath(points);
    const endS = samplesProbe.length ? samplesProbe[samplesProbe.length - 1].s : totalLen;
    if (
      stopList.length === 1 ||
      stopList[stopList.length - 1].stationId !== first.stationId ||
      Math.abs(stopList[stopList.length - 1].distanceM - endS) > 1
    ) {
      stopList.push({
        stationId: first.stationId,
        station: first.station,
        distanceM: endS,
      });
    }
  }

  if (stopList.length < 2) return empty;

  const samples = densifyPath(points);
  if (samples.length < 2) return empty;

  const physics = resolveConsist(input.consist);
  const phases: PhaseTotals = {
    accelerating: 0,
    cruising: 0,
    braking: 0,
    stopped: 0,
  };
  const legs: LegResult[] = [];
  let travel = 0;

  for (let i = 0; i < stopList.length - 1; i++) {
    const from = stopList[i];
    const to = stopList[i + 1];
    const startS = from.distanceM;
    const endS = to.distanceM;
    if (endS <= startS + 0.5) continue;

    const { seconds, phases: p } = integrateLeg(
      samples,
      startS,
      endS,
      physics.massTons,
      physics.maxForceKN,
      physics.dragCoeff,
      physics.rollKN,
      physics.brakeKN,
      input.flags.flatTrack,
    );

    phases.accelerating += p.accelerating;
    phases.cruising += p.cruising;
    phases.braking += p.braking;
    travel += seconds;

    const dist = endS - startS;
    // Dwell at destination (not on final return duplicate for closed loop counted once)
    const isFinalReturn =
      input.flags.closedLoop && i === stopList.length - 2;
    const dwell = isFinalReturn ? 0 : dwellFor(to.station);
    // Also count dwell at each intermediate stop when arriving
    const arriveDwell = dwellFor(to.station);
    // For round trip: dwell at every stop once per visit. On closed loop, first station
    // dwell counted when we complete the loop separately below.
    const legDwell = isFinalReturn ? dwellFor(to.station) : arriveDwell;

    legs.push({
      fromStationId: from.stationId,
      toStationId: to.stationId,
      fromName: from.station.name,
      toName: to.station.name,
      distanceM: dist,
      travelSeconds: seconds,
      dwellSeconds: legDwell,
      avgSpeedKmh: seconds > 0 ? dist / seconds * 3.6 : 0,
    });

    phases.stopped += legDwell;
    void dwell;
  }

  // Closed loop: also dwell at starting station once per round trip (already included
  // as final return dwell above). For open routes, dwell at first station once at start.
  if (!input.flags.closedLoop && stopList.length > 0) {
    const startDwell = dwellFor(stopList[0].station);
    phases.stopped += startDwell;
  }

  const totalDwell = phases.stopped;
  const totalDist = stopList[stopList.length - 1].distanceM - stopList[0].distanceM;
  const totalRT = travel + totalDwell;

  return {
    ok: true,
    totalDistanceM: totalDist,
    totalTravelSeconds: travel,
    totalDwellSeconds: totalDwell,
    totalRoundTripSeconds: totalRT,
    avgSpeedKmh: travel > 0 ? (totalDist / travel) * 3.6 : 0,
    phases,
    legs,
  };
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m ${r}s`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}
