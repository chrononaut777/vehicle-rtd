import { useEffect, useMemo, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  useMapEvents,
  useMap,
  AttributionControl,
  ZoomControl,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  gameToLatLng,
  latLngToGame,
  worldBoundsLatLng,
  mapCenterLatLng,
  WORLD,
  clampToWorld,
  scimTileUrl,
  SCIM_ATTRIBUTION,
  MIN_TILE_ZOOM,
  MAX_TILE_ZOOM,
} from '../domain/world';
import {
  getActiveRoute,
  routeColorAt,
  toRouteSimInput,
  type Route,
  type Station,
} from '../domain/types';
import { createMapOptions } from './crs';
import { useProjectStore } from '../store/useProjectStore';
import { useUiStore } from '../store/useUiStore';
import { resolveRouteDetailed, resolveRoutePoints } from '../physics/path';
import {
  buildIssueMapHighlights,
  routeColorFor,
  type IssueMapHighlights,
} from '../issues/mapHighlights';
import type { MapIssueSeverity } from '../issues/detect';
import ResourceNodesLayer from './ResourceNodesLayer';
import IssueFocusLayer from './IssueFocusLayer';

const markerByKey = new Map<string, L.Marker>();
const lineByKey = new Map<string, L.Polyline>();

function markerKey(kind: 'station' | 'waypoint', id: string) {
  return `${kind}:${id}`;
}

type GroupDrag = {
  originX: number;
  originY: number;
  peers: { key: string; x: number; y: number }[];
  lineVerts: { x: number; y: number; move: boolean }[][];
  mids: {
    index: number;
    x: number;
    y: number;
    selected: boolean;
    anchor: boolean;
  }[];
};

/** Imperative group drag so React doesn't reset the marker mid-gesture. */
let groupDrag: GroupDrag | null = null;

function beginGroupDrag(
  kind: 'station' | 'waypoint' | 'mid',
  id: string,
): boolean {
  const {
    project,
    selectedStationIds,
    selectedWaypointIds,
    selectedMidpointIndices,
  } = useProjectStore.getState();
  const midIndex = kind === 'mid' ? Number(id) : -1;
  const selected =
    (kind === 'station' && selectedStationIds.includes(id)) ||
    (kind === 'waypoint' && selectedWaypointIds.includes(id)) ||
    (kind === 'mid' && selectedMidpointIndices.includes(midIndex));
  const total =
    selectedStationIds.length +
    selectedWaypointIds.length +
    selectedMidpointIndices.length;
  if (!selected || total < 2) {
    groupDrag = null;
    return false;
  }
  const active = getActiveRoute(project);
  const detailed = resolveRouteDetailed(toRouteSimInput(project, active));
  let originX = 0;
  let originY = 0;
  if (kind === 'station') {
    const s = project.stations.find((st) => st.id === id);
    if (!s) return false;
    originX = s.x;
    originY = s.y;
  } else if (kind === 'waypoint') {
    const w = active.waypoints.find((wp) => wp.id === id);
    if (!w) return false;
    originX = w.x;
    originY = w.y;
  } else {
    const a = detailed.points[midIndex];
    const b = detailed.points[midIndex + 1];
    if (!a || !b) return false;
    originX = (a.x + b.x) / 2;
    originY = (a.y + b.y) / 2;
  }

  const peers: GroupDrag['peers'] = [];
  for (const sid of selectedStationIds) {
    if (kind === 'station' && sid === id) continue;
    const s = project.stations.find((st) => st.id === sid);
    if (s) peers.push({ key: markerKey('station', sid), x: s.x, y: s.y });
  }
  for (const wid of selectedWaypointIds) {
    if (kind === 'waypoint' && wid === id) continue;
    const w = active.waypoints.find((wp) => wp.id === wid);
    if (w) peers.push({ key: markerKey('waypoint', wid), x: w.x, y: w.y });
  }

  const stationIds = new Set(selectedStationIds);
  const waypointIds = new Set(selectedWaypointIds);
  const midSet = new Set(selectedMidpointIndices);
  const lineVerts: GroupDrag['lineVerts'] = [];
  const mids: GroupDrag['mids'] = [];
  for (let i = 0; i < detailed.points.length - 1; i++) {
    const seg = [0, 1].map((off) => {
      const p = detailed.points[i + off];
      const ri = detailed.routeIndex[i + off];
      const node = ri >= 0 ? active.route[ri] : undefined;
      const move =
        !!node &&
        ((node.kind === 'station' && stationIds.has(node.stationId)) ||
          (node.kind === 'waypoint' && waypointIds.has(node.waypointId)));
      return { x: p.x, y: p.y, move };
    });
    lineVerts.push(seg);
    const anchor = kind === 'mid' && i === midIndex;
    mids.push({
      index: i,
      x: (seg[0].x + seg[1].x) / 2,
      y: (seg[0].y + seg[1].y) / 2,
      selected: midSet.has(i) || anchor,
      anchor,
    });
  }

  groupDrag = { originX, originY, peers, lineVerts, mids };
  return true;
}

function previewGroupDrag(x: number, y: number) {
  if (!groupDrag) return;
  const dx = x - groupDrag.originX;
  const dy = y - groupDrag.originY;
  for (const peer of groupDrag.peers) {
    const marker = markerByKey.get(peer.key);
    if (!marker) continue;
    const c = clampToWorld(peer.x + dx, peer.y + dy);
    marker.setLatLng(gameToLatLng(c.x, c.y));
  }
  groupDrag.lineVerts.forEach((seg, i) => {
    const a = seg[0].move ? clampToWorld(seg[0].x + dx, seg[0].y + dy) : seg[0];
    const b = seg[1].move ? clampToWorld(seg[1].x + dx, seg[1].y + dy) : seg[1];
    const midInfo = groupDrag?.mids.find((m) => m.index === i);
    const bend = midInfo?.selected === true;
    const mid = bend
      ? clampToWorld(midInfo.x + dx, midInfo.y + dy)
      : {
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
        };
    if (!midInfo?.anchor) {
      markerByKey.get(`mid:${i}`)?.setLatLng(gameToLatLng(mid.x, mid.y));
    }
    const ax = a.x + (b.x - a.x) * 0.38;
    const ay = a.y + (b.y - a.y) * 0.38;
    markerByKey.get(`arrow:${i}`)?.setLatLng(gameToLatLng(ax, ay));
    const line = lineByKey.get(`seg-${i}`);
    if (!line) return;
    line.setLatLngs(
      bend
        ? [gameToLatLng(a.x, a.y), gameToLatLng(mid.x, mid.y), gameToLatLng(b.x, b.y)]
        : [gameToLatLng(a.x, a.y), gameToLatLng(b.x, b.y)],
    );
  });
}

/** Bend one segment without React state, so the handle isn't recreated mid-drag. */
function previewBend(index: number, x: number, y: number) {
  const line = lineByKey.get(`seg-${index}`);
  if (!line) return;
  const latlngs = line.getLatLngs() as L.LatLng[];
  if (latlngs.length < 2) return;
  const a = latlngs[0];
  const b = latlngs[latlngs.length - 1];
  line.setLatLngs([a, L.latLng(gameToLatLng(x, y)), b]);
  const ag = latLngToGame(a.lat, a.lng);
  markerByKey
    .get(`arrow:${index}`)
    ?.setLatLng(gameToLatLng(ag.x + (x - ag.x) * 0.38, ag.y + (y - ag.y) * 0.38));
}

function endGroupDrag(x: number, y: number): boolean {
  if (!groupDrag) return false;
  const dx = x - groupDrag.originX;
  const dy = y - groupDrag.originY;
  const bends = groupDrag.mids
    .filter((m) => m.selected)
    .map((m) => ({
      segmentIndex: m.index,
      x: m.x + dx,
      y: m.y + dy,
    }));
  groupDrag = null;
  useProjectStore.getState().moveSelectedBy(dx, dy, bends);
  return true;
}

const stationIcon = (
  selected: boolean,
  role: string,
  issueSev?: MapIssueSeverity,
  isPort = false,
  dimmed = false,
) =>
  L.divIcon({
    className: '',
    html: `<div class="station-marker ${isPort ? 'port-marker' : ''} ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''} role-${role}${issueSev ? ` issue-${issueSev}` : ''}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

function midMarkerIcon(selected: boolean) {
  return L.divIcon({
    className: 'midpoint-icon',
    html: `<div class="midpoint-marker${selected ? ' selected' : ''}" title="Drag to bend route"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

/**
 * Stable icon instances. A new DivIcon on each render makes react-leaflet
 * call setIcon mid-drag, which replaces the DOM node and kills the gesture.
 */
const midIcons = {
  plain: midMarkerIcon(false),
  selected: midMarkerIcon(true),
};

/** CSS deg from north (0° = up), matching Leaflet CRS.Simple screen axes. */
function bearingDeg(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const [lat1, lng1] = gameToLatLng(ax, ay);
  const [lat2, lng2] = gameToLatLng(bx, by);
  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;
  return (Math.atan2(dLng, dLat) * 180) / Math.PI;
}

/** Cache DivIcons so Marker doesn't remount on every parent render. */
const dirArrowIconCache = new Map<string, L.DivIcon>();

function directionArrowIcon(color: string, deg: number, muted = false) {
  const rounded = Math.round(deg);
  const key = `${color}|${rounded}|${muted ? 1 : 0}`;
  let icon = dirArrowIconCache.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: 'dir-arrow-icon',
      html: `<div class="dir-arrow ${muted ? 'muted' : ''}" style="--arrow-color:${color};transform:rotate(${rounded}deg)" aria-hidden="true"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    dirArrowIconCache.set(key, icon);
  }
  return icon;
}

type DirArrow = {
  key: string;
  x: number;
  y: number;
  deg: number;
  color: string;
};

/** One arrow per segment (≥ minLen), placed before the midpoint handle. */
function buildDirectionArrows(
  points: { x: number; y: number }[],
  color: string,
  keyPrefix: string,
  minLenM = 45,
): DirArrow[] {
  const arrows: DirArrow[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < minLenM) continue;
    const t = 0.38;
    arrows.push({
      key: `${keyPrefix}-arr-${i}`,
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      deg: bearingDeg(a.x, a.y, b.x, b.y),
      color,
    });
  }
  return arrows;
}

/** Shift-drag on empty map draws a box and selects stops inside it. */
function RegionSelect() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    let origin: { x: number; y: number } | null = null;
    let moved = false;
    let box: HTMLDivElement | null = null;

    const clearBox = () => {
      box?.remove();
      box = null;
      origin = null;
      moved = false;
      if (!map.dragging.enabled()) map.dragging.enable();
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || !e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (!target || target.closest('.leaflet-marker-icon, .leaflet-popup')) return;
      origin = { x: e.clientX, y: e.clientY };
      moved = false;
      map.dragging.disable();
      e.preventDefault();
      e.stopPropagation();
    };

    const onMove = (e: MouseEvent) => {
      if (!origin) return;
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      if (!box) {
        box = document.createElement('div');
        box.className = 'map-select-box';
        document.body.appendChild(box);
      }
      const left = Math.min(origin.x, e.clientX);
      const top = Math.min(origin.y, e.clientY);
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${Math.abs(dx)}px`;
      box.style.height = `${Math.abs(dy)}px`;
    };

    const onUp = () => {
      if (!origin) return;
      if (moved && box) {
        const b = box.getBoundingClientRect();
        const crect = container.getBoundingClientRect();
        const nw = map.containerPointToLatLng(
          L.point(b.left - crect.left, b.top - crect.top),
        );
        const se = map.containerPointToLatLng(
          L.point(b.right - crect.left, b.bottom - crect.top),
        );
        const bounds = L.latLngBounds(nw, se);
        const { project, selectMany } = useProjectStore.getState();
        const active = getActiveRoute(project);
        const onRoute = new Set(
          active.route
            .filter((n) => n.kind === 'station')
            .map((n) => (n.kind === 'station' ? n.stationId : '')),
        );
        const stationIds = project.stations
          .filter(
            (st) =>
              onRoute.has(st.id) &&
              bounds.contains(L.latLng(gameToLatLng(st.x, st.y))),
          )
          .map((st) => st.id);
        const waypointIds = active.waypoints
          .filter((w) => bounds.contains(L.latLng(gameToLatLng(w.x, w.y))))
          .map((w) => w.id);
        const detailed = resolveRouteDetailed(toRouteSimInput(project, active));
        const midpointIndices: number[] = [];
        for (let i = 0; i < detailed.points.length - 1; i++) {
          const a = detailed.points[i];
          const b = detailed.points[i + 1];
          const mid = L.latLng(
            gameToLatLng((a.x + b.x) / 2, (a.y + b.y) / 2),
          );
          if (bounds.contains(mid)) midpointIndices.push(i);
        }
        selectMany(stationIds, waypointIds, true, midpointIndices);
      }
      clearBox();
    };

    container.addEventListener('mousedown', onDown, true);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      container.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      clearBox();
    };
  }, [map]);

  return null;
}

function MapEventBridge() {
  const tool = useProjectStore((s) => s.tool);
  const placeStationAt = useProjectStore((s) => s.placeStationAt);
  const addWaypointAt = useProjectStore((s) => s.addWaypointAt);
  const setCursor = useProjectStore((s) => s.setCursor);

  useMapEvents({
    mousemove(e) {
      const { x, y } = latLngToGame(e.latlng.lat, e.latlng.lng);
      setCursor(x, y);
    },
    click(e) {
      const { x, y } = latLngToGame(e.latlng.lat, e.latlng.lng);
      if (
        x < WORLD.minX ||
        x > WORLD.maxX ||
        y < WORLD.minY ||
        y > WORLD.maxY
      ) {
        return;
      }
      if (tool === 'place-station') {
        placeStationAt(x, y);
      } else if (tool === 'add-waypoint') {
        addWaypointAt(x, y);
      }
    },
  });

  return null;
}

function FitWorldOnce() {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    map.fitBounds(worldBoundsLatLng(), { padding: [16, 16] });
  }, [map]);
  return null;
}

/** HMR / stale map instances can keep Leaflet’s default top-left zoom. */
function StripDefaultZoomControl() {
  const map = useMap();
  useEffect(() => {
    map.zoomControl?.remove();
  }, [map]);
  return null;
}

function pickNearestSegment(
  points: { x: number; y: number }[],
  x: number,
  y: number,
): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    const d = Math.hypot(mx - x, my - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function InactiveRouteLayer({
  route,
  index,
  stations,
}: {
  route: Route;
  index: number;
  stations: Station[];
}) {
  const points = useMemo(
    () =>
      resolveRoutePoints({
        stations,
        waypoints: route.waypoints,
        route: route.route,
        vehicleType: route.vehicleType,
        consist: route.consist,
        flags: route.flags,
        cargo: route.cargo,
      }),
    [route, stations],
  );

  const color = routeColorAt(index, route.color);
  const positions = useMemo(
    () => points.map((p) => gameToLatLng(p.x, p.y) as [number, number]),
    [points],
  );

  const arrows = useMemo(
    () => buildDirectionArrows(points, color, `inact-${route.id}`, 70),
    [points, color, route.id],
  );

  if (positions.length < 2) return null;

  return (
    <>
      <Polyline
        positions={positions}
        pathOptions={{
          color,
          weight: 3,
          opacity: 0.35,
          lineCap: 'round',
          lineJoin: 'round',
          dashArray: route.vehicleType === 'drone' ? '6 8' : undefined,
        }}
        interactive={false}
      />
      {arrows.map((a) => (
        <Marker
          key={a.key}
          position={gameToLatLng(a.x, a.y)}
          interactive={false}
          keyboard={false}
          zIndexOffset={200}
          icon={directionArrowIcon(a.color, a.deg, true)}
        />
      ))}
    </>
  );
}

function ActiveRouteLayer({
  highlights,
  color,
}: {
  highlights: IssueMapHighlights;
  color: string;
}) {
  const project = useProjectStore((s) => s.project);
  const insertWaypointOnSegment = useProjectStore(
    (s) => s.insertWaypointOnSegment,
  );
  const removeRouteSegment = useProjectStore((s) => s.removeRouteSegment);
  const moveWaypoint = useProjectStore((s) => s.moveWaypoint);
  const selectWaypoint = useProjectStore((s) => s.selectWaypoint);
  const toggleWaypointSelected = useProjectStore((s) => s.toggleWaypointSelected);
  const toggleMidpointSelected = useProjectStore((s) => s.toggleMidpointSelected);
  const selectedWaypointIds = useProjectStore((s) => s.selectedWaypointIds);
  const selectedMidpointIndices = useProjectStore(
    (s) => s.selectedMidpointIndices,
  );

  const active = getActiveRoute(project);
  const sim = useMemo(
    () => toRouteSimInput(project, active),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute when project/active id change
    [project],
  );

  /** Suppress click-to-insert after a drag (Leaflet often fires click on mouseup). */
  const midDragRef = useRef(false);

  const points = useMemo(() => resolveRoutePoints(sim), [sim]);

  const segmentPolylines = useMemo(() => {
    if (points.length < 2) return [];
    const segs: {
      key: string;
      positions: [number, number][];
      color: string;
      weight: number;
    }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const sev = highlights.segments.get(i);
      segs.push({
        key: `seg-${i}`,
        positions: [
          gameToLatLng(a.x, a.y) as [number, number],
          gameToLatLng(b.x, b.y) as [number, number],
        ],
        color: routeColorFor(sev, color),
        weight: sev === 'error' ? 5.5 : sev === 'warning' ? 5 : 4.5,
      });
    }
    return segs;
  }, [points, highlights.segments, color]);

  // Keep mid markers mounted during drag (filtering them out unmounts Leaflet mid-drag).
  const midpoints = useMemo(() => {
    const mids: { index: number; x: number; y: number }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      mids.push({
        index: i,
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      });
    }
    return mids;
  }, [points]);

  const directionArrows = useMemo(
    () => buildDirectionArrows(points, color, 'act'),
    [points, color],
  );

  const segmentEvents = useMemo(
    () => ({
      click: (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        const { x, y } = latLngToGame(e.latlng.lat, e.latlng.lng);
        insertWaypointOnSegment(pickNearestSegment(points, x, y), x, y);
      },
      contextmenu: (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        e.originalEvent.preventDefault();
        const { x, y } = latLngToGame(e.latlng.lat, e.latlng.lng);
        removeRouteSegment(pickNearestSegment(points, x, y));
      },
    }),
    [points, insertWaypointOnSegment, removeRouteSegment],
  );

  const dashArray = active.vehicleType === 'drone' ? '8 10' : undefined;

  return (
    <>
      {segmentPolylines.map((seg) => (
        <Polyline
          key={seg.key}
          ref={(layer) => {
            if (layer) lineByKey.set(seg.key, layer);
            else lineByKey.delete(seg.key);
          }}
          positions={seg.positions}
          pathOptions={{
            color: seg.color,
            weight: seg.weight,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round',
            dashArray,
          }}
          eventHandlers={segmentEvents}
        />
      ))}

      {directionArrows.map((a) => (
        <Marker
          key={a.key}
          ref={(layer) => {
            const index = a.key.split('-').pop() ?? '';
            const key = `arrow:${index}`;
            if (layer) markerByKey.set(key, layer);
            else markerByKey.delete(key);
          }}
          position={gameToLatLng(a.x, a.y)}
          interactive={false}
          keyboard={false}
          zIndexOffset={350}
          icon={directionArrowIcon(a.color, a.deg)}
        />
      ))}

      {midpoints.map((m) => (
        <Marker
          key={`mid-${m.index}`}
          ref={(layer) => {
            const key = `mid:${m.index}`;
            if (layer) markerByKey.set(key, layer);
            else markerByKey.delete(key);
          }}
          position={gameToLatLng(m.x, m.y)}
          draggable
          autoPan={false}
          icon={
            selectedMidpointIndices.includes(m.index)
              ? midIcons.selected
              : midIcons.plain
          }
          zIndexOffset={600}
          eventHandlers={{
            mousedown: (e) => {
              // Start drag immediately without a prior select click.
              L.DomEvent.stopPropagation(e);
            },
            click: (e) => {
              L.DomEvent.stopPropagation(e);
              if (e.originalEvent.shiftKey) {
                toggleMidpointSelected(m.index);
                return;
              }
              if (midDragRef.current) {
                midDragRef.current = false;
                return;
              }
              insertWaypointOnSegment(m.index, m.x, m.y);
            },
            contextmenu: (e) => {
              L.DomEvent.stopPropagation(e);
              e.originalEvent.preventDefault();
              removeRouteSegment(m.index);
            },
            dragstart: (e) => {
              L.DomEvent.stopPropagation(e);
              midDragRef.current = true;
              beginGroupDrag('mid', String(m.index));
            },
            drag: (e) => {
              midDragRef.current = true;
              const ll = (e.target as L.Marker).getLatLng();
              const g = latLngToGame(ll.lat, ll.lng);
              if (groupDrag) previewGroupDrag(g.x, g.y);
              else previewBend(m.index, g.x, g.y);
            },
            dragend: (e) => {
              const ll = (e.target as L.Marker).getLatLng();
              const g = latLngToGame(ll.lat, ll.lng);
              if (endGroupDrag(g.x, g.y)) return;
              insertWaypointOnSegment(m.index, g.x, g.y);
              // click may follow; leave midDragRef true until click clears it
            },
          }}
        />
      ))}

      {active.waypoints.map((w) => (
        <Marker
          key={w.id}
          ref={(layer) => {
            const key = markerKey('waypoint', w.id);
            if (layer) markerByKey.set(key, layer);
            else markerByKey.delete(key);
          }}
          position={gameToLatLng(w.x, w.y)}
          draggable
          icon={L.divIcon({
            className: '',
            html: `<div class="waypoint-marker ${selectedWaypointIds.includes(w.id) ? 'selected' : ''}"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          })}
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e);
              if (e.originalEvent.shiftKey) toggleWaypointSelected(w.id);
              else selectWaypoint(w.id);
            },
            dragstart: () => {
              beginGroupDrag('waypoint', w.id);
            },
            drag: (e) => {
              const ll = (e.target as L.Marker).getLatLng();
              const g = latLngToGame(ll.lat, ll.lng);
              previewGroupDrag(g.x, g.y);
            },
            dragend: (e) => {
              const ll = (e.target as L.Marker).getLatLng();
              const g = latLngToGame(ll.lat, ll.lng);
              if (endGroupDrag(g.x, g.y)) return;
              moveWaypoint(w.id, g.x, g.y);
            },
          }}
        />
      ))}
    </>
  );
}

function StationLayer({ highlights }: { highlights: IssueMapHighlights }) {
  const stations = useProjectStore((s) => s.project.stations);
  const active = useProjectStore((s) => getActiveRoute(s.project));
  const selectedStationIds = useProjectStore((s) => s.selectedStationIds);
  const selectStation = useProjectStore((s) => s.selectStation);
  const toggleStationSelected = useProjectStore((s) => s.toggleStationSelected);
  const moveStation = useProjectStore((s) => s.moveStation);
  const appendStationToRoute = useProjectStore((s) => s.appendStationToRoute);
  const tool = useProjectStore((s) => s.tool);

  const onActive = useMemo(() => {
    const ids = new Set(
      active.route
        .filter((n) => n.kind === 'station')
        .map((n) => (n.kind === 'station' ? n.stationId : '')),
    );
    return ids;
  }, [active.route]);

  return (
    <>
      {stations.map((st) => {
        const matchesVehicle = st.vehicleType === active.vehicleType;
        const dimmed = !matchesVehicle && !onActive.has(st.id);
        return (
          <Marker
            key={st.id}
            ref={(layer) => {
              const key = markerKey('station', st.id);
              if (layer) markerByKey.set(key, layer);
              else markerByKey.delete(key);
            }}
            position={gameToLatLng(st.x, st.y)}
            draggable={tool !== 'link-route'}
            opacity={dimmed ? 0.45 : 1}
            icon={stationIcon(
              selectedStationIds.includes(st.id),
              st.role,
              highlights.stations.get(st.id),
              st.vehicleType === 'drone',
              dimmed,
            )}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                if (e.originalEvent.shiftKey) {
                  toggleStationSelected(st.id);
                  return;
                }
                selectStation(st.id);
                // Only Link route tool appends stops — Select just inspects.
                if (tool === 'link-route') {
                  appendStationToRoute(st.id);
                }
              },
              dragstart: () => {
                beginGroupDrag('station', st.id);
              },
              drag: (e) => {
                const ll = (e.target as L.Marker).getLatLng();
                const g = latLngToGame(ll.lat, ll.lng);
                previewGroupDrag(g.x, g.y);
              },
              dragend: (e) => {
                const ll = (e.target as L.Marker).getLatLng();
                const g = latLngToGame(ll.lat, ll.lng);
                if (endGroupDrag(g.x, g.y)) return;
                moveStation(st.id, g.x, g.y);
              },
            }}
          />
        );
      })}
    </>
  );
}

function MapIssueLayers() {
  const project = useProjectStore((s) => s.project);
  const issues = useProjectStore((s) => s.issues);

  const active = getActiveRoute(project);
  const activeIndex = project.routes.findIndex((r) => r.id === active.id);
  const color = routeColorAt(Math.max(0, activeIndex), active.color);

  const highlights = useMemo(() => {
    const sim = toRouteSimInput(project, active);
    const points = resolveRoutePoints(sim);
    // Only tint from active-route issues (ids without other-route prefixes, or matching).
    const activeIssues = issues.filter(
      (i) =>
        !i.id.includes(':') || i.id.startsWith(`${active.id}:`),
    );
    return buildIssueMapHighlights(activeIssues, points, project.stations);
  }, [project, active, issues]);

  return (
    <>
      {project.routes.map((route, index) =>
        route.id === active.id ? null : (
          <InactiveRouteLayer
            key={route.id}
            route={route}
            index={index}
            stations={project.stations}
          />
        ),
      )}
      <ActiveRouteLayer highlights={highlights} color={color} />
      <StationLayer highlights={highlights} />
    </>
  );
}

export default function MapView() {
  const bounds = worldBoundsLatLng();
  const baseLayer = useUiStore((s) => s.baseLayer);

  return (
    <div className="map-wrap">
      <MapContainer
        className="map-root"
        center={mapCenterLatLng()}
        zoom={MIN_TILE_ZOOM}
        {...createMapOptions()}
        zoomControl={false}
        maxBounds={bounds}
        maxBoundsViscosity={0.85}
        attributionControl={false}
      >
        <AttributionControl position="bottomright" prefix={false} />
        <ZoomControl position="bottomright" />
        <TileLayer
          key={baseLayer}
          url={scimTileUrl(baseLayer)}
          noWrap
          bounds={bounds}
          minZoom={MIN_TILE_ZOOM}
          maxZoom={MAX_TILE_ZOOM + 4}
          maxNativeZoom={MAX_TILE_ZOOM}
          tileSize={256}
          attribution={SCIM_ATTRIBUTION}
        />
        <StripDefaultZoomControl />
        <FitWorldOnce />
        <MapEventBridge />
        <RegionSelect />
        <ResourceNodesLayer />
        <MapIssueLayers />
        <IssueFocusLayer />
      </MapContainer>
    </div>
  );
}
