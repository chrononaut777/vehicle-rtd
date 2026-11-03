import type { RouteSimInput } from '../domain/types';
import { MAX_GRADE_RATIO } from '../physics/constants';
import { resolveConsist, locoForceAtSpeedKN } from '../physics/consist';
import { densifyPath, resolveRoutePoints } from '../physics/path';
import { G } from '../physics/constants';
import { sampleHeight, type Heightmap } from '../terrain/heightmap';

export type IssueSeverity = 'info' | 'warning' | 'error';

/** Severities that tint the map (info is list-only). */
export type MapIssueSeverity = 'warning' | 'error';

export interface Issue {
  id: string;
  severity: IssueSeverity;
  message: string;
  x?: number;
  y?: number;
  /** Station implicated when detection knows it. */
  stationId?: string;
  /** Extra stations sharing this issue (e.g. pair too close). */
  relatedStationIds?: string[];
  /** Polyline segment index (resolveRoutePoints[i] → [i+1]). */
  segmentIndex?: number;
}

export function detectIssues(
  input: RouteSimInput,
  heightmap: Heightmap | null,
  /** Prefix so multi-route issue ids stay unique when merged. */
  idPrefix = '',
): Issue[] {
  const issues: Issue[] = [];
  const isDrone = input.vehicleType === 'drone';
  const stopWord = isDrone ? 'ports' : 'stations';
  const points = resolveRoutePoints(input);
  const pid = (id: string) => (idPrefix ? `${idPrefix}${id}` : id);

  if (points.length < 2) {
    issues.push({
      id: pid('need-route'),
      severity: 'info',
      message: `Place at least two ${stopWord} and link them on a route.`,
    });
    return issues;
  }

  if (isDrone) {
    const deduped: Issue[] = [
      {
        id: pid('drone-mode'),
        severity: 'info',
        message:
          'Drone mode: constant ~90 km/h cruise on horizontal path; no rail grade/consist checks.',
      },
    ];

    // Ports very close (still useful for route sanity)
    const stationNodes = points.filter((p) => p.stationId);
    for (let i = 1; i < stationNodes.length; i++) {
      const a = stationNodes[i - 1];
      const b = stationNodes[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d < 40 && a.stationId !== b.stationId) {
        deduped.push({
          id: pid(`close-${a.stationId}-${b.stationId}`),
          severity: 'warning',
          message: `Ports are only ${d.toFixed(0)} m apart.`,
          x: b.x,
          y: b.y,
          stationId: b.stationId,
          relatedStationIds: a.stationId ? [a.stationId] : undefined,
        });
      }
    }
    return deduped;
  }

  const samples = densifyPath(points);
  const physics = resolveConsist(input.consist);
  const maxPractical = MAX_GRADE_RATIO.beams; // steepest known buildable ~1:2.25

  let maxGrade = 0;
  let maxGradeAt = samples[0];

  for (const s of samples) {
    const grade = input.flags.flatTrack ? 0 : Math.abs(Math.tan(s.gradeRad));
    if (grade > maxGrade) {
      maxGrade = grade;
      maxGradeAt = s;
    }

    if (!input.flags.flatTrack && grade > maxPractical) {
      issues.push({
        id: pid(`grade-${s.s.toFixed(0)}`),
        severity: 'error',
        message: `Grade ${(grade * 100).toFixed(1)}% exceeds practical rail max (~${(maxPractical * 100).toFixed(1)}%) near (${s.x.toFixed(0)}, ${s.y.toFixed(0)}).`,
        x: s.x,
        y: s.y,
        segmentIndex: s.segmentIndex,
      });
    }

    if (!input.flags.flatTrack && s.gradeRad > 0.01) {
      const inclineKN = physics.massTons * G * Math.sin(s.gradeRad);
      const force = locoForceAtSpeedKN(physics.maxForceKN, 5);
      const net = force - physics.rollKN - inclineKN;
      if (net <= 0) {
        issues.push({
          id: pid(`stall-${s.s.toFixed(0)}`),
          severity: 'error',
          message: `Consist cannot climb grade at (${s.x.toFixed(0)}, ${s.y.toFixed(0)}) — add locomotives or flatten the route.`,
          x: s.x,
          y: s.y,
          segmentIndex: s.segmentIndex,
        });
      } else if (net < force * 0.15) {
        issues.push({
          id: pid(`slow-${s.s.toFixed(0)}`),
          severity: 'warning',
          message: `Very little excess pull on climb near (${s.x.toFixed(0)}, ${s.y.toFixed(0)}).`,
          x: s.x,
          y: s.y,
          segmentIndex: s.segmentIndex,
        });
      }
    }

    if (input.flags.flatTrack && heightmap) {
      const terrain = sampleHeight(heightmap, s.x, s.y);
      if (terrain != null && terrain > input.flags.cruiseHeight - 2) {
        issues.push({
          id: pid(`clip-${s.s.toFixed(0)}`),
          severity: 'warning',
          message: `Flat cruise ${input.flags.cruiseHeight.toFixed(0)} m is at/below terrain (~${terrain.toFixed(0)} m) near (${s.x.toFixed(0)}, ${s.y.toFixed(0)}).`,
          x: s.x,
          y: s.y,
          segmentIndex: s.segmentIndex,
        });
      }
    }
  }

  // Deduplicate similar issues by rounding position buckets (keep first N of each type)
  const deduped: Issue[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    const key = `${issue.id.split('-')[0]}-${Math.round((issue.x ?? 0) / 50)}-${Math.round((issue.y ?? 0) / 50)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(issue);
    if (deduped.length >= 40) break;
  }

  if (input.flags.flatTrack) {
    deduped.unshift({
      id: pid('flat-mode'),
      severity: 'info',
      message: `Flat track mode: grades treated as 0 at cruise height ${input.flags.cruiseHeight} m.`,
    });
  } else if (maxGrade > 0) {
    deduped.unshift({
      id: pid('max-grade'),
      severity: 'info',
      message: `Max path grade ${(maxGrade * 100).toFixed(1)}% near (${maxGradeAt.x.toFixed(0)}, ${maxGradeAt.y.toFixed(0)}).`,
      x: maxGradeAt.x,
      y: maxGradeAt.y,
      segmentIndex: maxGradeAt.segmentIndex,
    });
  }

  if (heightmap?.meta.approximate) {
    deduped.push({
      id: pid('approx-dem'),
      severity: 'info',
      message: 'Terrain heightmap is approximate — treat topography warnings as guidance only.',
    });
  }

  // Stations too close
  const stationNodes = points.filter((p) => p.stationId);
  for (let i = 1; i < stationNodes.length; i++) {
    const a = stationNodes[i - 1];
    const b = stationNodes[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < 40 && a.stationId !== b.stationId) {
      deduped.push({
        id: pid(`close-${a.stationId}-${b.stationId}`),
        severity: 'warning',
        message: `Stations are only ${d.toFixed(0)} m apart — accel/brake profile may be unrealistic.`,
        x: b.x,
        y: b.y,
        stationId: b.stationId,
        relatedStationIds: a.stationId ? [a.stationId] : undefined,
      });
    }
  }

  return deduped;
}
