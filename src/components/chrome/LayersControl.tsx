import { useUiStore } from '../../store/useUiStore';
import NodeLayersPanel from '../NodeLayersPanel';
import FloatingPanel from './FloatingPanel';

export default function LayersControl() {
  const baseLayer = useUiStore((s) => s.baseLayer);
  const setBaseLayer = useUiStore((s) => s.setBaseLayer);
  const panel = useUiStore((s) => s.panel);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const setPanel = useUiStore((s) => s.setPanel);

  return (
    <div className="layers-control">
      <div className="map-layer-toggle" role="group" aria-label="Basemap style">
        <button
          type="button"
          className={baseLayer === 'realisticLayer' ? 'active' : ''}
          onClick={() => setBaseLayer('realisticLayer')}
        >
          Realistic
        </button>
        <button
          type="button"
          className={baseLayer === 'gameLayer' ? 'active' : ''}
          onClick={() => setBaseLayer('gameLayer')}
        >
          Game map
        </button>
        <button
          type="button"
          className={`layers-toggle-btn ${panel === 'layers' ? 'active' : ''}`}
          title="Resource nodes"
          aria-label="Resource nodes"
          aria-pressed={panel === 'layers'}
          onClick={() => togglePanel('layers')}
        >
          ⬡
        </button>
      </div>
      {panel === 'layers' && (
        <FloatingPanel
          title="Map layers"
          side="top-right"
          className="layers-panel"
          onClose={() => setPanel(null)}
        >
          <NodeLayersPanel embedded />
        </FloatingPanel>
      )}
    </div>
  );
}
