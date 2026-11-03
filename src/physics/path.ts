import { MIN_BLUE_CURVE_RADIUS_M, SAMPLE_STEP_M } from './constants';
import type { RouteSimInput, Station, Waypoint } from '../domain/types';

export interface PathSample {
  x: number;
  y: number;
  z: number;
  /** Cumulative distance along path from start (m). */
  s: number;
  /** Grade angle in radians (atan2(dz, horizontal)). */
  gradeRad: number;
  /** Approximate curve radius (m); Infinity if straight. */
  curveRadiusM: number;
  /** Index of polyline segment (points[i] → points[i+1]) this sample lies on. */
  segmentIndex: number;
}

export interface ResolvedPoint {
  x: number;
  y: number;
  z: number;
  stationId?: string;
  waypointId?: string;
}

export interface ResolvedRoute {
  points: ResolvedPoint[];
  /** `route[]` index for each point; `-1` = synthetic closed-loop return point. */
  routeIndex: number[];
}

export function resolveRouteDetailed(input: RouteSimInput): ResolvedRoute {
  const stations = new Map(input.stations.map((s) => [s.id, s]));
  const waypoints = new Map(input.waypoints.map((w) => [w.id, w]));
  const cruise = input.flags.cruiseHeight;
  const flat = input.flags.flatTrack;

  const points: ResolvedPoint[] = [];
  const routeIndex: number[] = [];

  for (let i = 0; i < input.route.length; i++) {
    const node = input.route[i];
    if (node.kind === 'station') {
      const s = stations.get(node.stationId);
      if (!s) continue;
      points.push({
        x: s.x,
        y: s.y,
        z: flat ? cruise : (s.z ?? cruise),
        stationId: s.id,
      });
      routeIndex.push(i);
    } else {
      const w = waypoints.get(node.waypointId);
      if (!w) continue;
      points.push({
        x: w.x,
        y: w.y,
        z: flat ? cruise : (w.z ?? cruise),
        waypointId: w.id,
      });
      routeIndex.push(i);
    }
  }

  if (input.flags.closedLoop && points.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    const needsClose =
      (first.stationId && first.stationId !== last.stationId) ||
      !first.stationId ||
      first.x !== last.x ||
      first.y !== last.y;
    if (needsClose) {
      points.push({ ...first });
      routeIndex.push(-1);
    }
  }

  return { points, routeIndex };
}

export function resolveRoutePoints(input: RouteSimInput): ResolvedPoint[] {
  return resolveRouteDetailed(input).points;
}

/** Route[] index after which to splice a waypoint for a polyline segment. */
export function insertAfterRouteIndex(
  input: RouteSimInput,
  segmentIndex: number,
): number {
  const { points, routeIndex } = resolveRouteDetailed(input);
  if (points.length < 2) return Math.max(0, input.route.length - 1);
  const i = Math.max(0, Math.min(segmentIndex, points.length - 2));
  const startIdx = routeIndex[i];
  if (startIdx >= 0) return startIdx;
  // Closing segment: append at end of route
  return Math.max(0, input.route.length - 1);
}

/**
 * Inclusive route[] index range covering a polyline segment's endpoints.
 * `endRouteIndex` is `-1` for the synthetic closed-loop return.
 */
export function segmentRouteBounds(
  input: RouteSimInput,
  segmentIndex: number,
): { startRouteIndex: number; endRouteIndex: number } | null {
  const { points, routeIndex } = resolveRouteDetailed(input);
  if (points.length < 2) return null;
  const i = Math.max(0, Math.min(segmentIndex, points.length - 2));
  return {
    startRouteIndex: routeIndex[i],
    endRouteIndex: routeIndex[i + 1],
  };
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

/** Estimate curvature radius from three consecutive samples. */
function curveRadius(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  const ab = dist2(a, b);
  const bc = dist2(b, c);
  const ca = dist2(c, a);
  if (ab < 1e-3 || bc < 1e-3) return Infinity;
  const area =
    Math.abs(a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)) / 2;
  if (area < 1e-6) return Infinity;
  return (ab * bc * ca) / (4 * area);
}

export function densifyPath(
  points: ResolvedPoint[],
  stepM = SAMPLE_STEP_M,
): PathSample[] {
  if (points.length < 2) return [];

  const samples: PathSample[] = [];
  let s = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const horiz = dist2(a, b);
    const dz = b.z - a.z;
    const seglen = Math.hypot(horiz, dz);
    const n = Math.max(1, Math.ceil(seglen / stepM));

    for (let k = 0; k < n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const z = a.z + (b.z - a.z) * t;
      const gradeRad = horiz > 1e-6 ? Math.atan2(dz, horiz) : 0;
      samples.push({
        x,
        y,
        z,
        s,
        gradeRad,
        curveRadiusM: Infinity,
        segmentIndex: i,
      });
      s += seglen / n;
    }
  }

  const last = points[points.length - 1];
  const lastSeg = Math.max(0, points.length - 2);
  samples.push({
    x: last.x,
    y: last.y,
    z: last.z,
    s,
    gradeRad: samples.length ? samples[samples.length - 1].gradeRad : 0,
    curveRadiusM: Infinity,
    segmentIndex: lastSeg,
  });

  for (let i = 1; i < samples.length - 1; i++) {
    const raw = curveRadius(samples[i - 1], samples[i], samples[i + 1]);
    // Floor at blue-track min: polyline corners are not zero-radius hairpins.
    samples[i].curveRadiusM = Number.isFinite(raw)
      ? Math.max(raw, MIN_BLUE_CURVE_RADIUS_M)
      : Infinity;
  }

  return samples;
}

export function stationStopDistances(
  input: RouteSimInput,
  points: ResolvedPoint[],
): { stationId: string; station: Station; distanceM: number }[] {
  const stations = new Map(input.stations.map((s) => [s.id, s]));
  const out: { stationId: string; station: Station; distanceM: number }[] = [];
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) s += dist2(points[i - 1], points[i]);
    const p = points[i];
    if (!p.stationId) continue;
    // Skip duplicate closing station at end for dwell listing of "stops to make"
    if (i === points.length - 1 && input.flags.closedLoop && out.length > 0) {
      continue;
    }
    const station = stations.get(p.stationId);
    if (!station) continue;
    out.push({ stationId: p.stationId, station, distanceM: s });
  }
  return out;
}

export function horizontalLength(points: ResolvedPoint[]): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += dist2(points[i - 1], points[i]);
  return s;
}

export type { Station, Waypoint };
