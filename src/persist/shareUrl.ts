import LZString from 'lz-string';
import {
  DEFAULT_CARGO,
  DEFAULT_CONSIST,
  DEFAULT_FLAGS,
  normalizeProject,
  newId,
  type BeltMk,
  type CargoSettings,
  type Project,
  type ProjectFlags,
  type Route,
  type RouteNode,
  type Station,
  type StationRole,
  type TrainConsist,
  type VehicleType,
  type Waypoint,
} from '../domain/types';

/** Legacy full-JSON shares. */
const PREFIX_LEGACY = '#rtd=';
/** Compact packed shares. */
const PREFIX_COMPACT = '#r2=';

/** Soft limit — browsers vary; warn above this. */
export const SHARE_URL_SOFT_LIMIT = 8_000;

const ROLES: StationRole[] = ['pickup', 'dropoff', 'both', 'passthrough'];

function roundCoord(n: number): number {
  return Math.round(n * 10) / 10;
}

function vtCode(v: VehicleType): 0 | 1 {
  return v === 'drone' ? 1 : 0;
}

function vtFrom(c: unknown): VehicleType {
  return c === 1 ? 'drone' : 'train';
}

function roleCode(r: StationRole): number {
  const i = ROLES.indexOf(r);
  return i >= 0 ? i : 2;
}

function roleFrom(c: unknown): StationRole {
  return typeof c === 'number' && ROLES[c] ? ROLES[c] : 'both';
}

/** Drop keys that match defaults to shrink payload. */
function packConsist(c: TrainConsist): number[] | undefined {
  if (
    c.locomotives === DEFAULT_CONSIST.locomotives &&
    c.freightCars === DEFAULT_CONSIST.freightCars &&
    c.fillFraction === DEFAULT_CONSIST.fillFraction
  ) {
    return undefined;
  }
  return [
    c.locomotives,
    c.freightCars,
    Math.round(c.fillFraction * 1000) / 1000,
  ];
}

function unpackConsist(c: unknown): TrainConsist {
  if (!Array.isArray(c) || c.length < 3) return { ...DEFAULT_CONSIST };
  return {
    locomotives: Number(c[0]) || 1,
    freightCars: Number(c[1]) || 0,
    fillFraction: Math.min(1, Math.max(0, Number(c[2]) || 0)),
  };
}

function packFlags(f: ProjectFlags): unknown[] | undefined {
  if (
    f.flatTrack === DEFAULT_FLAGS.flatTrack &&
    f.cruiseHeight === DEFAULT_FLAGS.cruiseHeight &&
    f.closedLoop === DEFAULT_FLAGS.closedLoop
  ) {
    return undefined;
  }
  return [f.flatTrack ? 1 : 0, roundCoord(f.cruiseHeight), f.closedLoop ? 1 : 0];
}

function unpackFlags(f: unknown): ProjectFlags {
  if (!Array.isArray(f) || f.length < 3) return { ...DEFAULT_FLAGS };
  return {
    flatTrack: !!f[0],
    cruiseHeight: Number(f[1]) || 0,
    closedLoop: !!f[2],
  };
}

function packCargo(c: CargoSettings): unknown[] | undefined {
  if (
    c.stackSize === DEFAULT_CARGO.stackSize &&
    c.autoSizeConsist === DEFAULT_CARGO.autoSizeConsist
  ) {
    return undefined;
  }
  return [c.stackSize, c.autoSizeConsist ? 1 : 0];
}

function unpackCargo(c: unknown): CargoSettings {
  if (!Array.isArray(c) || c.length < 2) return { ...DEFAULT_CARGO };
  return {
    stackSize: Math.max(1, Number(c[0]) || 100),
    autoSizeConsist: !!c[1],
  };
}

/**
 * Compact wire format (JSON then LZ):
 * { v:2, n, a, s:[[n,t,o,x,y,z?,d?,b?,i?],...],
 *   r:[[n,t,color?, wp:[[x,y,z?],...], nodes:[[0,si]|[1,wi],...], consist?, flags?, cargo?],...] }
 */
export function packProject(project: Project): unknown {
  const p = normalizeProject(project);
  const stationIndex = new Map(p.stations.map((s, i) => [s.id, i]));

  const s = p.stations.map((st) => {
    const row: unknown[] = [
      st.name,
      vtCode(st.vehicleType),
      roleCode(st.role),
      roundCoord(st.x),
      roundCoord(st.y),
    ];
    const z = st.z ?? null;
    const dwell = st.dwellSeconds ?? null;
    const belt = st.beltMk ?? null;
    const ipm = st.itemsPerMin ?? null;
    if (z != null || dwell != null || belt != null || ipm != null) {
      row.push(z != null ? roundCoord(z) : null);
    }
    if (dwell != null || belt != null || ipm != null) {
      row.push(dwell);
    }
    if (belt != null || ipm != null) {
      row.push(belt);
    }
    if (ipm != null) {
      row.push(ipm);
    }
    return row;
  });

  const r = p.routes.map((route) => {
    const wpIndex = new Map(route.waypoints.map((w, i) => [w.id, i]));
    const wps = route.waypoints.map((w) => {
      const row: unknown[] = [roundCoord(w.x), roundCoord(w.y)];
      if (w.z != null) row.push(roundCoord(w.z));
      return row;
    });
    const nodes = route.route
      .map((node) => {
        if (node.kind === 'station') {
          const si = stationIndex.get(node.stationId);
          return si == null ? null : [0, si];
        }
        const wi = wpIndex.get(node.waypointId);
        return wi == null ? null : [1, wi];
      })
      .filter(Boolean);

    const row: unknown[] = [
      route.name,
      vtCode(route.vehicleType),
      route.color ?? null,
      wps,
      nodes,
    ];
    const consist = packConsist(route.consist);
    const flags = packFlags(route.flags);
    const cargo = packCargo(route.cargo);
    if (consist || flags || cargo) {
      row.push(consist ?? null);
      if (flags || cargo) row.push(flags ?? null);
      if (cargo) row.push(cargo);
    }
    return row;
  });

  const activeIdx = Math.max(
    0,
    p.routes.findIndex((rt) => rt.id === p.activeRouteId),
  );

  return {
    v: 2,
    n: p.name,
    a: activeIdx,
    s,
    r,
  };
}

export function unpackProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid share payload');
  }
  const o = raw as Record<string, unknown>;
  if (o.v !== 2 || !Array.isArray(o.s) || !Array.isArray(o.r)) {
    throw new Error('Unsupported share payload');
  }

  const stations: Station[] = o.s.map((row) => {
    const a = row as unknown[];
    const st: Station = {
      id: newId('st'),
      name: String(a[0] ?? 'Stop'),
      vehicleType: vtFrom(a[1]),
      role: roleFrom(a[2]),
      x: Number(a[3]) || 0,
      y: Number(a[4]) || 0,
    };
    if (a[5] != null) st.z = Number(a[5]);
    if (a[6] != null) st.dwellSeconds = Number(a[6]);
    if (a[7] != null) st.beltMk = Number(a[7]) as BeltMk;
    if (a[8] != null) st.itemsPerMin = Number(a[8]);
    return st;
  });

  const routes: Route[] = o.r.map((row) => {
    const a = row as unknown[];
    const waypoints: Waypoint[] = (Array.isArray(a[3]) ? a[3] : []).map(
      (wrow) => {
        const w = wrow as unknown[];
        const wp: Waypoint = {
          id: newId('wp'),
          x: Number(w[0]) || 0,
          y: Number(w[1]) || 0,
        };
        if (w[2] != null) wp.z = Number(w[2]);
        return wp;
      },
    );

    const routeNodes: RouteNode[] = [];
    for (const n of Array.isArray(a[4]) ? a[4] : []) {
      if (!Array.isArray(n) || n.length < 2) continue;
      if (n[0] === 0) {
        const st = stations[Number(n[1])];
        if (st) routeNodes.push({ kind: 'station', stationId: st.id });
      } else if (n[0] === 1) {
        const wp = waypoints[Number(n[1])];
        if (wp) routeNodes.push({ kind: 'waypoint', waypointId: wp.id });
      }
    }

    return {
      id: newId('rt'),
      name: String(a[0] ?? 'Route'),
      vehicleType: vtFrom(a[1]),
      color: typeof a[2] === 'string' ? a[2] : undefined,
      waypoints,
      route: routeNodes,
      consist: unpackConsist(a[5]),
      flags: unpackFlags(a[6]),
      cargo: unpackCargo(a[7]),
    };
  });

  if (routes.length === 0) {
    throw new Error('Share has no routes');
  }

  const activeIdx = Math.min(
    routes.length - 1,
    Math.max(0, Number(o.a) || 0),
  );

  return normalizeProject({
    version: 2,
    name: String(o.n ?? 'Shared route'),
    stations,
    routes,
    activeRouteId: routes[activeIdx].id,
  });
}

export function encodeShareHash(project: Project): string {
  const packed = JSON.stringify(packProject(project));
  const compressed = LZString.compressToEncodedURIComponent(packed);
  return `${PREFIX_COMPACT}${compressed}`;
}

export function decodeShareHash(hash: string): Project | null {
  try {
    const raw = hash.startsWith('#') ? hash.slice(1) : hash;

    if (raw.startsWith('r2=')) {
      const payload = raw.slice(3);
      const json = LZString.decompressFromEncodedURIComponent(payload);
      if (!json) return null;
      return unpackProject(JSON.parse(json));
    }

    if (raw.startsWith('rtd=')) {
      const payload = raw.slice(4);
      const json = LZString.decompressFromEncodedURIComponent(payload);
      if (!json) return null;
      const data = JSON.parse(json) as { version?: number };
      if (data.version !== 1 && data.version !== 2) return null;
      return normalizeProject(data);
    }

    return null;
  } catch {
    return null;
  }
}

export function applyShareToLocation(
  project: Project,
): { ok: boolean; length: number } {
  const hash = encodeShareHash(project);
  if (hash.length > SHARE_URL_SOFT_LIMIT) {
    return { ok: false, length: hash.length };
  }
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
  return { ok: true, length: hash.length };
}

export function readShareFromLocation(): Project | null {
  return decodeShareHash(window.location.hash);
}

/** Keep PREFIX_LEGACY referenced for docs/tests. */
export { PREFIX_LEGACY, PREFIX_COMPACT };
