/**
 * Build a coarse DEM from SCIM mapData marker elevations (resource nodes,
 * wells, slugs, collectibles, …). Approximate surface only — markers are
 * sparse and not a true landscape heightfield.
 *
 * Axes match game meters / WORLD bounds: grid column 0 = minX (west),
 * row 0 = minY (north, Y = −3750). sampleHeight() uses the same mapping.
 *
 * Run: npm run build:heightmap
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'public', 'data');

const SCIM_MAPDATA =
  'https://static.satisfactory-calculator.com/data/json/mapData/en-Stable.json?v=1793714818';

const WIDTH = 400;
const HEIGHT = 400;
const minX = -3246;
const maxX = 4253;
const minY = -3750;
const maxY = 3750;

/** k nearest markers, inverse-distance^power */
const K = 8;
const POWER = 2;
const CELL = 250; // spatial hash cell size (game meters)

interface Sample {
  x: number;
  y: number;
  z: number;
}

async function loadMapData(): Promise<unknown> {
  const local = path.join(root, 'tmp-mapdata.json');
  if (fs.existsSync(local)) {
    return JSON.parse(fs.readFileSync(local, 'utf8'));
  }
  const res = await fetch(SCIM_MAPDATA, {
    headers: { 'User-Agent': 'map-rtd-build-heightmap' },
  });
  if (!res.ok) throw new Error(`Failed to fetch SCIM mapData: ${res.status}`);
  return res.json();
}

function collectSamples(rootNode: unknown): Sample[] {
  const pts: Sample[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as {
      markers?: Array<{ x?: number; y?: number; z?: number }>;
      options?: unknown[];
    };
    if (Array.isArray(n.markers)) {
      for (const m of n.markers) {
        if (
          m &&
          typeof m.x === 'number' &&
          typeof m.y === 'number' &&
          typeof m.z === 'number' &&
          Number.isFinite(m.x) &&
          Number.isFinite(m.y) &&
          Number.isFinite(m.z)
        ) {
          pts.push({ x: m.x / 100, y: m.y / 100, z: m.z / 100 });
        }
      }
    }
    if (Array.isArray(n.options)) {
      for (const child of n.options) walk(child);
    }
  };
  walk(rootNode);
  return pts;
}

function buildSpatialHash(pts: Sample[]) {
  const buckets = new Map<string, Sample[]>();
  const key = (ix: number, iy: number) => `${ix},${iy}`;
  for (const p of pts) {
    const ix = Math.floor(p.x / CELL);
    const iy = Math.floor(p.y / CELL);
    const k = key(ix, iy);
    const arr = buckets.get(k);
    if (arr) arr.push(p);
    else buckets.set(k, [p]);
  }
  return { buckets, key };
}

function idwAt(
  gx: number,
  gy: number,
  pts: Sample[],
  hash: ReturnType<typeof buildSpatialHash>,
): number {
  const cx = Math.floor(gx / CELL);
  const cy = Math.floor(gy / CELL);
  const candidates: Sample[] = [];
  // Expand ring until we have enough candidates (sparse regions).
  for (let ring = 0; ring <= 12 && candidates.length < K * 3; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (ring > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const cell = hash.buckets.get(hash.key(cx + dx, cy + dy));
        if (cell) candidates.push(...cell);
      }
    }
  }
  const pool = candidates.length > 0 ? candidates : pts;
  const scored: Array<{ z: number; d2: number }> = [];
  for (const p of pool) {
    const dx = p.x - gx;
    const dy = p.y - gy;
    scored.push({ z: p.z, d2: dx * dx + dy * dy });
  }
  scored.sort((a, b) => a.d2 - b.d2);
  const nearest = scored.slice(0, K);
  if (nearest.length === 0) return 0;
  if (nearest[0].d2 < 1e-8) return nearest[0].z;

  let num = 0;
  let den = 0;
  for (const s of nearest) {
    const w = 1 / Math.pow(s.d2, POWER / 2);
    num += w * s.z;
    den += w;
  }
  return num / den;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const mapData = await loadMapData();
  const samples = collectSamples(mapData);
  if (samples.length < 100) {
    throw new Error(`Too few elevation samples (${samples.length})`);
  }

  let zMin = Infinity;
  let zMax = -Infinity;
  for (const s of samples) {
    if (s.z < zMin) zMin = s.z;
    if (s.z > zMax) zMax = s.z;
  }
  // Small pad so encode doesn't clip IDW extremes.
  zMin = Math.floor(zMin - 10);
  zMax = Math.ceil(zMax + 10);
  const zRange = zMax - zMin;

  const hash = buildSpatialHash(samples);
  const data = new Uint16Array(WIDTH * HEIGHT);

  for (let row = 0; row < HEIGHT; row++) {
    const y = minY + (row / (HEIGHT - 1)) * (maxY - minY);
    for (let col = 0; col < WIDTH; col++) {
      const x = minX + (col / (WIDTH - 1)) * (maxX - minX);
      const elev = idwAt(x, y, samples, hash);
      const t = Math.min(1, Math.max(0, (elev - zMin) / zRange));
      data[row * WIDTH + col] = Math.round(t * 65535);
    }
  }

  const meta = {
    width: WIDTH,
    height: HEIGHT,
    minX,
    maxX,
    minY,
    maxY,
    zMin,
    zMax,
    encoding: 'uint16' as const,
    approximate: true,
    attribution:
      'Approximate DEM interpolated from SCIM mapData marker elevations (Satisfactory-Calculator). Not an official Coffee Stain heightfield.',
    sampleCount: samples.length,
  };

  fs.writeFileSync(path.join(outDir, 'heightmap.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(outDir, 'heightmap.bin'), Buffer.from(data.buffer));

  // Sanity: red-jungle plateau (west) vs adjacent water basin (east).
  const decode = (raw: number) => zMin + (raw / 65535) * zRange;
  const at = (x: number, y: number) => {
    const u = ((x - minX) / (maxX - minX)) * (WIDTH - 1);
    const v = ((y - minY) / (maxY - minY)) * (HEIGHT - 1);
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const x1 = Math.min(WIDTH - 1, x0 + 1);
    const y1 = Math.min(HEIGHT - 1, y0 + 1);
    const tx = u - x0;
    const ty = v - y0;
    const elev = (ix: number, iy: number) => decode(data[iy * WIDTH + ix]);
    return (
      elev(x0, y0) * (1 - tx) * (1 - ty) +
      elev(x1, y0) * tx * (1 - ty) +
      elev(x0, y1) * (1 - tx) * ty +
      elev(x1, y1) * tx * ty
    );
  };
  const plateau = at(250, 940);
  const water = at(400, 930);
  console.log(
    `Wrote public/data/heightmap.json and heightmap.bin (${samples.length} samples, z ${zMin}…${zMax})`,
  );
  console.log(
    `Sanity plateau(250,940)=${plateau.toFixed(1)} m  water(400,930)=${water.toFixed(1)} m  Δ=${(plateau - water).toFixed(1)} m`,
  );
  if (!(plateau > water + 100)) {
    console.warn('Warning: expected plateau substantially higher than water basin.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
