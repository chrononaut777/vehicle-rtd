import { getActiveRoute } from '../../domain/types';
import { useProjectStore, type ToolMode } from '../../store/useProjectStore';
import { useUiStore } from '../../store/useUiStore';

const TOOLS: { id: ToolMode; label: string; title: string }[] = [
  { id: 'place-station', label: '＋', title: 'Place stop' },
  { id: 'link-route', label: '⛓', title: 'Link route' },
  { id: 'add-waypoint', label: '◉', title: 'Add waypoint' },
  { id: 'pan', label: '↖', title: 'Select' },
];

export default function ToolStrip() {
  const tool = useProjectStore((s) => s.tool);
  const setTool = useProjectStore((s) => s.setTool);
  const project = useProjectStore((s) => s.project);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const panel = useUiStore((s) => s.panel);

  const active = getActiveRoute(project);
  const isDrone = active.vehicleType === 'drone';
  const placeTitle = isDrone ? 'Place port' : 'Place station';

  return (
    <div className="tool-strip" role="toolbar" aria-label="Map tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={tool === t.id ? 'active' : ''}
          title={t.id === 'place-station' ? placeTitle : t.title}
          aria-label={t.id === 'place-station' ? placeTitle : t.title}
          aria-pressed={tool === t.id}
          onClick={() => setTool(t.id)}
        >
          {t.label}
        </button>
      ))}
      <span className="tool-strip-sep" aria-hidden />
      <button
        type="button"
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        onClick={() => undo()}
      >
        ↶
      </button>
      <button
        type="button"
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
        aria-label="Redo"
        onClick={() => redo()}
      >
        ↷
      </button>
      <span className="tool-strip-sep" aria-hidden />
      <button
        type="button"
        className={panel === 'coords' ? 'active' : ''}
        title="Place at coordinates"
        aria-label="Place at coordinates"
        aria-pressed={panel === 'coords'}
        onClick={() => togglePanel('coords')}
      >
        ⌖
      </button>
    </div>
  );
}
