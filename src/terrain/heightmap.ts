import { WORLD } from '../domain/world';

export interface HeightmapMeta {
  width: number;
  height: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Elevation = (raw / 65535) * (zMax - zMin) + zMin when encoding is uint16 */
  zMin: number;
  zMax: number;
  encoding: 'uint16';
  approximate: boolean;
  attribution: string;
}

export interface Heightmap {
  meta: HeightmapMeta;
  data: Uint16Array;
}

let cached: Heightmap | null = null;
let loadPromise: Promise<Heightmap | null> | null = null;

function defaultDataBase(): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  return `${base}data`;
}

export async function loadHeightmap(
  baseUrl = defaultDataBase(),
): Promise<Heightmap | null> {
  if (cached) return cached;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const metaRes = await fetch(`${baseUrl}/heightmap.json`);
      if (!metaRes.ok) return null;
      const meta = (await metaRes.json()) as HeightmapMeta;
      const binRes = await fetch(`${baseUrl}/heightmap.bin`);
      if (!binRes.ok) return null;
      const buf = await binRes.arrayBuffer();
      const data = new Uint16Array(buf);
      if (data.length < meta.width * meta.height) return null;
      cached = { meta, data };
      return cached;
    } catch {
      return null;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

/**
 * Sample terrain Z (meters) at game XY (meters).
 * Grid axes match WORLD / SCIM game space: u ← X (west→east),
 * v ← Y (north/minY → south/maxY). Same convention as the DEM builder.
 */
export function sampleHeight(hm: Heightmap, x: number, y: number): number | null {
  const { meta, data } = hm;
  if (x < meta.minX || x > meta.maxX || y < meta.minY || y > meta.maxY) {
    return null;
  }
  const u = ((x - meta.minX) / (meta.maxX - meta.minX)) * (meta.width - 1);
  // Row 0 = meta.minY (north, Y = −3750); last row = meta.maxY (south).
  const v = ((y - meta.minY) / (meta.maxY - meta.minY)) * (meta.height - 1);
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const x1 = Math.min(meta.width - 1, x0 + 1);
  const y1 = Math.min(meta.height - 1, y0 + 1);
  const tx = u - x0;
  const ty = v - y0;

  const at = (ix: number, iy: number) => {
    const raw = data[iy * meta.width + ix];
    return meta.zMin + (raw / 65535) * (meta.zMax - meta.zMin);
  };

  const h00 = at(x0, y0);
  const h10 = at(x1, y0);
  const h01 = at(x0, y1);
  const h11 = at(x1, y1);
  return (
    h00 * (1 - tx) * (1 - ty) +
    h10 * tx * (1 - ty) +
    h01 * (1 - tx) * ty +
    h11 * tx * ty
  );
}

/** Sync sample if already loaded. */
export function sampleHeightCached(x: number, y: number): number | null {
  if (!cached) return null;
  return sampleHeight(cached, x, y);
}

export function getCachedHeightmap(): Heightmap | null {
  return cached;
}

export function defaultMeta(): HeightmapMeta {
  return {
    width: 300,
    height: 300,
    minX: WORLD.minX,
    maxX: WORLD.maxX,
    minY: WORLD.minY,
    maxY: WORLD.maxY,
    zMin: -50,
    zMax: 500,
    encoding: 'uint16',
    approximate: true,
    attribution:
      'Placeholder DEM — approximate terrain for planning only. Not official Coffee Stain data.',
  };
}
