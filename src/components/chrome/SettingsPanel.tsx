import {
  DRONE_CARGO_STACKS,
  getActiveRoute,
  type BeltMk,
} from '../../domain/types';
import { BELT_MK_OPTIONS, beltRate } from '../../physics/belts';
import { DRONE } from '../../physics/constants';
import { useProjectStore } from '../../store/useProjectStore';
import { useUiStore } from '../../store/useUiStore';
import NumberField from '../NumberField';
import FloatingPanel from './FloatingPanel';

function fmt(n: number, digits = 1) {
  return n.toFixed(digits);
}

export default function SettingsPanel() {
  const project = useProjectStore((s) => s.project);
  const sizing = useProjectStore((s) => s.sizing);
  const droneSizing = useProjectStore((s) => s.droneSizing);
  const setConsist = useProjectStore((s) => s.setConsist);
  const setCargo = useProjectStore((s) => s.setCargo);
  const setFlatTrack = useProjectStore((s) => s.setFlatTrack);
  const setCruiseHeight = useProjectStore((s) => s.setCruiseHeight);
  const setClosedLoop = useProjectStore((s) => s.setClosedLoop);
  const setPanel = useUiStore((s) => s.setPanel);

  const active = getActiveRoute(project);
  const isDrone = active.vehicleType === 'drone';

  return (
    <FloatingPanel
      title={isDrone ? 'Flight & cargo' : 'Track & consist'}
      side="left"
      onClose={() => setPanel(null)}
    >
      {isDrone ? (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={active.flags.closedLoop}
              onChange={(e) => setClosedLoop(e.target.checked)}
            />
            Closed loop round trip
          </label>
          <label>
            Stack size
            <NumberField
              value={active.cargo.stackSize}
              emptyValue={100}
              onCommit={(n) => setCargo({ stackSize: Math.max(1, n ?? 100) })}
            />
          </label>
          <p className="hint">
            Constant cruise {(DRONE.cruiseSpeedMps * 3.6).toFixed(0)} km/h (
            {DRONE.cruiseSpeedMps} m/s) on horizontal path distance. Dock dwell ~
            {DRONE.dockSeconds.toFixed(0)} s. Cargo {DRONE_CARGO_STACKS} stacks ×
            stack size.
          </p>
          {droneSizing && (
            <dl className="stats sizing-stats">
              <div>
                <dt>Drones</dt>
                <dd>{droneSizing.drones}</dd>
              </div>
              <div>
                <dt>Items / trip</dt>
                <dd>{Math.round(droneSizing.itemsPerTrip)}</dd>
              </div>
              <div>
                <dt>Target</dt>
                <dd>{fmt(droneSizing.targetItemsPerMin, 0)}/min</dd>
              </div>
              <div>
                <dt>Drone cap</dt>
                <dd>{droneSizing.capacity}</dd>
              </div>
            </dl>
          )}
        </>
      ) : (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={active.flags.flatTrack}
              onChange={(e) => setFlatTrack(e.target.checked)}
            />
            Build flat (no grades)
          </label>
          <label>
            Cruise height (m)
            <NumberField
              value={active.flags.cruiseHeight}
              emptyValue={0}
              onCommit={(n) => setCruiseHeight(n ?? 0)}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={active.flags.closedLoop}
              onChange={(e) => setClosedLoop(e.target.checked)}
            />
            Closed loop round trip
          </label>
          <label>
            Stack size
            <NumberField
              value={active.cargo.stackSize}
              emptyValue={100}
              onCommit={(n) => setCargo({ stackSize: Math.max(1, n ?? 100) })}
            />
          </label>
          <label>
            Belt mark
            <select
              value={active.cargo.beltMk ?? 5}
              onChange={(e) =>
                setCargo({ beltMk: Number(e.target.value) as BeltMk })
              }
            >
              {BELT_MK_OPTIONS.map((mk) => (
                <option key={mk} value={mk}>
                  Mk.{mk} ({beltRate(mk)}/min each · dual{' '}
                  {beltRate(mk) * 2}/min per platform)
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={active.cargo.autoSizeConsist}
              onChange={(e) => setCargo({ autoSizeConsist: e.target.checked })}
            />
            Auto-size engines / cars / fill from station I/O
          </label>
          <p className="hint">
            Cars = ceil(items/min × RT ÷ car capacity), engines = ceil(cars ÷ 3),
            platforms = cars. Set belt mark + station items/min first.
          </p>
          <div className="consist-grid">
            <label>
              Locomotives
              <NumberField
                disabled={active.cargo.autoSizeConsist}
                value={active.consist.locomotives}
                emptyValue={1}
                onCommit={(n) =>
                  setConsist({ locomotives: Math.max(1, Math.round(n ?? 1)) })
                }
              />
            </label>
            <label>
              Freight cars
              <NumberField
                disabled={active.cargo.autoSizeConsist}
                value={active.consist.freightCars}
                emptyValue={0}
                onCommit={(n) =>
                  setConsist({ freightCars: Math.max(0, Math.round(n ?? 0)) })
                }
              />
            </label>
            <label>
              Fill %
              <NumberField
                disabled={active.cargo.autoSizeConsist}
                value={Math.round(active.consist.fillFraction * 100)}
                emptyValue={0}
                onCommit={(n) =>
                  setConsist({
                    fillFraction: Math.min(100, Math.max(0, n ?? 0)) / 100,
                  })
                }
              />
            </label>
          </div>
          {sizing && (
            <dl className="stats sizing-stats">
              <div>
                <dt>Platforms</dt>
                <dd>{sizing.platforms}</dd>
              </div>
              <div>
                <dt>Items / trip</dt>
                <dd>{Math.round(sizing.itemsPerTrip)}</dd>
              </div>
              <div>
                <dt>Target</dt>
                <dd>{fmt(sizing.targetItemsPerMin, 0)}/min</dd>
              </div>
              <div>
                <dt>Car cap</dt>
                <dd>{sizing.carCapacity}</dd>
              </div>
            </dl>
          )}
        </>
      )}
    </FloatingPanel>
  );
}
