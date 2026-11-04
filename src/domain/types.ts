export type VehicleType = 'train' | 'drone';

/** Drone inventory slots (Satisfactory drone). Used for throughput sizing. */
export const DRONE_CARGO_STACKS = 9;

export type StationRole = 'pickup' | 'dropoff' | 'both' | 'passthrough';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type BeltMk = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Shared map stop (train station or drone port).
 * Stations/ports live in one project-wide pool and may be linked from multiple routes.
 */
export interface Station {
  id: string;
  name: string;
  vehicleType: VehicleType;
  role: StationRole;
  x: number;
  y: number;
  /** Manual elevation in meters; if unset, sampler / flat cruise is used. */
  z?: number;
  /** Stop dwell override in seconds; default from docking animation when cargo assumed. */
  dwellSeconds?: number;
  /**
   * @deprecated Prefer route `cargo.beltMk`. Kept optional for migrating old saves/shares.
   */
  beltMk?: BeltMk;
  /**
   * Total solid-item throughput at this station (items/min) —
   * input for pickup, output for dropoff.
   */
  itemsPerMin?: number;
}

export interface Waypoint {
  id: string;
  x: number;
  y: number;
  z?: number;
}

/**
 * Ordered route nodes. Station anchors reference shared station ids;
 * waypoints are free control points owned by the route.
 */
export type RouteNode =
  | { kind: 'station'; stationId: string }
  | { kind: 'waypoint'; waypointId: string };

export interface TrainConsist {
  locomotives: number;
  freightCars: number;
  /** 0 empty … 1 full */
  fillFraction: number;
}

export interface ProjectFlags {
  /** Build track entirely flat (no grades). */
  flatTrack: boolean;
  /** Cruise height used when flatTrack is on (meters). */
  cruiseHeight: number;
  /** Closed circuit (return to first station). */
  closedLoop: boolean;
}

export interface CargoSettings {
  /** Item stack size for freight capacity (ores=100, many parts=200/500). */
  stackSize: number;
  /** Auto-size engines/cars/fill from station I/O + round-trip time. */
  autoSizeConsist: boolean;
  /** Belt mark used at freight platforms on this route (shared across stations). */
  beltMk: BeltMk;
}

/**
 * One named path on the shared map. Vehicle type, path geometry, consist,
 * cargo, and flags are per-route so train and drone lines can coexist.
 */
export interface Route {
  id: string;
  name: string;
  vehicleType: VehicleType;
  /** Optional override; otherwise palette color from route index. */
  color?: string;
  waypoints: Waypoint[];
  route: RouteNode[];
  consist: TrainConsist;
  flags: ProjectFlags;
  cargo: CargoSettings;
}

/**
 * Project = shared world (stations) + many routes.
 *
 * Model choice: **shared station/port pool** on the map; each route owns its
 * ordered node list, waypoints, vehicleType, consist, cargo, and flags.
 * Stations may be linked from zero or more routes (typically matching vehicleType).
 */
export interface Project {
  version: 2;
  name: string;
  stations: Station[];
  routes: Route[];
  activeRouteId: string;
}

/**
 * Flattened view of one route + shared stations for path/sim/sizing/issues.
 * Physics helpers take this instead of the full multi-route Project.
 */
export interface RouteSimInput {
  stations: Station[];
  waypoints: Waypoint[];
  route: RouteNode[];
  vehicleType: VehicleType;
  consist: TrainConsist;
  flags: ProjectFlags;
  cargo: CargoSettings;
}

export const DEFAULT_DOCK_SECONDS = 27.08;

export const DEFAULT_CONSIST: TrainConsist = {
  locomotives: 1,
  freightCars: 4,
  fillFraction: 1,
};

export const DEFAULT_FLAGS: ProjectFlags = {
  flatTrack: true,
  cruiseHeight: 50,
  closedLoop: true,
};

export const DEFAULT_CARGO: CargoSettings = {
  stackSize: 100,
  autoSizeConsist: true,
  beltMk: 5,
};

function asBeltMk(value: unknown): BeltMk | undefined {
  const n = Number(value);
  if (n === 1 || n === 2 || n === 3 || n === 4 || n === 5 || n === 6) return n;
  return undefined;
}

function normalizeCargo(raw?: Partial<CargoSettings> | null): CargoSettings {
  return {
    stackSize: Math.max(1, Number(raw?.stackSize) || DEFAULT_CARGO.stackSize),
    autoSizeConsist:
      raw?.autoSizeConsist == null
        ? DEFAULT_CARGO.autoSizeConsist
        : !!raw.autoSizeConsist,
    beltMk: asBeltMk(raw?.beltMk) ?? DEFAULT_CARGO.beltMk,
  };
}

/** Distinct map colors for coexisting routes (active uses full opacity). */
export const ROUTE_COLOR_PALETTE = [
  '#d4a017', // amber (legacy single-route default)
  '#3d8bfd', // blue
  '#2db88a', // teal
  '#c45cde', // violet
  '#e07040', // coral
  '#5cb8b2', // cyan-gray
  '#e0a0c0', // rose
  '#8a9b4e', // olive
] as const;

export function routeColorAt(index: number, explicit?: string): string {
  if (explicit) return explicit;
  return ROUTE_COLOR_PALETTE[index % ROUTE_COLOR_PALETTE.length];
}

export function createEmptyRoute(
  name = 'Route 1',
  vehicleType: VehicleType = 'train',
): Route {
  return {
    id: newId('rt'),
    name,
    vehicleType,
    waypoints: [],
    route: [],
    consist: { ...DEFAULT_CONSIST },
    flags: { ...DEFAULT_FLAGS },
    cargo: { ...DEFAULT_CARGO },
  };
}

export function createEmptyProject(name = 'Untitled route'): Project {
  const route = createEmptyRoute('Route 1', 'train');
  return {
    version: 2,
    name,
    stations: [],
    routes: [route],
    activeRouteId: route.id,
  };
}

export function getRouteById(
  project: Project,
  routeId: string | null | undefined,
): Route | undefined {
  if (!routeId) return undefined;
  return project.routes.find((r) => r.id === routeId);
}

export function getActiveRoute(project: Project): Route {
  return (
    getRouteById(project, project.activeRouteId) ??
    project.routes[0] ??
    createEmptyRoute()
  );
}

/** Shared stations + one route’s path/settings for simulation helpers. */
export function toRouteSimInput(
  project: Project,
  route: Route = getActiveRoute(project),
): RouteSimInput {
  return {
    stations: project.stations,
    waypoints: route.waypoints,
    route: route.route,
    vehicleType: route.vehicleType,
    consist: route.consist,
    flags: route.flags,
    cargo: route.cargo,
  };
}

export function updateRouteInProject(
  project: Project,
  routeId: string,
  patch: Partial<Route> | ((route: Route) => Route),
): Project {
  return {
    ...project,
    routes: project.routes.map((r) => {
      if (r.id !== routeId) return r;
      return typeof patch === 'function' ? patch(r) : { ...r, ...patch };
    }),
  };
}

export function updateActiveRoute(
  project: Project,
  patch: Partial<Route> | ((route: Route) => Route),
): Project {
  const active = getActiveRoute(project);
  return updateRouteInProject(project, active.id, patch);
}

/** Stations referenced by a route’s ordered node list. */
export function stationsOnRoute(
  stations: Station[],
  route: RouteNode[],
): Station[] {
  const ids = new Set(
    route
      .filter((n): n is Extract<RouteNode, { kind: 'station' }> => n.kind === 'station')
      .map((n) => n.stationId),
  );
  return stations.filter((s) => ids.has(s.id));
}

function normalizeRoute(raw: Partial<Route> & { name?: string }, index: number): Route {
  const vehicleType: VehicleType =
    raw.vehicleType === 'drone' ? 'drone' : 'train';
  return {
    id: raw.id && typeof raw.id === 'string' ? raw.id : newId('rt'),
    name: raw.name?.trim() ? raw.name : `Route ${index + 1}`,
    vehicleType,
    color: raw.color,
    waypoints: Array.isArray(raw.waypoints) ? raw.waypoints : [],
    route: Array.isArray(raw.route) ? raw.route : [],
    consist: { ...DEFAULT_CONSIST, ...raw.consist },
    flags: { ...DEFAULT_FLAGS, ...raw.flags },
    cargo: normalizeCargo(raw.cargo),
  };
}

/**
 * Migrate v1 single-route projects and normalize v2 multi-route projects.
 * Old shape: { version:1, vehicleType, waypoints, route, consist, flags, cargo, stations }
 * New shape: { version:2, stations, routes[], activeRouteId }
 */
export function normalizeProject(data: unknown): Project {
  const raw = (data ?? {}) as Record<string, unknown>;
  const name =
    typeof raw.name === 'string' && raw.name.trim()
      ? raw.name
      : 'Untitled route';

  // Already multi-route (v2) or has routes array
  if (Array.isArray(raw.routes) && raw.routes.length > 0) {
    const routesRaw = raw.routes as Partial<Route>[];
    const routes = routesRaw.map((r, i) => normalizeRoute(r, i));
    const stationsRaw = Array.isArray(raw.stations)
      ? (raw.stations as Station[])
      : [];
    const activeRouteId =
      typeof raw.activeRouteId === 'string' &&
      routes.some((r) => r.id === raw.activeRouteId)
        ? raw.activeRouteId
        : routes[0].id;

    const stations = stationsRaw.map((s) => {
      const fallbackVt =
        getRouteById(
          { version: 2, name, stations: [], routes, activeRouteId },
          activeRouteId,
        )?.vehicleType ?? 'train';
      return {
        ...s,
        vehicleType:
          s.vehicleType === 'drone' || s.vehicleType === 'train'
            ? s.vehicleType
            : fallbackVt,
      };
    });

    return migrateStationBeltsToCargo({
      version: 2,
      name,
      stations,
      routes,
      activeRouteId,
    }, routesRaw);
  }

  // Legacy v1 single-route → one-element routes[]
  const vehicleType: VehicleType =
    raw.vehicleType === 'drone' ? 'drone' : 'train';
  const stations = (
    Array.isArray(raw.stations) ? (raw.stations as Station[]) : []
  ).map((s) => ({
    ...s,
    vehicleType:
      s.vehicleType === 'drone' || s.vehicleType === 'train'
        ? s.vehicleType
        : vehicleType,
  }));

  const routeRaw = {
    id: newId('rt'),
    name: 'Route 1',
    vehicleType,
    waypoints: Array.isArray(raw.waypoints)
      ? (raw.waypoints as Waypoint[])
      : [],
    route: Array.isArray(raw.route) ? (raw.route as RouteNode[]) : [],
    consist: raw.consist as TrainConsist | undefined,
    flags: raw.flags as ProjectFlags | undefined,
    cargo: raw.cargo as CargoSettings | undefined,
  };
  const route = normalizeRoute(routeRaw, 0);

  return migrateStationBeltsToCargo(
    {
      version: 2,
      name,
      stations,
      routes: [route],
      activeRouteId: route.id,
    },
    [routeRaw],
  );
}

/**
 * Lift legacy per-station beltMk onto route cargo (once) and strip station fields.
 */
function migrateStationBeltsToCargo(
  project: Project,
  routesRaw: Partial<Route>[],
): Project {
  let inherited: BeltMk | undefined;
  for (const s of project.stations) {
    const mk = asBeltMk(s.beltMk);
    if (mk != null && (inherited == null || mk > inherited)) inherited = mk;
  }

  const stations = project.stations.map((s) => {
    if (s.beltMk == null) return s;
    const { beltMk: _removed, ...rest } = s;
    return rest;
  });

  if (inherited == null) {
    return { ...project, stations };
  }

  const routes = project.routes.map((route, i) => {
    if (route.vehicleType !== 'train') return route;
    const rawCargo = routesRaw[i]?.cargo;
    const hadExplicit =
      rawCargo != null &&
      typeof rawCargo === 'object' &&
      'beltMk' in rawCargo &&
      asBeltMk((rawCargo as CargoSettings).beltMk) != null;
    if (hadExplicit) return route;
    return {
      ...route,
      cargo: { ...route.cargo, beltMk: inherited! },
    };
  });

  return { ...project, stations, routes };
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
