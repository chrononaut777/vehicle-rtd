import { useState } from 'react';
import {
  getActiveRoute,
  routeColorAt,
  type VehicleType,
} from '../domain/types';
import { useProjectStore } from '../store/useProjectStore';
import { formatDuration } from '../physics/simulateTrip';

export default function RouteList() {
  const project = useProjectStore((s) => s.project);
  const routeSummaries = useProjectStore((s) => s.routeSummaries);
  const setActiveRoute = useProjectStore((s) => s.setActiveRoute);
  const addRoute = useProjectStore((s) => s.addRoute);
  const renameRoute = useProjectStore((s) => s.renameRoute);
  const deleteRoute = useProjectStore((s) => s.deleteRoute);
  const duplicateRoute = useProjectStore((s) => s.duplicateRoute);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const active = getActiveRoute(project);
  const summaryById = new Map(routeSummaries.map((s) => [s.routeId, s]));

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setDraft(name);
  };

  const commitRename = () => {
    if (editingId && draft.trim()) {
      renameRoute(editingId, draft.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="route-list">
      <ul className="route-list-items">
        {project.routes.map((route, index) => {
          const selected = route.id === active.id;
          const color = routeColorAt(index, route.color);
          const summary = summaryById.get(route.id);
          const rt =
            summary?.trip.ok
              ? formatDuration(summary.trip.totalRoundTripSeconds)
              : '—';
          return (
            <li
              key={route.id}
              className={`route-list-item ${selected ? 'active' : ''}`}
            >
              <button
                type="button"
                className="route-list-select"
                onClick={() => setActiveRoute(route.id)}
                title={`Edit ${route.name}`}
              >
                <i
                  className="route-swatch"
                  style={{ background: color }}
                  aria-hidden
                />
                {editingId === route.id ? (
                  <input
                    className="route-rename-input"
                    value={draft}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <span className="route-list-name">{route.name}</span>
                )}
                <span className="route-list-meta">
                  {route.vehicleType === 'drone' ? 'Drone' : 'Train'} · {rt}
                </span>
              </button>
              <span className="route-list-actions">
                <button
                  type="button"
                  title="Rename"
                  aria-label={`Rename ${route.name}`}
                  onClick={() => startRename(route.id, route.name)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  title="Duplicate"
                  aria-label={`Duplicate ${route.name}`}
                  onClick={() => duplicateRoute(route.id)}
                >
                  ⎘
                </button>
                <button
                  type="button"
                  className="danger"
                  title="Delete"
                  aria-label={`Delete ${route.name}`}
                  disabled={project.routes.length <= 1}
                  onClick={() => deleteRoute(route.id)}
                >
                  ✕
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="btn-row tight">
        <button type="button" onClick={() => addRoute('train')}>
          + Train route
        </button>
        <button type="button" onClick={() => addRoute('drone' as VehicleType)}>
          + Drone route
        </button>
      </div>
      {project.routes.length > 1 && (
        <ul className="route-summary-all">
          {routeSummaries.map((s, index) => (
            <li key={s.routeId}>
              <i
                className="route-swatch"
                style={{ background: routeColorAt(index) }}
                aria-hidden
              />
              <span>{s.name}</span>
              <span className="mono">
                {s.trip.ok
                  ? formatDuration(s.trip.totalRoundTripSeconds)
                  : '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
