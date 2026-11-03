import {
  getActiveRoute,
  routeColorAt,
} from '../../domain/types';
import { formatDuration } from '../../physics/simulateTrip';
import { useProjectStore } from '../../store/useProjectStore';
import { useUiStore } from '../../store/useUiStore';

function fmt(n: number, digits = 1) {
  return n.toFixed(digits);
}

export default function RtHud() {
  const project = useProjectStore((s) => s.project);
  const trip = useProjectStore((s) => s.trip);
  const routeSummaries = useProjectStore((s) => s.routeSummaries);
  const setActiveRoute = useProjectStore((s) => s.setActiveRoute);
  const expanded = useUiStore((s) => s.rtExpanded);
  const toggleRtExpanded = useUiStore((s) => s.toggleRtExpanded);

  const active = getActiveRoute(project);
  const activeIndex = project.routes.findIndex((r) => r.id === active.id);
  const color = routeColorAt(activeIndex, active.color);
  const isDrone = active.vehicleType === 'drone';
  const stopWordPlural = isDrone ? 'ports' : 'stations';

  return (
    <div className="rt-hud">
      <button
        type="button"
        className="rt-hud-main"
        onClick={() => toggleRtExpanded()}
        aria-expanded={expanded}
      >
        <i className="route-swatch" style={{ background: color }} aria-hidden />
        <span className="rt-hud-route">{active.name}</span>
        <span className="rt-hud-vehicle">
          {isDrone ? 'Drone' : 'Train'}
        </span>
        <span className="rt-hud-total">
          {trip?.ok
            ? formatDuration(trip.totalRoundTripSeconds)
            : '—'}
        </span>
        {trip?.ok && (
          <span className="rt-hud-dist mono">
            {fmt(trip.totalDistanceM / 1000, 2)} km
          </span>
        )}
        <span className="rt-hud-chevron" aria-hidden>
          {expanded ? '▾' : '▴'}
        </span>
      </button>

      {expanded && (
        <div className="rt-hud-details">
          {project.routes.length > 1 && (
            <div className="rt-hud-switcher">
              <h3 className="panel-subhead">Switch route</h3>
              <ul className="route-summary-all rt-hud-route-list" role="listbox" aria-label="Active route">
                {routeSummaries.map((s, index) => {
                  const selected = s.routeId === active.id;
                  const route = project.routes.find((r) => r.id === s.routeId);
                  return (
                    <li key={s.routeId}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`rt-hud-route-btn ${selected ? 'active' : ''}`}
                        onClick={() => setActiveRoute(s.routeId)}
                      >
                        <i
                          className="route-swatch"
                          style={{ background: routeColorAt(index, route?.color) }}
                          aria-hidden
                        />
                        <span className="rt-hud-route-btn-name">{s.name}</span>
                        <span className="rt-hud-route-btn-meta">
                          {route?.vehicleType === 'drone' ? 'Drone' : 'Train'}
                        </span>
                        <span className="mono">
                          {s.trip.ok
                            ? formatDuration(s.trip.totalRoundTripSeconds)
                            : '—'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {trip?.ok ? (
            <>
              <dl className="stats">
                <div>
                  <dt>Travel</dt>
                  <dd>{formatDuration(trip.totalTravelSeconds)}</dd>
                </div>
                <div>
                  <dt>Stops</dt>
                  <dd>{formatDuration(trip.totalDwellSeconds)}</dd>
                </div>
                <div>
                  <dt>Avg speed</dt>
                  <dd>{fmt(trip.avgSpeedKmh, 1)} km/h</dd>
                </div>
              </dl>
              {isDrone ? (
                <div className="phases">
                  <span>Cruise {formatDuration(trip.phases.cruising)}</span>
                  <span>Dock {formatDuration(trip.phases.stopped)}</span>
                </div>
              ) : (
                <div className="phases">
                  <span>Accel {formatDuration(trip.phases.accelerating)}</span>
                  <span>Cruise {formatDuration(trip.phases.cruising)}</span>
                  <span>Brake {formatDuration(trip.phases.braking)}</span>
                  <span>Dwell {formatDuration(trip.phases.stopped)}</span>
                </div>
              )}
              {trip.legs.length > 0 && (
                <ul className="legs">
                  {trip.legs.map((leg, i) => (
                    <li key={`${leg.fromStationId}-${leg.toStationId}-${i}`}>
                      <strong>
                        {leg.fromName} → {leg.toName}
                      </strong>
                      <span>
                        {fmt(leg.distanceM, 0)} m ·{' '}
                        {formatDuration(leg.travelSeconds)}
                        {leg.dwellSeconds > 0
                          ? ` + ${formatDuration(leg.dwellSeconds)} stop`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="hint">
              {trip?.reason ??
                `Link at least two ${stopWordPlural} to estimate RT time.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
