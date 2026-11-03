import L from 'leaflet';
import { MAX_TILE_ZOOM, MIN_TILE_ZOOM } from '../domain/world';

/** Leaflet options aligned with SCIM GameMap (CRS.Simple + zoom range). */
export function createMapOptions(): L.MapOptions {
  return {
    crs: L.CRS.Simple,
    minZoom: MIN_TILE_ZOOM,
    maxZoom: MAX_TILE_ZOOM + 4,
    zoomSnap: 0.25,
    zoomDelta: 0.25,
    /** Avoid Leaflet’s default top-left zoom overlapping the icon rail. */
    zoomControl: false,
    attributionControl: true,
    preferCanvas: true,
  };
}
