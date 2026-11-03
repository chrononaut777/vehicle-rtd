import { WORLD } from '../../domain/world';
import { useProjectStore } from '../../store/useProjectStore';
import { useUiStore } from '../../store/useUiStore';
import FloatingPanel from './FloatingPanel';

export default function CoordsPopover() {
  const placeStationAt = useProjectStore((s) => s.placeStationAt);
  const setPanel = useUiStore((s) => s.setPanel);

  return (
    <FloatingPanel
      title="Place at coordinates"
      side="left"
      className="coords-popover"
      onClose={() => setPanel(null)}
    >
      <p className="hint">
        World X [{WORLD.minX}…{WORLD.maxX}] Y [{WORLD.minY}…{WORLD.maxY}]
      </p>
      <form
        className="coord-form"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const x = Number(fd.get('x'));
          const y = Number(fd.get('y'));
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          placeStationAt(x, y);
          setPanel(null);
        }}
      >
        <div className="coord-fields">
          <label>
            X
            <input name="x" type="number" step="any" defaultValue={0} />
          </label>
          <label>
            Y
            <input name="y" type="number" step="any" defaultValue={0} />
          </label>
        </div>
        <button type="submit">Place here</button>
      </form>
    </FloatingPanel>
  );
}
