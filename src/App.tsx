import { useEffect } from 'react';
import MapChrome from './components/chrome/MapChrome';
import MapView from './map/MapView';
import { useChromeHotkeys } from './hooks/useChromeHotkeys';
import { useHistoryHotkeys } from './hooks/useHistoryHotkeys';
import { useProjectStore } from './store/useProjectStore';

export default function App() {
  const hydrate = useProjectStore((s) => s.hydrate);
  const hydrated = useProjectStore((s) => s.hydrated);
  useHistoryHotkeys();
  useChromeHotkeys();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <div className="app-shell">
      <main className="map-pane">
        {hydrated ? <MapView /> : <div className="loading">Loading…</div>}
        {hydrated && <MapChrome />}
      </main>
    </div>
  );
}
