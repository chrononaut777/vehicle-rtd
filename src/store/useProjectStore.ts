import { create } from 'zustand';
import {
  createEmptyProject,
  createEmptyRoute,
  getActiveRoute,
  newId,
  normalizeProject,
  toRouteSimInput,
  updateActiveRoute,
  updateRouteInProject,
  type CargoSettings,
  type Project,
  type Route,
  type RouteNode,
  type Station,
  type StationRole,
  type TrainConsist,
  type VehicleType,
  type Waypoint,
} from '../domain/types';
import { clampToWorld } from '../domain/world';
import { detectIssues, type Issue } from '../issues/detect';
import { simulateTrip, type TripResult } from '../physics/simulateTrip';
import {
  applySizingToConsist,
  consistChanged,
  sizeConsistFromThroughput,
  type ConsistSizing,
} from '../physics/sizeConsist';
import {
  sizeDroneFromThroughput,
  type DroneSizing,
} from '../physics/sizeDrone';
import {
  downloadJson,
  importProjectJson,
  loadProject,
  saveProject,
} from '../persist/storage';
import {
  applyShareToLocation,
  readShareFromLocation,
} from '../persist/shareUrl';
import {
  insertAfterRouteIndex,
  segmentRouteBounds,
} from '../physics/path';
import {
  getCachedHeightmap,
  loadHeightmap,
  type Heightmap,
} from '../terrain/heightmap';

type ToolMode = 'pan' | 'place-station' | 'add-waypoint' | 'link-route';

function pruneWaypoints(route: RouteNode[], waypoints: Waypoint[]) {
  const used = new Set(
    route
      .filter((n): n is Extract<RouteNode, { kind: 'waypoint' }> => n.kind === 'waypoint')
      .map((n) => n.waypointId),
  );
  return waypoints.filter((w) => used.has(w.id));
}

/** Persist station/waypoint Z to cruise so flat mode stays consistent on export / toggle-off. */
function withCruiseHeights(project: Project, routeId: string, z: number): Project {
  const route = project.routes.find((r) => r.id === routeId);
  if (!route) return project;
  const onRoute = new Set(
    route.route
      .filter((n): n is Extract<RouteNode, { kind: 'station' }> => n.kind === 'station')
      .map((n) => n.stationId),
  );
  return updateRouteInProject(
    {
      ...project,
      stations: project.stations.map((s) =>
        onRoute.has(s.id) ? { ...s, z } : s,
      ),
    },
    routeId,
    {
      waypoints: route.waypoints.map((w) => ({ ...w, z })),
    },
  );
}

const MAX_HISTORY = 50;

function cloneProject(project: Project): Project {
  return structuredClone(project);
}

export interface RouteTripSummary {
  routeId: string;
  name: string;
  vehicleType: VehicleType;
  trip: TripResult;
  sizing: ConsistSizing | null;
  droneSizing: DroneSizing | null;
}

/** Station/port details reusable on paste (no id or map position). */
export type StationClipboard = Omit<Station, 'id' | 'x' | 'y'>;

interface ProjectState {
  project: Project;
  selectedStationId: string | null;
  selectedWaypointId: string | null;
  tool: ToolMode;
  cursor: { x: number; y: number } | null;
  heightmap: Heightmap | null;
  hydrated: boolean;
  /** Active route trip (sidebar detail). */
  trip: TripResult | null;
  issues: Issue[];
  statusMessage: string | null;
  sizing: ConsistSizing | null;
  droneSizing: DroneSizing | null;
  /** All routes’ RT summaries for the optional overview. */
  routeSummaries: RouteTripSummary[];
  /** Map spotlight for a clicked issue (nonce retriggers fly-to). */
  mapFocus: { x: number; y: number; issueId?: string; nonce: number } | null;
  /** Copied station/port template for paste / next place. */
  stationClipboard: StationClipboard | null;
  past: Project[];
  future: Project[];

  hydrate: () => Promise<void>;
  setTool: (tool: ToolMode) => void;
  setCursor: (x: number, y: number) => void;
  focusOnMap: (x: number, y: number, issueId?: string) => void;
  clearMapFocus: () => void;
  setProjectName: (name: string) => void;
  setActiveRoute: (routeId: string) => void;
  addRoute: (vehicleType?: VehicleType) => void;
  renameRoute: (routeId: string, name: string) => void;
  deleteRoute: (routeId: string) => void;
  duplicateRoute: (routeId: string) => void;
  setVehicleType: (vehicleType: VehicleType) => void;
  placeStationAt: (x: number, y: number) => void;
  /** Copy selected (or given) station details into the clipboard. */
  copyStation: (id?: string) => void;
  /** Paste clipboard station at cursor, near selection, or explicit coords. */
  pasteStation: (x?: number, y?: number) => void;
  updateStation: (id: string, patch: Partial<Station>) => void;
  removeStation: (id: string) => void;
  selectStation: (id: string | null) => void;
  selectWaypoint: (id: string | null) => void;
  moveStation: (id: string, x: number, y: number) => void;
  addWaypointAt: (x: number, y: number, afterIndex?: number) => void;
  moveWaypoint: (id: string, x: number, y: number) => void;
  removeWaypoint: (id: string) => void;
  insertWaypointOnSegment: (segmentIndex: number, x: number, y: number) => void;
  setConsist: (consist: Partial<TrainConsist>) => void;
  setCargo: (cargo: Partial<CargoSettings>) => void;
  setFlatTrack: (flat: boolean) => void;
  setCruiseHeight: (h: number) => void;
  setClosedLoop: (closed: boolean) => void;
  /** Append a station stop to the active route (link-route tool / re-add). */
  appendStationToRoute: (stationId: string) => void;
  /** Remove one route node; stations stay on the map, orphan waypoints deleted. */
  removeRouteNodeAt: (index: number) => void;
  /** Reorder a route node (DnD / ↑↓). */
  moveRouteNode: (fromIndex: number, toIndex: number) => void;
  /** Reverse visit order of the active route (flips travel direction / map arrows). */
  reverseActiveRoute: () => void;
  /** Delete the track hop at a polyline segment (waypoints, or unlink next stop). */
  removeRouteSegment: (segmentIndex: number) => void;
  /** Append every matching-type station not currently on the active route. */
  appendUnlinkedStations: () => void;
  /** Delete selected waypoint, or unlink selected station from the route. */
  deleteSelection: () => void;
  clearRoute: () => void;
  rebuildDerived: () => void;
  exportJson: () => void;
  importJsonText: (text: string) => void;
  copyShareLink: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  persist: () => void;
}

function recomputeRoute(
  project: Project,
  route: Route,
  heightmap: Heightmap | null,
): {
  route: Route;
  trip: TripResult;
  issues: Issue[];
  sizing: ConsistSizing | null;
  droneSizing: DroneSizing | null;
} {
  let current = route;
  let input = toRouteSimInput(project, current);
  let trip = simulateTrip(input);
  let sizing: ConsistSizing | null = null;
  let droneSizing: DroneSizing | null = null;

  if (current.vehicleType === 'drone') {
    if (trip.ok) {
      droneSizing = sizeDroneFromThroughput(input, trip.totalRoundTripSeconds);
    }
  } else if (current.cargo.autoSizeConsist && trip.ok) {
    for (let i = 0; i < 2; i++) {
      const nextSizing = sizeConsistFromThroughput(
        input,
        trip.totalRoundTripSeconds,
      );
      if (!nextSizing) break;
      sizing = nextSizing;
      const nextConsist = applySizingToConsist(nextSizing);
      if (!consistChanged(current.consist, nextConsist)) break;
      current = { ...current, consist: nextConsist };
      input = toRouteSimInput(project, current);
      trip = simulateTrip(input);
    }
  } else if (trip.ok) {
    sizing = sizeConsistFromThroughput(input, trip.totalRoundTripSeconds);
  }

  const prefix = project.routes.length > 1 ? `${current.id}:` : '';
  const baseIssues = detectIssues(input, heightmap, prefix);
  const sizeIssues =
    (current.vehicleType === 'drone'
      ? droneSizing?.warnings
      : sizing?.warnings
    )?.map((message, idx) => ({
      id: `${prefix}belt-ceil-${idx}`,
      severity: 'warning' as const,
      message:
        project.routes.length > 1
          ? `[${current.name}] ${message}`
          : message,
    })) ?? [];

  const issues =
    project.routes.length > 1
      ? baseIssues.map((iss) =>
          iss.severity === 'info'
            ? iss
            : {
                ...iss,
                message: iss.message.startsWith('[')
                  ? iss.message
                  : `[${current.name}] ${iss.message}`,
              },
        )
      : baseIssues;

  return {
    route: current,
    trip,
    issues: [...issues, ...sizeIssues],
    sizing,
    droneSizing,
  };
}

function recompute(projectIn: Project, heightmap: Heightmap | null) {
  let project = normalizeProject(projectIn);
  const routeResults = project.routes.map((route) =>
    recomputeRoute(project, route, heightmap),
  );

  project = {
    ...project,
    routes: routeResults.map((r) => r.route),
  };

  const activeId = project.activeRouteId;
  const activeIdx = Math.max(
    0,
    routeResults.findIndex((r) => r.route.id === activeId),
  );
  const active = routeResults[activeIdx] ?? routeResults[0];

  const routeSummaries: RouteTripSummary[] = routeResults.map((r) => ({
    routeId: r.route.id,
    name: r.route.name,
    vehicleType: r.route.vehicleType,
    trip: r.trip,
    sizing: r.sizing,
    droneSizing: r.droneSizing,
  }));

  // Sidebar issues: active route first, then other routes’ warnings/errors only.
  const activeIssues = active?.issues ?? [];
  const otherIssues = routeResults
    .filter((r) => r.route.id !== active?.route.id)
    .flatMap((r) =>
      r.issues.filter((i) => i.severity === 'warning' || i.severity === 'error'),
    );

  return {
    project,
    trip: active?.trip ?? null,
    issues: [...activeIssues, ...otherIssues],
    sizing: active?.sizing ?? null,
    droneSizing: active?.droneSizing ?? null,
    routeSummaries,
  };
}

export const useProjectStore = create<ProjectState>((set, get) => {
  const commitProject = (
    next: Project,
    extra: Partial<ProjectState> = {},
  ) => {
    const { project, heightmap, past } = get();
    const derived = recompute(next, heightmap);
    set({
      past: [...past, cloneProject(project)].slice(-MAX_HISTORY),
      future: [],
      statusMessage: null,
      ...extra,
      ...derived,
    });
    get().persist();
  };

  return {
    project: createEmptyProject(),
    selectedStationId: null,
    selectedWaypointId: null,
    tool: 'pan',
    cursor: null,
    heightmap: null,
    hydrated: false,
    trip: null,
    issues: [],
    statusMessage: null,
    sizing: null,
    droneSizing: null,
    routeSummaries: [],
    mapFocus: null,
    stationClipboard: null,
    past: [],
    future: [],

    async hydrate() {
      const hm = await loadHeightmap();
      const fromUrl = readShareFromLocation();
      const project = fromUrl ?? (await loadProject());
      const derived = recompute(project, hm);
      set({
        heightmap: hm ?? getCachedHeightmap(),
        hydrated: true,
        past: [],
        future: [],
        ...derived,
        statusMessage: fromUrl ? 'Loaded route from share link' : null,
      });
    },

    setTool(tool) {
      set({ tool });
    },

    setCursor(x, y) {
      set({ cursor: { x, y } });
    },

    focusOnMap(x, y, issueId) {
      set({
        mapFocus: {
          x,
          y,
          issueId,
          nonce: (get().mapFocus?.nonce ?? 0) + 1,
        },
      });
    },

    clearMapFocus() {
      set({ mapFocus: null });
    },

    setProjectName(name) {
      commitProject({ ...get().project, name });
    },

    setActiveRoute(routeId) {
      const { project, heightmap } = get();
      if (!project.routes.some((r) => r.id === routeId)) return;
      if (project.activeRouteId === routeId) return;
      // Selection-only — do not push onto undo history.
      const derived = recompute(
        { ...project, activeRouteId: routeId },
        heightmap,
      );
      set({
        ...derived,
        selectedWaypointId: null,
        statusMessage: null,
      });
      get().persist();
    },

    addRoute(vehicleType) {
      const { project } = get();
      const active = getActiveRoute(project);
      const vt = vehicleType ?? active.vehicleType;
      const n = project.routes.length + 1;
      const route = createEmptyRoute(`Route ${n}`, vt);
      commitProject(
        {
          ...project,
          routes: [...project.routes, route],
          activeRouteId: route.id,
        },
        {
          selectedWaypointId: null,
          statusMessage: `Added ${route.name}`,
        },
      );
    },

    renameRoute(routeId, name) {
      const trimmed = name.trim();
      if (!trimmed) return;
      commitProject(updateRouteInProject(get().project, routeId, { name: trimmed }));
    },

    deleteRoute(routeId) {
      const { project } = get();
      if (project.routes.length <= 1) {
        set({ statusMessage: 'Cannot delete the last route' });
        return;
      }
      const routes = project.routes.filter((r) => r.id !== routeId);
      const activeRouteId =
        project.activeRouteId === routeId ? routes[0].id : project.activeRouteId;
      commitProject(
        { ...project, routes, activeRouteId },
        { selectedWaypointId: null, statusMessage: 'Route deleted' },
      );
    },

    duplicateRoute(routeId) {
      const { project } = get();
      const source = project.routes.find((r) => r.id === routeId);
      if (!source) return;
      const wpIdMap = new Map<string, string>();
      const waypoints = source.waypoints.map((w) => {
        const id = newId('wp');
        wpIdMap.set(w.id, id);
        return { ...w, id };
      });
      const routeNodes: RouteNode[] = source.route.map((n) => {
        if (n.kind === 'station') return { ...n };
        const mapped = wpIdMap.get(n.waypointId);
        return { kind: 'waypoint', waypointId: mapped ?? n.waypointId };
      });
      const copy: Route = {
        ...structuredClone(source),
        id: newId('rt'),
        name: `${source.name} copy`,
        waypoints,
        route: routeNodes,
        color: undefined,
      };
      commitProject(
        {
          ...project,
          routes: [...project.routes, copy],
          activeRouteId: copy.id,
        },
        {
          selectedWaypointId: null,
          statusMessage: `Duplicated ${source.name}`,
        },
      );
    },

    setVehicleType(vehicleType) {
      const { project } = get();
      const active = getActiveRoute(project);
      if (active.vehicleType === vehicleType) return;
      const stopLabel = vehicleType === 'drone' ? 'Port' : 'Station';
      // Relabel default names on stations that match the previous vehicle type
      // and are linked on this route (or unlinked of that type).
      const onActive = new Set(
        active.route
          .filter((n): n is Extract<RouteNode, { kind: 'station' }> => n.kind === 'station')
          .map((n) => n.stationId),
      );
      commitProject(
        updateActiveRoute(
          {
            ...project,
            stations: project.stations.map((s, i) => {
              if (s.vehicleType !== active.vehicleType) return s;
              if (onActive.size > 0 && !onActive.has(s.id)) return s;
              const next = { ...s, vehicleType };
              if (/^(Station|Port) \d+$/.test(s.name)) {
                next.name = `${stopLabel} ${i + 1}`;
              }
              return next;
            }),
          },
          { vehicleType },
        ),
      );
    },

    placeStationAt(x, y) {
      const c = clampToWorld(x, y);
      const { project, stationClipboard } = get();
      const active = getActiveRoute(project);
      const n = project.stations.length + 1;
      const stopLabel = active.vehicleType === 'drone' ? 'Port' : 'Station';
      const clip =
        stationClipboard &&
        stationClipboard.vehicleType === active.vehicleType
          ? stationClipboard
          : null;
      const station: Station = {
        id: newId('st'),
        name: clip?.name ?? `${stopLabel} ${n}`,
        vehicleType: active.vehicleType,
        role: clip?.role ?? 'both',
        x: c.x,
        y: c.y,
        z: clip?.z ?? active.flags.cruiseHeight,
        dwellSeconds: clip?.dwellSeconds,
        itemsPerMin: clip?.itemsPerMin,
      };
      const next: Project = {
        ...project,
        stations: [...project.stations, station],
      };
      commitProject(next, {
        selectedStationId: station.id,
        selectedWaypointId: null,
        statusMessage: clip
          ? `Placed copy of “${clip.name}”`
          : null,
      });
    },

    copyStation(id) {
      const { project, selectedStationId } = get();
      const targetId = id ?? selectedStationId;
      if (!targetId) {
        set({ statusMessage: 'Select a station or port to copy' });
        return;
      }
      const source = project.stations.find((s) => s.id === targetId);
      if (!source) return;
      const clipboard: StationClipboard = {
        name: source.name,
        vehicleType: source.vehicleType,
        role: source.role,
        z: source.z,
        dwellSeconds: source.dwellSeconds,
        itemsPerMin: source.itemsPerMin,
      };
      set({
        stationClipboard: clipboard,
        statusMessage: `Copied “${source.name}” — Paste (Ctrl+V) or Place to reuse details`,
      });
    },

    pasteStation(x, y) {
      const { stationClipboard, cursor, selectedStationId, project } = get();
      if (!stationClipboard) {
        set({ statusMessage: 'Nothing copied — select a stop and Copy first' });
        return;
      }
      let px = x;
      let py = y;
      if (px == null || py == null) {
        if (cursor) {
          px = cursor.x;
          py = cursor.y;
        } else if (selectedStationId) {
          const sel = project.stations.find((s) => s.id === selectedStationId);
          if (sel) {
            px = sel.x + 50;
            py = sel.y + 50;
          }
        }
      }
      if (px == null || py == null) {
        const src = project.stations.find(
          (s) =>
            s.name === stationClipboard.name &&
            s.vehicleType === stationClipboard.vehicleType,
        );
        px = (src?.x ?? 0) + 50;
        py = (src?.y ?? 0) + 50;
      }
      // Ensure place uses clipboard even if vehicle type on active route differs:
      // temporarily align clipboard vehicle to active, or place with clipboard type.
      const active = getActiveRoute(project);
      if (stationClipboard.vehicleType !== active.vehicleType) {
        set({
          statusMessage: `Clipboard is a ${stationClipboard.vehicleType} stop — switch route type or copy a matching stop`,
        });
        return;
      }
      get().placeStationAt(px, py);
    },

    updateStation(id, patch) {
      const project = {
        ...get().project,
        stations: get().project.stations.map((s) =>
          s.id === id ? { ...s, ...patch } : s,
        ),
      };
      commitProject(project);
    },

    removeStation(id) {
      const { project } = get();
      const next: Project = {
        ...project,
        stations: project.stations.filter((s) => s.id !== id),
        routes: project.routes.map((r) => ({
          ...r,
          route: r.route.filter(
            (n) => !(n.kind === 'station' && n.stationId === id),
          ),
        })),
      };
      commitProject(next, {
        selectedStationId:
          get().selectedStationId === id ? null : get().selectedStationId,
      });
    },

    selectStation(id) {
      set({ selectedStationId: id, selectedWaypointId: null });
    },

    selectWaypoint(id) {
      set({ selectedWaypointId: id, selectedStationId: null });
    },

    moveStation(id, x, y) {
      const c = clampToWorld(x, y);
      get().updateStation(id, { x: c.x, y: c.y });
    },

    addWaypointAt(x, y, afterIndex) {
      const c = clampToWorld(x, y);
      const { project } = get();
      const active = getActiveRoute(project);
      const wp: Waypoint = {
        id: newId('wp'),
        x: c.x,
        y: c.y,
        z: active.flags.cruiseHeight,
      };
      const route = [...active.route];
      const node = { kind: 'waypoint' as const, waypointId: wp.id };
      if (afterIndex == null || afterIndex < 0 || afterIndex >= route.length) {
        route.push(node);
      } else {
        route.splice(afterIndex + 1, 0, node);
      }
      commitProject(
        updateActiveRoute(project, {
          waypoints: [...active.waypoints, wp],
          route,
        }),
        {
          selectedWaypointId: wp.id,
          selectedStationId: null,
        },
      );
    },

    moveWaypoint(id, x, y) {
      const c = clampToWorld(x, y);
      const { project } = get();
      // Waypoints are owned by a route — find which one.
      const owner = project.routes.find((r) =>
        r.waypoints.some((w) => w.id === id),
      );
      if (!owner) return;
      commitProject(
        updateRouteInProject(project, owner.id, {
          waypoints: owner.waypoints.map((w) =>
            w.id === id ? { ...w, x: c.x, y: c.y } : w,
          ),
        }),
      );
    },

    removeWaypoint(id) {
      const { project } = get();
      const owner = project.routes.find((r) =>
        r.waypoints.some((w) => w.id === id),
      );
      if (!owner) return;
      commitProject(
        updateRouteInProject(project, owner.id, {
          waypoints: owner.waypoints.filter((w) => w.id !== id),
          route: owner.route.filter(
            (n) => !(n.kind === 'waypoint' && n.waypointId === id),
          ),
        }),
        {
          selectedWaypointId:
            get().selectedWaypointId === id ? null : get().selectedWaypointId,
        },
      );
    },

    insertWaypointOnSegment(segmentIndex, x, y) {
      const { project } = get();
      const after = insertAfterRouteIndex(toRouteSimInput(project), segmentIndex);
      get().addWaypointAt(x, y, after);
    },

    setConsist(consist) {
      const { project } = get();
      const active = getActiveRoute(project);
      commitProject(
        updateActiveRoute(project, {
          consist: { ...active.consist, ...consist },
          cargo: { ...active.cargo, autoSizeConsist: false },
        }),
      );
    },

    setCargo(cargo) {
      const { project } = get();
      const active = getActiveRoute(project);
      commitProject(
        updateActiveRoute(project, {
          cargo: { ...active.cargo, ...cargo },
        }),
      );
    },

    setFlatTrack(flat) {
      const { project } = get();
      const active = getActiveRoute(project);
      let next = updateActiveRoute(project, {
        flags: { ...active.flags, flatTrack: flat },
      });
      if (flat) {
        next = withCruiseHeights(next, active.id, active.flags.cruiseHeight);
      }
      commitProject(next);
    },

    setCruiseHeight(h) {
      const { project } = get();
      const active = getActiveRoute(project);
      let next = updateActiveRoute(project, {
        flags: { ...active.flags, cruiseHeight: h },
      });
      if (active.flags.flatTrack) {
        next = withCruiseHeights(next, active.id, h);
      }
      commitProject(next);
    },

    setClosedLoop(closed) {
      const { project } = get();
      const active = getActiveRoute(project);
      commitProject(
        updateActiveRoute(project, {
          flags: { ...active.flags, closedLoop: closed },
        }),
      );
    },

    appendStationToRoute(stationId) {
      const { project } = get();
      const active = getActiveRoute(project);
      const station = project.stations.find((s) => s.id === stationId);
      if (!station) return;
      if (station.vehicleType !== active.vehicleType) {
        const want = active.vehicleType === 'drone' ? 'port' : 'station';
        set({
          statusMessage: `This stop is a ${station.vehicleType === 'drone' ? 'port' : 'station'}; active route expects a ${want}`,
        });
        return;
      }
      const last = active.route[active.route.length - 1];
      if (
        last?.kind === 'station' &&
        last.stationId === stationId &&
        active.route.length > 0
      ) {
        const stop = active.vehicleType === 'drone' ? 'Port' : 'Station';
        set({
          statusMessage: `${stop} is already the last stop on the route`,
        });
        return;
      }
      commitProject(
        updateActiveRoute(project, {
          route: [...active.route, { kind: 'station', stationId }],
        }),
        {
          selectedStationId: stationId,
          selectedWaypointId: null,
          statusMessage: null,
        },
      );
    },

    removeRouteNodeAt(index) {
      const { project } = get();
      const active = getActiveRoute(project);
      if (index < 0 || index >= active.route.length) return;
      const route = active.route.filter((_, i) => i !== index);
      const removed = active.route[index];
      commitProject(
        updateActiveRoute(project, {
          route,
          waypoints: pruneWaypoints(route, active.waypoints),
        }),
        {
          selectedWaypointId:
            removed?.kind === 'waypoint' &&
            get().selectedWaypointId === removed.waypointId
              ? null
              : get().selectedWaypointId,
        },
      );
    },

    moveRouteNode(fromIndex, toIndex) {
      const { project } = get();
      const active = getActiveRoute(project);
      const len = active.route.length;
      if (
        fromIndex < 0 ||
        fromIndex >= len ||
        toIndex < 0 ||
        toIndex >= len ||
        fromIndex === toIndex
      ) {
        return;
      }
      const route = [...active.route];
      const [node] = route.splice(fromIndex, 1);
      route.splice(toIndex, 0, node);
      commitProject(updateActiveRoute(project, { route }));
    },

    reverseActiveRoute() {
      const { project } = get();
      const active = getActiveRoute(project);
      if (active.route.length < 2) return;
      // Preserve node identities; reverse visit sequence so travel (and arrows) flip.
      // Closed loops keep closedLoop — travel simply runs the circuit the other way.
      commitProject(
        updateActiveRoute(project, { route: [...active.route].reverse() }),
      );
    },

    removeRouteSegment(segmentIndex) {
      const { project } = get();
      const active = getActiveRoute(project);
      const input = toRouteSimInput(project, active);
      const bounds = segmentRouteBounds(input, segmentIndex);
      if (!bounds || bounds.startRouteIndex < 0) return;

      const { startRouteIndex, endRouteIndex } = bounds;
      let route = [...active.route];
      let flags = active.flags;

      if (endRouteIndex === -1) {
        const removed = route.splice(startRouteIndex + 1);
        const hadWaypoints = removed.some((n) => n.kind === 'waypoint');
        if (!hadWaypoints) {
          flags = { ...flags, closedLoop: false };
        }
      } else if (endRouteIndex > startRouteIndex) {
        const between = endRouteIndex - startRouteIndex - 1;
        if (between > 0) {
          route.splice(startRouteIndex + 1, between);
        } else {
          route.splice(endRouteIndex, 1);
        }
      } else {
        return;
      }

      commitProject(
        updateActiveRoute(project, {
          route,
          flags,
          waypoints: pruneWaypoints(route, active.waypoints),
        }),
      );
    },

    appendUnlinkedStations() {
      const { project } = get();
      const active = getActiveRoute(project);
      const onRoute = new Set(
        active.route
          .filter(
            (n): n is Extract<RouteNode, { kind: 'station' }> =>
              n.kind === 'station',
          )
          .map((n) => n.stationId),
      );
      const extra = project.stations
        .filter(
          (s) =>
            s.vehicleType === active.vehicleType && !onRoute.has(s.id),
        )
        .map((s) => ({ kind: 'station' as const, stationId: s.id }));
      if (extra.length === 0) {
        const plural =
          active.vehicleType === 'drone' ? 'ports' : 'stations';
        set({ statusMessage: `All ${plural} are already on the route` });
        return;
      }
      const unit =
        active.vehicleType === 'drone' ? 'port(s)' : 'station(s)';
      commitProject(
        updateActiveRoute(project, {
          route: [...active.route, ...extra],
        }),
        { statusMessage: `Added ${extra.length} ${unit} to the route` },
      );
    },

    deleteSelection() {
      const { selectedWaypointId, selectedStationId, project } = get();
      if (selectedWaypointId) {
        get().removeWaypoint(selectedWaypointId);
        return;
      }
      if (selectedStationId) {
        const active = getActiveRoute(project);
        const idx = active.route.findIndex(
          (n) => n.kind === 'station' && n.stationId === selectedStationId,
        );
        if (idx >= 0) {
          get().removeRouteNodeAt(idx);
          return;
        }
        get().removeStation(selectedStationId);
      }
    },

    clearRoute() {
      commitProject(
        updateActiveRoute(get().project, {
          route: [],
          waypoints: [],
        }),
      );
    },

    rebuildDerived() {
      const derived = recompute(get().project, get().heightmap);
      set(derived);
    },

    exportJson() {
      downloadJson(get().project);
    },

    importJsonText(text) {
      const project = importProjectJson(text);
      commitProject(project, { statusMessage: 'Imported project' });
    },

    async copyShareLink() {
      const { ok, length } = applyShareToLocation(get().project);
      if (!ok) {
        set({
          statusMessage: `Route too large for URL (${length} chars). Use JSON export instead.`,
        });
        return;
      }
      const url = window.location.href;
      try {
        await navigator.clipboard.writeText(url);
        set({
          statusMessage: `Share link copied (${length.toLocaleString()} chars)`,
        });
      } catch {
        set({ statusMessage: 'Share hash set in URL — copy from address bar' });
      }
    },

    undo() {
      const { past, project, future, heightmap } = get();
      if (past.length === 0) return;
      const previous = past[past.length - 1];
      const derived = recompute(previous, heightmap);
      set({
        past: past.slice(0, -1),
        future: [...future, cloneProject(project)].slice(-MAX_HISTORY),
        selectedStationId: null,
        selectedWaypointId: null,
        ...derived,
        statusMessage: 'Undid last change',
      });
      get().persist();
    },

    redo() {
      const { past, project, future, heightmap } = get();
      if (future.length === 0) return;
      const next = future[future.length - 1];
      const derived = recompute(next, heightmap);
      set({
        future: future.slice(0, -1),
        past: [...past, cloneProject(project)].slice(-MAX_HISTORY),
        selectedStationId: null,
        selectedWaypointId: null,
        ...derived,
        statusMessage: 'Redid last change',
      });
      get().persist();
    },

    persist() {
      void saveProject(get().project);
    },
  };
});

export type { ToolMode, StationRole };
