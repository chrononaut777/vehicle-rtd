import {
  DEFAULT_DOCK_SECONDS,
  type RouteSimInput,
  type StationRole,
} from '../domain/types';
import { DRONE } from './constants';
import {
  resolveRoutePoints,
  stationStopDistances,
  type ResolvedPoint,
} from './path';
import type { LegResult, PhaseTotals, TripResult } from './simulateTrip';

function dwellFor(station: {
  role: StationRole;
  dwellSeconds?: number;
}): number {
  if (station.dwellSeconds != null) return station.dwellSeconds;
  if (station.role === 'passthrough') return 0;
  return DEFAULT_DOCK_SECONDS;
}

/** Cumulative horizontal path length (ignore Z / grades). */
function horizontalCumDist(points: ResolvedPoint[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return cum;
}

/**
 * Constant-speed drone round trip: horizontal distance ÷ cruise, plus dock dwell.
 * No accel/brake, grades, or consist physics.
 */
export function simulateDrone(input: RouteSimInput): TripResult {
  const empty: TripResult = {
    ok: false,
    reason: 'Need at least two ports on the route',
    totalDistanceM: 0,
    totalTravelSeconds: 0,
    totalDwellSeconds: 0,
    totalRoundTripSeconds: 0,
    avgSpeedKmh: 0,
    phases: { accelerating: 0, cruising: 0, braking: 0, stopped: 0 },
    legs: [],
  };

  const points = resolveRoutePoints(input);
  if (points.length < 2) return empty;

  const cum = horizontalCumDist(points);
  const totalLen = cum[cum.length - 1];

  const stops = stationStopDistances(input, points);
  if (stops.length < 2 && !(input.flags.closedLoop && stops.length === 1)) {
    return empty;
  }

  // Map station stops onto horizontal cumulative distances at matching point indices.
  const horizStops: {
    stationId: string;
    station: (typeof stops)[0]['station'];
    distanceM: number;
  }[] = [];
  let pi = 0;
  for (const stop of stops) {
    while (
      pi < points.length &&
      points[pi].stationId !== stop.stationId
    ) {
      pi++;
    }
    if (pi >= points.length) break;
    horizStops.push({
      stationId: stop.stationId,
      station: stop.station,
      distanceM: cum[pi],
    });
    pi++;
  }

  const stopList = [...horizStops];
  if (input.flags.closedLoop && horizStops.length >= 1) {
    const first = horizStops[0];
    const last = stopList[stopList.length - 1];
    if (
      stopList.length === 1 ||
      last.stationId !== first.stationId ||
      Math.abs(last.distanceM - totalLen) > 1
    ) {
      stopList.push({
        stationId: first.stationId,
        station: first.station,
        distanceM: totalLen,
      });
    }
  }

  if (stopList.length < 2) return empty;

  const speed = DRONE.cruiseSpeedMps;
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
    const dist = to.distanceM - from.distanceM;
    if (dist <= 0.5) continue;

    const seconds = dist / speed;
    travel += seconds;
    phases.cruising += seconds;

    const legDwell = dwellFor(to.station);
    legs.push({
      fromStationId: from.stationId,
      toStationId: to.stationId,
      fromName: from.station.name,
      toName: to.station.name,
      distanceM: dist,
      travelSeconds: seconds,
      dwellSeconds: legDwell,
      avgSpeedKmh: speed * 3.6,
    });
    phases.stopped += legDwell;
  }

  if (!input.flags.closedLoop && stopList.length > 0) {
    phases.stopped += dwellFor(stopList[0].station);
  }

  const totalDwell = phases.stopped;
  const totalDist =
    stopList[stopList.length - 1].distanceM - stopList[0].distanceM;
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
