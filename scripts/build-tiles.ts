/**
 * Generate a self-hosted Satisfactory-style basemap and optional tile pyramid.
 * Uses a procedural topo/biome-inspired rendering — not Coffee Stain game art.
 *
 * Run: npm run build:tiles
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'public', 'tiles');

const SIZE = 2048;
const MAX_ZOOM = 4;

/** Simple value noise */
function hash(ix: number, iy: number): number {
  const n = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0);
  const b = hash(x0 + 1, y0);
  const c = hash(x0, y0 + 1);
  const d = hash(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number): number {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 5; i++) {
    v += amp * smoothNoise(x * freq, y * freq);
    amp *= 0.5;
    freq *= 2;
  }
  return v;
}

function biomeColor(nx: number, ny: number, h: number): [number, number, number] {
  // Rough region tint inspired by Satisfactory biome layout (not asset copies)
  const desert = nx > 0.55 && ny < 0.45;
  const swamp = nx > 0.55 && ny > 0.55;
  const northern = ny < 0.28;
  const coast = nx < 0.18;

  let r = 52 + h * 40;
  let g = 78 + h * 50;
  let b = 48 + h * 30;

  if (desert) {
    r = 140 + h * 50;
    g = 110 + h * 30;
    b = 60 + h * 20;
  } else if (swamp) {
    r = 40 + h * 20;
    g = 70 + h * 35;
    b = 55 + h * 25;
  } else if (northern) {
    r = 60 + h * 25;
    g = 90 + h * 40;
    b = 70 + h * 20;
  } else if (coast) {
    r = 45 + h * 20;
    g = 85 + h * 30;
    b = 95 + h * 40;
  }

  // Water-ish lows
  if (h < 0.28) {
    r = 30 + h * 40;
    g = 55 + h * 50;
    b = 90 + h * 80;
  }

  // Ridges
  if (h > 0.72) {
    r = Math.min(255, r + 40);
    g = Math.min(255, g + 35);
    b = Math.min(255, b + 30);
  }

  return [r | 0, g | 0, b | 0];
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const raw = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const nx = x / (SIZE - 1);
      const ny = y / (SIZE - 1);
      const h = fbm(nx * 4.2, ny * 4.2);
      const [r, g, b] = biomeColor(nx, ny, h);
      // Hillshade-ish
      const h2 = fbm((nx + 1 / SIZE) * 4.2, ny * 4.2);
      const shade = 0.85 + 0.3 * (h - h2);
      const i = (y * SIZE + x) * 3;
      raw[i] = Math.min(255, Math.max(0, r * shade));
      raw[i + 1] = Math.min(255, Math.max(0, g * shade));
      raw[i + 2] = Math.min(255, Math.max(0, b * shade));
    }
  }

  // Grid + origin cross for orientation
  for (let i = 0; i < SIZE; i++) {
    const mid = (SIZE / 2) | 0;
    for (const [x, y] of [
      [i, mid],
      [mid, i],
    ] as const) {
      const idx = (y * SIZE + x) * 3;
      raw[idx] = Math.min(255, raw[idx] + 35);
      raw[idx + 1] = Math.min(255, raw[idx + 1] + 35);
      raw[idx + 2] = Math.min(255, raw[idx + 2] + 20);
    }
  }

  const basemap = sharp(raw, { raw: { width: SIZE, height: SIZE, channels: 3 } });
  await basemap.webp({ quality: 82 }).toFile(path.join(outDir, 'basemap.webp'));
  console.log('Wrote public/tiles/basemap.webp');

  // Empty tile for 404 fallback
  await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 3,
      background: { r: 18, g: 22, b: 28 },
    },
  })
    .webp({ quality: 70 })
    .toFile(path.join(outDir, 'empty.webp'));

  // Optional pyramid (useful if switching back to TileLayer)
  for (let z = 0; z <= MAX_ZOOM; z++) {
    const n = 1 << z;
    const tilePx = SIZE / n;
    for (let ty = 0; ty < n; ty++) {
      for (let tx = 0; tx < n; tx++) {
        const dir = path.join(outDir, String(z), String(tx));
        fs.mkdirSync(dir, { recursive: true });
        const left = Math.floor(tx * tilePx);
        const top = Math.floor(ty * tilePx);
        const width = Math.floor((tx + 1) * tilePx) - left;
        const height = Math.floor((ty + 1) * tilePx) - top;
        await sharp(raw, {
          raw: { width: SIZE, height: SIZE, channels: 3 },
        })
          .extract({ left, top, width, height })
          .resize(256, 256, { fit: 'fill' })
          .webp({ quality: 78 })
          .toFile(path.join(dir, `${ty}.webp`));
      }
    }
    console.log(`Zoom ${z} tiles done (${n}×${n})`);
  }

  fs.writeFileSync(
    path.join(outDir, 'ATTRIBUTION.txt'),
    [
      'Basemap is procedurally generated for map-rtd.',
      'It is NOT Coffee Stain Studios game art and is not sourced from satisfactory-calculator tiles.',
      'Biome color regions are a rough fan approximation of the Satisfactory world layout.',
      '',
    ].join('\n'),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
