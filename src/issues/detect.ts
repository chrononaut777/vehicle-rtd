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

  /** Continuous path runs — one issue per stretch, not per sample. */
  type PathRun = {
    kind: 'grade' | 'stall' | 'slow' | 'clip';
    startS: number;
    endS: number;
    x: number;
    y: number;
    segmentIndex?: number;
    worst: number;
  };
  const runs: PathRun[] = [];
  const openRef: { run: PathRun | null } = { run: null };

  const flushRun = () => {
    const cur = openRef.run;
    if (!cur) return;
    // Ignore tiny blips (< ~25 m along path)
    if (cur.endS - cur.startS >= 25 || cur.kind === 'grade') {
      runs.push(cur);
    }
    openRef.run = null;
  };

  const noteRun = (
    kind: PathRun['kind'],
    s: (typeof samples)[number],
    worst: number,
  ) => {
    const cur = openRef.run;
    if (cur && cur.kind === kind && s.s - cur.endS < 80) {
      cur.endS = s.s;
      if (worst > cur.worst) {
        cur.worst = worst;
        cur.x = s.x;
        cur.y = s.y;
        cur.segmentIndex = s.segmentIndex;
      }
      return;
    }
    flushRun();
    openRef.run = {
      kind,
      startS: s.s,
      endS: s.s,
      x: s.x,
      y: s.y,
      segmentIndex: s.segmentIndex,
      worst,
    };
  };

  for (const s of samples) {
    const grade = input.flags.flatTrack ? 0 : Math.abs(Math.tan(s.gradeRad));
    if (grade > maxGrade) {
      maxGrade = grade;
      maxGradeAt = s;
    }

    if (!input.flags.flatTrack && grade > maxPractical) {
      noteRun('grade', s, grade);
      continue;
    }

    if (!input.flags.flatTrack && s.gradeRad > 0.01) {
      const inclineKN = physics.massTons * G * Math.sin(s.gradeRad);
      const force = locoForceAtSpeedKN(physics.maxForceKN, 5);
      const net = force - physics.rollKN - inclineKN;
      if (net <= 0) {
        noteRun('stall', s, -net);
        continue;
      }
      if (net < force * 0.15) {
        noteRun('slow', s, force - net);
        continue;
      }
    }

    if (input.flags.flatTrack && heightmap) {
      const terrain = sampleHeight(heightmap, s.x, s.y);
      if (terrain != null && terrain > input.flags.cruiseHeight - 2) {
        noteRun('clip', s, terrain);
        continue;
      }
    }

    // Clear stretch — close run after ~80 m of good path
    const cur = openRef.run;
    if (cur && s.s - cur.endS >= 80) flushRun();
  }
  flushRun();

  const cruise = input.flags.cruiseHeight;
  for (const run of runs) {
    const len = Math.max(1, run.endS - run.startS);
    if (run.kind === 'grade') {
      issues.push({
        id: pid(`grade-${run.startS.toFixed(0)}`),
        severity: 'error',
        message: `Grade ${(run.worst * 100).toFixed(1)}% exceeds practical rail max (~${(maxPractical * 100).toFixed(1)}%) over ~${len.toFixed(0)} m near (${run.x.toFixed(0)}, ${run.y.toFixed(0)}).`,
        x: run.x,
        y: run.y,
        segmentIndex: run.segmentIndex,
      });
    } else if (run.kind === 'stall') {
      issues.push({
        id: pid(`stall-${run.startS.toFixed(0)}`),
        severity: 'error',
        message: `Consist cannot climb grade over ~${len.toFixed(0)} m near (${run.x.toFixed(0)}, ${run.y.toFixed(0)}) — add locomotives or flatten the route.`,
        x: run.x,
        y: run.y,
        segmentIndex: run.segmentIndex,
      });
    } else if (run.kind === 'slow') {
      issues.push({
        id: pid(`slow-${run.startS.toFixed(0)}`),
        severity: 'warning',
        message: `Very little excess pull on climb over ~${len.toFixed(0)} m near (${run.x.toFixed(0)}, ${run.y.toFixed(0)}).`,
        x: run.x,
        y: run.y,
        segmentIndex: run.segmentIndex,
      });
    } else if (run.kind === 'clip') {
      issues.push({
        id: pid(`clip-${run.startS.toFixed(0)}`),
        severity: 'warning',
        message: `Flat cruise ${cruise.toFixed(0)} m is at/below terrain (up to ~${run.worst.toFixed(0)} m) for ~${len.toFixed(0)} m near (${run.x.toFixed(0)}, ${run.y.toFixed(0)}). Raise cruise height or avoid the ridge.`,
        x: run.x,
        y: run.y,
        segmentIndex: run.segmentIndex,
      });
    }
  }

  // Cap list size; path issues are already clustered by run
  const deduped: Issue[] = issues.slice(0, 24);

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
