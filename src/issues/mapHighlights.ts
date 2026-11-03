import type { Station } from '../domain/types';
import type { ResolvedPoint } from '../physics/path';
import type { Issue, MapIssueSeverity } from './detect';

const SEV_RANK: Record<MapIssueSeverity, number> = {
  warning: 1,
  error: 2,
};

function worse(
  a: MapIssueSeverity | undefined,
  b: MapIssueSeverity,
): MapIssueSeverity {
  if (!a) return b;
  return SEV_RANK[b] > SEV_RANK[a] ? b : a;
}

function distPointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

function nearestSegmentIndex(
  x: number,
  y: number,
  points: ResolvedPoint[],
): number | null {
  if (points.length < 2) return null;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const d = distPointToSegment(x, y, a.x, a.y, b.x, b.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Stations within this distance of an issue point also get tinted. */
const NEAR_STATION_M = 55;

export interface IssueMapHighlights {
  stations: Map<string, MapIssueSeverity>;
  segments: Map<number, MapIssueSeverity>;
}

/**
 * Build worst-severity maps for stations and route polyline segments
 * from detected issues (plus coord fallbacks).
 */
export function buildIssueMapHighlights(
  issues: Issue[],
  points: ResolvedPoint[],
  stations: Station[],
): IssueMapHighlights {
  const stationSev = new Map<string, MapIssueSeverity>();
  const segmentSev = new Map<number, MapIssueSeverity>();

  const markStation = (id: string | undefined, sev: MapIssueSeverity) => {
    if (!id) return;
    stationSev.set(id, worse(stationSev.get(id), sev));
  };

  const markSegment = (idx: number | undefined, sev: MapIssueSeverity) => {
    if (idx == null || idx < 0 || points.length < 2) return;
    const clamped = Math.min(idx, points.length - 2);
    segmentSev.set(clamped, worse(segmentSev.get(clamped), sev));
  };

  for (const issue of issues) {
    if (issue.severity !== 'warning' && issue.severity !== 'error') continue;
    const sev = issue.severity;

    markStation(issue.stationId, sev);
    for (const id of issue.relatedStationIds ?? []) markStation(id, sev);
    markSegment(issue.segmentIndex, sev);

    if (issue.x == null || issue.y == null) continue;

    // Coord fallback / reinforcement: nearest segment + nearby stations
    if (issue.segmentIndex == null) {
      markSegment(nearestSegmentIndex(issue.x, issue.y, points) ?? undefined, sev);
    }

    for (const st of stations) {
      if (Math.hypot(st.x - issue.x, st.y - issue.y) <= NEAR_STATION_M) {
        markStation(st.id, sev);
      }
    }
  }

  return { stations: stationSev, segments: segmentSev };
}

export const ROUTE_COLORS = {
  default: '#d4a017',
  warning: '#e0892f',
  error: '#e85d5d',
} as const;

export function routeColorFor(
  sev: MapIssueSeverity | undefined,
  baseColor: string = ROUTE_COLORS.default,
): string {
  if (sev === 'error') return ROUTE_COLORS.error;
  if (sev === 'warning') return ROUTE_COLORS.warning;
  return baseColor;
}
