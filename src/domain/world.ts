/**
 * Satisfactory world + SCIM (Satisfactory-Calculator Interactive Map) projection.
 *
 * SCIM uses Leaflet CRS.Simple with a 40960px raster (32768 map + 4096 padding each side).
 * Game positions in SCIM converters are Unreal centimeters; our UI uses meters.
 *
 * Tile URL pattern (hotlinked, not redistributed):
 *   https://static.satisfactory-calculator.com/imgMap/gameLayer/Stable/{z}/{x}/{y}.png?v=…
 */

/** Playable / damage Z bounds (meters). */
export const WORLD = {
  minX: -3246,
  maxX: 4253,
  minY: -3750,
  maxY: 3750,
  minZ: -244,
  maxZ: 1997,
} as const;

export const WORLD_WIDTH = WORLD.maxX - WORLD.minX;
export const WORLD_HEIGHT = WORLD.maxY - WORLD.minY;

export const TILE_SIZE = 256;
export const MIN_TILE_ZOOM = 3;
export const MAX_TILE_ZOOM = 8;

/** Matches SCIM GameMap.js mapping bounds before padding (cm). */
const RAW = {
  west: -324698.832031,
  east: 425301.832031,
  north: -375000,
  south: 375000,
  backgroundSize: 32768,
  extraBackgroundSize: 4096,
} as const;

function buildScimProjection() {
  const westEastLength = Math.abs(RAW.west) + Math.abs(RAW.east);
  const northSouthLength = Math.abs(RAW.north) + Math.abs(RAW.south);
  const westEastRatio = westEastLength / RAW.backgroundSize;
  const northSouthRatio = northSouthLength / RAW.backgroundSize;
  const westOffset = westEastRatio * RAW.extraBackgroundSize;
  const northOffset = northSouthRatio * RAW.extraBackgroundSize;

  const mappingBoundWest = RAW.west - westOffset;
  const mappingBoundEast = RAW.east + westOffset;
  const mappingBoundNorth = RAW.north - northOffset;
  const mappingBoundSouth = RAW.south + northOffset;
  const backgroundSize = RAW.backgroundSize + RAW.extraBackgroundSize * 2;

  const xMax = Math.abs(mappingBoundWest) + Math.abs(mappingBoundEast);
  const yMax = Math.abs(mappingBoundNorth) + Math.abs(mappingBoundSouth);

  const zoomRatio = Math.ceil(
    Math.log(Math.max(backgroundSize, backgroundSize) / TILE_SIZE) / Math.log(2),
  );

  return {
    mappingBoundWest,
    mappingBoundEast,
    mappingBoundNorth,
    mappingBoundSouth,
    backgroundSize,
    xMax,
    yMax,
    xOffset: xMax - mappingBoundEast,
    yOffset: yMax - mappingBoundNorth,
    xRatio: Math.abs(backgroundSize) / xMax,
    yRatio: Math.abs(backgroundSize) / yMax,
    zoomRatio,
    scaleAtZoomRatio: 2 ** zoomRatio,
  };
}

export const SCIM = buildScimProjection();

export const SCIM_TILE_VERSION = '1793714818';

export type ScimBaseLayer = 'gameLayer' | 'realisticLayer';

export function scimTileUrl(layer: ScimBaseLayer = 'realisticLayer'): string {
  return `https://static.satisfactory-calculator.com/imgMap/${layer}/Stable/{z}/{x}/{y}.png?v=${SCIM_TILE_VERSION}`;
}

/** @deprecated use scimTileUrl() */
export const SCIM_TILE_URL = scimTileUrl('realisticLayer');

export const SCIM_ATTRIBUTION =
  'Map tiles © <a href="https://satisfactory-calculator.com/interactive-map" target="_blank" rel="noreferrer">Satisfactory-Calculator (SCIM)</a> · Not affiliated with Coffee Stain';

/** Game cm → SCIM raster pixel coords (at backgroundSize resolution). */
function toRasterCm(xCm: number, yCm: number): [number, number] {
  const x = (SCIM.xOffset + xCm) * SCIM.xRatio;
  const y = (SCIM.yOffset + yCm) * SCIM.yRatio - SCIM.backgroundSize;
  return [x, y];
}

/** Raster pixels → game cm (inverse of SCIM convertToGameCoordinates on projected point). */
function fromRasterCm(rx: number, ry: number): { xCm: number; yCm: number } {
  const xRatio = SCIM.xMax / Math.abs(SCIM.backgroundSize);
  const yRatio = SCIM.yMax / Math.abs(SCIM.backgroundSize);
  const xCm = rx * xRatio - (SCIM.xMax - SCIM.mappingBoundEast);
  const yCm = ry * yRatio - (SCIM.yMax - SCIM.mappingBoundNorth) + SCIM.yMax;
  return { xCm, yCm };
}

/**
 * Leaflet CRS.Simple: at zoom Z, project([lat,lng]) ≈ [lng, -lat] * 2^Z
 * so unproject([rx, ry], Z) → lat = -ry/2^Z, lng = rx/2^Z
 */
export function gameToLatLng(xMeters: number, yMeters: number): [number, number] {
  const [rx, ry] = toRasterCm(xMeters * 100, yMeters * 100);
  const s = SCIM.scaleAtZoomRatio;
  return [-ry / s, rx / s];
}

export function latLngToGame(lat: number, lng: number): { x: number; y: number } {
  const s = SCIM.scaleAtZoomRatio;
  const rx = lng * s;
  const ry = -lat * s;
  const { xCm, yCm } = fromRasterCm(rx, ry);
  return { x: xCm / 100, y: yCm / 100 };
}

export function clampToWorld(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(WORLD.maxX, Math.max(WORLD.minX, x)),
    y: Math.min(WORLD.maxY, Math.max(WORLD.minY, y)),
  };
}

/** Leaflet LatLngBounds for the full SCIM tile raster. */
export function worldBoundsLatLng(): [[number, number], [number, number]] {
  const s = SCIM.scaleAtZoomRatio;
  const southWest: [number, number] = [-SCIM.backgroundSize / s, 0];
  const northEast: [number, number] = [0, SCIM.backgroundSize / s];
  return [southWest, northEast];
}

export function mapCenterLatLng(): [number, number] {
  const half = SCIM.backgroundSize / 2 / SCIM.scaleAtZoomRatio;
  return [-half, half];
}
