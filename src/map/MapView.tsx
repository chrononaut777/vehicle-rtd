import { useEffect, useMemo, useRef, useState } from 'react';
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
import { resolveRoutePoints } from '../physics/path';
import {
  buildIssueMapHighlights,
  routeColorFor,
  type IssueMapHighlights,
} from '../issues/mapHighlights';
import type { MapIssueSeverity } from '../issues/detect';
import ResourceNodesLayer from './ResourceNodesLayer';
import IssueFocusLayer from './IssueFocusLayer';

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

const midIcon = L.divIcon({
  className: 'midpoint-icon',
  html: '<div class="midpoint-marker" title="Drag to bend route"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

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
  const selectedWaypointId = useProjectStore((s) => s.selectedWaypointId);

  const active = getActiveRoute(project);
  const sim = useMemo(
    () => toRouteSimInput(project, active),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute when project/active id change
    [project],
  );

  const [bend, setBend] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);
  /** Suppress click-to-insert after a drag (Leaflet often fires click on mouseup). */
  const midDragRef = useRef(false);

  const points = useMemo(() => resolveRoutePoints(sim), [sim]);
  const cruiseHeight = active.flags.cruiseHeight;

  const displayPoints = useMemo(() => {
    if (!bend || points.length < 2) return points;
    const out = [...points];
    out.splice(bend.index + 1, 0, {
      x: bend.x,
      y: bend.y,
      z: cruiseHeight,
    });
    return out;
  }, [points, bend, cruiseHeight]);

  const segmentPolylines = useMemo(() => {
    if (displayPoints.length < 2) return [];
    const applyIssues = !bend;
    const segs: {
      key: string;
      positions: [number, number][];
      color: string;
      weight: number;
    }[] = [];
    for (let i = 0; i < displayPoints.length - 1; i++) {
      const a = displayPoints[i];
      const b = displayPoints[i + 1];
      // While bending, segment indices shift after the insert preview — skip issue tint.
      const sev = applyIssues ? highlights.segments.get(i) : undefined;
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
  }, [displayPoints, highlights.segments, bend, color]);

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

  // Build from original points (not bend preview) so arrow keys stay stable
  // while dragging midpoints; hide the segment being bent.
  const directionArrows = useMemo(() => {
    const arrows = buildDirectionArrows(points, color, 'act');
    if (bend) {
      return arrows.filter((a) => a.key !== `act-arr-${bend.index}`);
    }
    return arrows;
  }, [points, color, bend]);

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
          position={
            bend?.index === m.index
              ? gameToLatLng(bend.x, bend.y)
              : gameToLatLng(m.x, m.y)
          }
          draggable
          autoPan={false}
          icon={midIcon}
          zIndexOffset={600}
          eventHandlers={{
            mousedown: (e) => {
              // Start drag immediately without a prior select click.
              L.DomEvent.stopPropagation(e);
            },
            click: (e) => {
              L.DomEvent.stopPropagation(e);
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
              const ll = (e.target as L.Marker).getLatLng();
              const g = latLngToGame(ll.lat, ll.lng);
              setBend({ index: m.index, x: g.x, y: g.y });
            },
            drag: (e) => {
              midDragRef.current = true;
              const ll = (e.target as L.Marker).getLatLng();
              const g = latLngToGame(ll.lat, ll.lng);
              setBend({ index: m.index, x: g.x, y: g.y });
            },
            dragend: (e) => {
              const ll = (e.target as L.Marker).getLatLng();
              const g = latLngToGame(ll.lat, ll.lng);
              insertWaypointOnSegment(m.index, g.x, g.y);
              setBend(null);
              // click may follow; leave midDragRef true until click clears it
            },
          }}
        />
      ))}

      {active.waypoints.map((w) => (
        <Marker
          key={w.id}
          position={gameToLatLng(w.x, w.y)}
          draggable
          icon={L.divIcon({
            className: '',
            html: `<div class="waypoint-marker ${selectedWaypointId === w.id ? 'selected' : ''}"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          })}
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e);
              selectWaypoint(w.id);
            },
            dragend: (e) => {
              const ll = (e.target as L.Marker).getLatLng();
              const g = latLngToGame(ll.lat, ll.lng);
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
  const selectedStationId = useProjectStore((s) => s.selectedStationId);
  const selectStation = useProjectStore((s) => s.selectStation);
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
            position={gameToLatLng(st.x, st.y)}
            draggable={tool !== 'link-route'}
            opacity={dimmed ? 0.45 : 1}
            icon={stationIcon(
              selectedStationId === st.id,
              st.role,
              highlights.stations.get(st.id),
              st.vehicleType === 'drone',
              dimmed,
            )}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                selectStation(st.id);
                // Only Link route tool appends stops — Select just inspects.
                if (tool === 'link-route') {
                  appendStationToRoute(st.id);
                }
              },
              dragend: (e) => {
                const ll = (e.target as L.Marker).getLatLng();
                const g = latLngToGame(ll.lat, ll.lng);
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
        <ResourceNodesLayer />
        <MapIssueLayers />
        <IssueFocusLayer />
      </MapContainer>
    </div>
  );
}
