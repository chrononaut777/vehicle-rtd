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
  className: '',
  html: '<div class="midpoint-marker" title="Drag to add waypoint"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

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

  if (positions.length < 2) return null;

  return (
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
      const sev = applyIssues ? highlights.segments.get(i) : undefined;
      segs.push({
        key: `seg-${i}-${a.x.toFixed(0)}-${a.y.toFixed(0)}-${b.x.toFixed(0)}-${b.y.toFixed(0)}`,
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

  const midpoints = useMemo(() => {
    const mids: { index: number; x: number; y: number }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      if (bend && bend.index === i) continue;
      const a = points[i];
      const b = points[i + 1];
      mids.push({
        index: i,
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      });
    }
    return mids;
  }, [points, bend]);

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

      {midpoints.map((m) => (
        <Marker
          key={`mid-${m.index}-${m.x.toFixed(0)}-${m.y.toFixed(0)}`}
          position={gameToLatLng(m.x, m.y)}
          draggable
          icon={midIcon}
          zIndexOffset={400}
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e);
              insertWaypointOnSegment(m.index, m.x, m.y);
            },
            contextmenu: (e) => {
              L.DomEvent.stopPropagation(e);
              e.originalEvent.preventDefault();
              removeRouteSegment(m.index);
            },
            drag: (e) => {
              const ll = (e.target as L.Marker).getLatLng();
              const g = latLngToGame(ll.lat, ll.lng);
              setBend({ index: m.index, x: g.x, y: g.y });
            },
            dragend: (e) => {
              const ll = (e.target as L.Marker).getLatLng();
              const g = latLngToGame(ll.lat, ll.lng);
              insertWaypointOnSegment(m.index, g.x, g.y);
              setBend(null);
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
