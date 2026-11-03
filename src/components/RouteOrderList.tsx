import { useEffect, useState } from 'react';
import { getActiveRoute } from '../domain/types';
import { useProjectStore } from '../store/useProjectStore';

/** Drag-and-drop + ↑↓ route order list (used in Routes panel). */
export default function RouteOrderList() {
  const project = useProjectStore((s) => s.project);
  const moveRouteNode = useProjectStore((s) => s.moveRouteNode);
  const removeRouteNodeAt = useProjectStore((s) => s.removeRouteNodeAt);
  const selectStation = useProjectStore((s) => s.selectStation);
  const selectWaypoint = useProjectStore((s) => s.selectWaypoint);
  const selectedStationId = useProjectStore((s) => s.selectedStationId);
  const selectedWaypointId = useProjectStore((s) => s.selectedWaypointId);
  const appendUnlinkedStations = useProjectStore((s) => s.appendUnlinkedStations);
  const clearRoute = useProjectStore((s) => s.clearRoute);
  const tool = useProjectStore((s) => s.tool);
  const setTool = useProjectStore((s) => s.setTool);

  // Browsing routes should not place/link — Select only until Link is chosen.
  useEffect(() => {
    setTool('pan');
    return () => {
      if (useProjectStore.getState().tool === 'link-route') {
        setTool('pan');
      }
    };
  }, [setTool]);

  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const active = getActiveRoute(project);
  const stations = new Map(project.stations.map((s) => [s.id, s]));
  const waypoints = new Map(active.waypoints.map((w) => [w.id, w]));
  const stopWordPlural =
    active.vehicleType === 'drone' ? 'ports' : 'stations';

  const onDrop = (toIndex: number) => {
    if (dragFrom == null || dragFrom === toIndex) {
      setDragFrom(null);
      setOverIndex(null);
      return;
    }
    moveRouteNode(dragFrom, toIndex);
    setDragFrom(null);
    setOverIndex(null);
  };

  return (
    <div className="route-order">
      <div className="btn-row tight">
        <button
          type="button"
          className={tool === 'link-route' ? 'active' : ''}
          onClick={() =>
            setTool(tool === 'link-route' ? 'pan' : 'link-route')
          }
          title={
            tool === 'link-route'
              ? 'Click again to stop linking'
              : `Click ${stopWordPlural} on the map in visit order`
          }
        >
          {tool === 'link-route' ? 'Linking…' : 'Link on map'}
        </button>
        <button type="button" onClick={() => appendUnlinkedStations()}>
          Add unlinked
        </button>
        <button type="button" className="danger" onClick={() => clearRoute()}>
          Clear route
        </button>
      </div>
      {tool === 'link-route' && (
        <p className="hint">
          Linking on — click {stopWordPlural} on the map in order. Click
          Linking… again (or close this panel) when done.
        </p>
      )}

      {active.route.length === 0 ? (
        <p className="hint">
          No stops linked yet. Use <strong>Link on map</strong> and click{' '}
          {stopWordPlural} in order — or Add unlinked.
        </p>
      ) : (
        <ol className="route-order-list">
          {active.route.map((node, index) => {
            let label = 'Unknown';
            let kind: 'station' | 'waypoint' = 'waypoint';
            let selected = false;

            if (node.kind === 'station') {
              kind = 'station';
              label = stations.get(node.stationId)?.name ?? node.stationId;
              selected = selectedStationId === node.stationId;
            } else {
              const w = waypoints.get(node.waypointId);
              label = w
                ? `Waypoint (${w.x.toFixed(0)}, ${w.y.toFixed(0)})`
                : node.waypointId;
              selected = selectedWaypointId === node.waypointId;
            }

            return (
              <li
                key={`${node.kind}-${index}-${node.kind === 'station' ? node.stationId : node.waypointId}`}
                className={[
                  'route-order-item',
                  kind,
                  selected ? 'selected' : '',
                  overIndex === index ? 'drag-over' : '',
                  dragFrom === index ? 'dragging' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                draggable
                onDragStart={(e) => {
                  setDragFrom(index);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', String(index));
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setOverIndex(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (overIndex !== index) setOverIndex(index);
                }}
                onDragLeave={() => {
                  if (overIndex === index) setOverIndex(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDrop(index);
                }}
              >
                <span className="drag-handle" title="Drag to reorder" aria-hidden>
                  ⋮⋮
                </span>
                <button
                  type="button"
                  className="route-order-label"
                  onClick={() => {
                    if (node.kind === 'station') selectStation(node.stationId);
                    else selectWaypoint(node.waypointId);
                  }}
                >
                  <span className="route-order-index">{index + 1}</span>
                  {label}
                </button>
                <span className="route-order-actions">
                  <button
                    type="button"
                    disabled={index === 0}
                    aria-label="Move up"
                    onClick={() => moveRouteNode(index, index - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index >= active.route.length - 1}
                    aria-label="Move down"
                    onClick={() => moveRouteNode(index, index + 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="danger"
                    aria-label="Remove from route"
                    title={`Remove from route (${active.vehicleType === 'drone' ? 'port' : 'station'} stays on map)`}
                    onClick={() => removeRouteNodeAt(index)}
                  >
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {active.flags.closedLoop && active.route.length >= 2 && (
        <p className="hint route-loop-hint">↻ Closed loop returns to stop 1</p>
      )}
    </div>
  );
}
