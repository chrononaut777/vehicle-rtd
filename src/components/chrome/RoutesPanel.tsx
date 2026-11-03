import { getActiveRoute } from '../../domain/types';
import { useProjectStore } from '../../store/useProjectStore';
import { useUiStore } from '../../store/useUiStore';
import RouteList from '../RouteList';
import RouteOrderList from '../RouteOrderList';
import FloatingPanel from './FloatingPanel';

export default function RoutesPanel() {
  const project = useProjectStore((s) => s.project);
  const setVehicleType = useProjectStore((s) => s.setVehicleType);
  const setPanel = useUiStore((s) => s.setPanel);

  const active = getActiveRoute(project);
  const isDrone = active.vehicleType === 'drone';
  const stopWordPlural = isDrone ? 'ports' : 'stations';

  return (
    <FloatingPanel title="Routes" side="left" onClose={() => setPanel(null)}>
      <p className="hint">
        Shared stations/ports on one map; each route has its own path and
        vehicle type.
      </p>
      <RouteList />

      <h3 className="panel-subhead">Active — {active.name}</h3>
      <div className="btn-row vehicle-toggle" role="group" aria-label="Vehicle type">
        <button
          type="button"
          className={!isDrone ? 'active' : ''}
          onClick={() => setVehicleType('train')}
        >
          Train
        </button>
        <button
          type="button"
          className={isDrone ? 'active' : ''}
          onClick={() => setVehicleType('drone')}
        >
          Drone
        </button>
      </div>

      <h3 className="panel-subhead">Stop order</h3>
      <p className="hint">
        Drag rows to reorder which {stopWordPlural} are linked and in what
        sequence.
      </p>
      <RouteOrderList />
    </FloatingPanel>
  );
}
