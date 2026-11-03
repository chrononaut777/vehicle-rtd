/**
 * Generate a coarse placeholder DEM matching the procedural basemap noise.
 * Approximate only — suitable for flat-track clearance hints.
 *
 * Run: npm run build:heightmap
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'public', 'data');

const WIDTH = 300;
const HEIGHT = 300;
const minX = -3246;
const maxX = 4253;
const minY = -3750;
const maxY = 3750;
const zMin = -40;
const zMax = 480;

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

function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const data = new Uint16Array(WIDTH * HEIGHT);

  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH; col++) {
      const nx = col / (WIDTH - 1);
      const ny = row / (HEIGHT - 1);
      const h = fbm(nx * 4.2, ny * 4.2);
      // Bias mountains toward edges similar to island feel
      const edge =
        Math.min(nx, 1 - nx, ny, 1 - ny) < 0.08 ? 0.15 : 0;
      const elev = Math.min(1, Math.max(0, h * 0.95 + edge));
      data[row * WIDTH + col] = Math.round(elev * 65535);
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
    encoding: 'uint16',
    approximate: true,
    attribution:
      'Placeholder DEM generated from procedural noise — approximate terrain for planning only. Not official Coffee Stain data.',
  };

  fs.writeFileSync(path.join(outDir, 'heightmap.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(outDir, 'heightmap.bin'), Buffer.from(data.buffer));
  console.log('Wrote public/data/heightmap.json and heightmap.bin');
}

main();
