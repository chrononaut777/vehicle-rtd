import { describe, expect, it } from 'vitest';
import { sampleHeight, type Heightmap } from './heightmap';

function makeRamp(): Heightmap {
  // 3×3 grid: elevation rises with X and with Y (south).
  // raw = col*1000 + row*3000 → decode with zMin=0,zMax=65535 → raw itself.
  const width = 3;
  const height = 3;
  const data = new Uint16Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      data[row * width + col] = col * 1000 + row * 3000;
    }
  }
  return {
    meta: {
      width,
      height,
      minX: 0,
      maxX: 200,
      minY: 0,
      maxY: 200,
      zMin: 0,
      zMax: 65535,
      encoding: 'uint16',
      approximate: true,
      attribution: 'test',
    },
    data,
  };
}

describe('sampleHeight axes', () => {
  it('maps west→east on columns and north/minY→south on rows', () => {
    const hm = makeRamp();
    const sw = sampleHeight(hm, 0, 0)!;
    const se = sampleHeight(hm, 200, 0)!;
    const nw = sampleHeight(hm, 0, 200)!;
    const ne = sampleHeight(hm, 200, 200)!;
    expect(se).toBeGreaterThan(sw);
    expect(nw).toBeGreaterThan(sw);
    expect(ne).toBeGreaterThan(se);
    expect(ne).toBeGreaterThan(nw);
  });

  it('returns null outside bounds', () => {
    const hm = makeRamp();
    expect(sampleHeight(hm, -1, 100)).toBeNull();
    expect(sampleHeight(hm, 100, 201)).toBeNull();
  });
});
