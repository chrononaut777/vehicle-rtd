import type { BeltMk, StationRole } from '../../domain/types';
import { getActiveRoute } from '../../domain/types';
import { platformBeltCeiling } from '../../physics/belts';
import { platformsForStation } from '../../physics/sizeConsist';
import { useProjectStore } from '../../store/useProjectStore';
import NumberField from '../NumberField';

function fmt(n: number, digits = 1) {
  return n.toFixed(digits);
}

export default function SelectionInspector() {
  const project = useProjectStore((s) => s.project);
  const selectedStationId = useProjectStore((s) => s.selectedStationId);
  const selectedWaypointId = useProjectStore((s) => s.selectedWaypointId);
  const sizing = useProjectStore((s) => s.sizing);
  const updateStation = useProjectStore((s) => s.updateStation);
  const removeStation = useProjectStore((s) => s.removeStation);
  const removeWaypoint = useProjectStore((s) => s.removeWaypoint);
  const selectStation = useProjectStore((s) => s.selectStation);
  const selectWaypoint = useProjectStore((s) => s.selectWaypoint);
  const copyStation = useProjectStore((s) => s.copyStation);
  const pasteStation = useProjectStore((s) => s.pasteStation);
  const stationClipboard = useProjectStore((s) => s.stationClipboard);

  const active = getActiveRoute(project);
  const selected = project.stations.find((s) => s.id === selectedStationId);
  const stationPlatforms = selected
    ? platformsForStation(
        selected,
        sizing?.platforms,
        active.cargo.beltMk ?? 5,
        project.stations,
        active.route,
      )
    : null;

  if (!selected && !selectedWaypointId) return null;

  const close = () => {
    selectStation(null);
    selectWaypoint(null);
  };

  return (
    <aside className="selection-inspector" aria-label="Selection">
      <header className="floating-panel-header">
        <h2>
          {selected
            ? selected.vehicleType === 'drone'
              ? 'Port'
              : 'Station'
            : 'Waypoint'}
        </h2>
        <button
          type="button"
          className="floating-panel-close"
          onClick={close}
          aria-label="Deselect"
        >
          ✕
        </button>
      </header>
      <div className="floating-panel-body">
        {selected && (
          <>
            <label>
              Name
              <input
                value={selected.name}
                onChange={(e) =>
                  updateStation(selected.id, { name: e.target.value })
                }
              />
            </label>
            <label>
              Role
              <select
                value={selected.role}
                onChange={(e) =>
                  updateStation(selected.id, {
                    role: e.target.value as StationRole,
                  })
                }
              >
                <option value="pickup">Pickup</option>
                <option value="dropoff">Dropoff</option>
                <option value="both">Both</option>
                <option value="passthrough">Passthrough</option>
              </select>
            </label>
            {selected.vehicleType !== 'drone' && (
              <label>
                Z (m)
                <NumberField
                  value={
                    active.flags.flatTrack &&
                    selected.vehicleType === active.vehicleType
                      ? active.flags.cruiseHeight
                      : (selected.z ?? active.flags.cruiseHeight)
                  }
                  emptyValue={active.flags.cruiseHeight}
                  disabled={
                    active.flags.flatTrack &&
                    selected.vehicleType === active.vehicleType
                  }
                  title={
                    active.flags.flatTrack &&
                    selected.vehicleType === active.vehicleType
                      ? 'Locked to cruise height while Build flat is on'
                      : undefined
                  }
                  onCommit={(n) =>
                    updateStation(selected.id, {
                      z: n ?? active.flags.cruiseHeight,
                    })
                  }
                />
              </label>
            )}
            <label>
              Dwell override (s)
              <NumberField
                placeholder="default 27.08"
                value={selected.dwellSeconds ?? null}
                emptyValue={null}
                onCommit={(n) =>
                  updateStation(selected.id, {
                    dwellSeconds: n ?? undefined,
                  })
                }
              />
            </label>
            {selected.role !== 'passthrough' && (
              <>
                <label>
                  {selected.role === 'dropoff' ? 'Output' : 'Input'} items/min
                  <NumberField
                    placeholder="e.g. 780"
                    value={selected.itemsPerMin ?? null}
                    emptyValue={null}
                    onCommit={(n) =>
                      updateStation(selected.id, {
                        itemsPerMin: n == null || n <= 0 ? undefined : n,
                      })
                    }
                  />
                </label>
                {selected.vehicleType !== 'drone' && (
                  <>
                    {stationPlatforms && (
                      <>
                        <dl className="stats sizing-stats">
                          <div>
                            <dt>Dock</dt>
                            <dd>{stationPlatforms.dockPlatforms}</dd>
                          </div>
                          <div>
                            <dt>Loading</dt>
                            <dd>
                              {stationPlatforms.loadingPlatforms > 0
                                ? stationPlatforms.loadingPlatforms
                                : '—'}
                            </dd>
                          </div>
                          <div>
                            <dt>Exclusive</dt>
                            <dd>
                              {stationPlatforms.exclusiveCars > 0
                                ? stationPlatforms.exclusiveCars
                                : '—'}
                            </dd>
                          </div>
                          <div>
                            <dt>Shared</dt>
                            <dd>
                              {stationPlatforms.sharedCars.length > 0
                                ? stationPlatforms.sharedCars.length
                                : '—'}
                            </dd>
                          </div>
                        </dl>
                        <p className="hint">{stationPlatforms.breakdown}</p>
                        <p className="hint">
                          Whole cars fill here first; leftover fractions share a
                          car with other{' '}
                          {selected.role === 'dropoff' ? 'dropoffs' : 'pickups'}
                          . Belts need ~
                          {stationPlatforms.beltPlatforms || '—'}× dual Mk.
                          {active.cargo.beltMk ?? 5} (
                          {platformBeltCeiling(
                            (active.cargo.beltMk ?? 5) as BeltMk,
                          )}
                          /min each)
                          {stationPlatforms.beltBound
                            ? ' — more than the dock'
                            : ''}
                          .
                        </p>
                      </>
                    )}
                  </>
                )}
              </>
            )}
            <p className="mono">
              X {fmt(selected.x, 2)} Y {fmt(selected.y, 2)}
            </p>
            <div className="btn-row tight">
              <button
                type="button"
                title="Copy details (Ctrl+C)"
                onClick={() => copyStation(selected.id)}
              >
                Copy
              </button>
              <button
                type="button"
                title="Paste nearby (Ctrl+V)"
                disabled={
                  !stationClipboard ||
                  stationClipboard.vehicleType !== selected.vehicleType
                }
                onClick={() => pasteStation()}
              >
                Paste
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => removeStation(selected.id)}
              >
                Delete
              </button>
            </div>
            {stationClipboard && (
              <p className="hint">
                Clipboard: “{stationClipboard.name}”. Place tool also reuses
                these details until you copy something else.
              </p>
            )}
          </>
        )}

        {selectedWaypointId && !selected && (
          <button
            type="button"
            className="danger"
            onClick={() => removeWaypoint(selectedWaypointId)}
          >
            Delete waypoint
          </button>
        )}
      </div>
    </aside>
  );
}
