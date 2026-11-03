import { useEffect } from 'react';
import { CircleMarker, useMap } from 'react-leaflet';
import { gameToLatLng, MAX_TILE_ZOOM } from '../domain/world';
import { useProjectStore } from '../store/useProjectStore';

const FOCUS_ZOOM = Math.min(MAX_TILE_ZOOM, 6);

/** Flies the map to a focused issue and draws a pulsing highlight. */
export default function IssueFocusLayer() {
  const map = useMap();
  const mapFocus = useProjectStore((s) => s.mapFocus);
  const clearMapFocus = useProjectStore((s) => s.clearMapFocus);

  useEffect(() => {
    if (!mapFocus) return;
    const target = gameToLatLng(mapFocus.x, mapFocus.y);
    const zoom = Math.max(map.getZoom(), FOCUS_ZOOM);
    map.flyTo(target, zoom, { duration: 0.65 });

    const timer = window.setTimeout(() => clearMapFocus(), 4500);
    return () => window.clearTimeout(timer);
  }, [map, mapFocus, clearMapFocus]);

  if (!mapFocus) return null;

  const center = gameToLatLng(mapFocus.x, mapFocus.y);

  return (
    <>
      <CircleMarker
        center={center}
        radius={18}
        pathOptions={{
          color: '#e6b84d',
          fillColor: '#e6b84d',
          fillOpacity: 0.15,
          weight: 2,
          className: 'issue-focus-ring',
        }}
      />
      <CircleMarker
        center={center}
        radius={7}
        pathOptions={{
          color: '#1a1a1a',
          fillColor: '#ffcc33',
          fillOpacity: 1,
          weight: 2,
        }}
      />
    </>
  );
}
