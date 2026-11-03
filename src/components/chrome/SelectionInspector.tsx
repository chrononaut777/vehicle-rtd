import type { BeltMk, StationRole } from '../../domain/types';
import { getActiveRoute } from '../../domain/types';
import { BELT_MK_OPTIONS, beltRate, platformBeltCeiling } from '../../physics/belts';
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

  const active = getActiveRoute(project);
  const selected = project.stations.find((s) => s.id === selectedStationId);

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
                    active.flags.flatTrack
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
                {selected.vehicleType !== 'drone' && (
                  <label>
                    Belt mark
                    <select
                      value={selected.beltMk ?? 5}
                      onChange={(e) =>
                        updateStation(selected.id, {
                          beltMk: Number(e.target.value) as BeltMk,
                        })
                      }
                    >
                      {BELT_MK_OPTIONS.map((mk) => (
                        <option key={mk} value={mk}>
                          Mk.{mk} ({beltRate(mk)}/min each)
                        </option>
                      ))}
                    </select>
                  </label>
                )}
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
                  <p className="hint">
                    Dual-port platform ceiling ≈{' '}
                    {platformBeltCeiling((selected.beltMk ?? 5) as BeltMk)}/min
                    per freight platform (2× Mk.{selected.beltMk ?? 5}).
                    {sizing
                      ? ` With ${sizing.platforms} platforms ≈ ${platformBeltCeiling((selected.beltMk ?? 5) as BeltMk) * sizing.platforms}/min.`
                      : ''}
                  </p>
                )}
              </>
            )}
            <p className="mono">
              X {fmt(selected.x, 2)} Y {fmt(selected.y, 2)}
            </p>
            <button
              type="button"
              className="danger"
              onClick={() => removeStation(selected.id)}
            >
              Delete {selected.vehicleType === 'drone' ? 'port' : 'station'}
            </button>
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
