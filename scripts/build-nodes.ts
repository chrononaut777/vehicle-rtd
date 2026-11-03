/**
 * Build a compact resource-node dataset from SCIM mapData JSON.
 * Source is hotlinked at build time only — runtime loads local public/data/resource-nodes.json
 * (SCIM mapData is CORS-blocked from non-SCIM origins).
 *
 * Run: npm run build:nodes
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outPath = path.join(root, 'public', 'data', 'resource-nodes.json');

const SCIM_MAPDATA =
  'https://static.satisfactory-calculator.com/data/json/mapData/en-Stable.json?v=1793714818';

type Purity = 'impure' | 'normal' | 'pure';

function mapPurity(raw: string | undefined): Purity {
  if (raw === 'RP_Pure') return 'pure';
  if (raw === 'RP_Normal') return 'normal';
  return 'impure';
}

function resourceId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

interface ScimMarker {
  x: number;
  y: number;
  z?: number;
  type?: string;
  obstructed?: boolean;
}

interface ScimOption {
  layerId: string;
  name: string;
  purity?: string;
  outsideColor?: string;
  insideColor?: string;
  markers: ScimMarker[];
}

async function loadSource(): Promise<unknown> {
  const local = path.join(root, 'tmp-mapdata.json');
  if (fs.existsSync(local)) {
    return JSON.parse(fs.readFileSync(local, 'utf8'));
  }
  const res = await fetch(SCIM_MAPDATA, {
    headers: { 'User-Agent': 'map-rtd-build-nodes' },
  });
  if (!res.ok) throw new Error(`Failed to fetch SCIM mapData: ${res.status}`);
  return res.json();
}

function extractTab(
  data: {
    options: Array<{
      name?: string;
      options?: Array<{ name: string; options: ScimOption[] }>;
    }>;
    version?: string;
  },
  tabName: string,
  kind: 'node' | 'well',
) {
  const tab = data.options.find((o) => o.name === tabName);
  if (!tab?.options) return [];

  const resources: Array<{
    id: string;
    name: string;
    kind: 'node' | 'well';
    color: string;
    nodes: Array<{
      x: number;
      y: number;
      z: number;
      purity: Purity;
      obstructed?: boolean;
    }>;
  }> = [];

  for (const group of tab.options) {
    const id = resourceId(group.name);
    let color = '#888888';
    const nodes: Array<{
      x: number;
      y: number;
      z: number;
      purity: Purity;
      obstructed?: boolean;
    }> = [];

    for (const opt of group.options) {
      if (opt.outsideColor) color = opt.outsideColor;
      const purity = mapPurity(opt.purity);
      for (const m of opt.markers ?? []) {
        nodes.push({
          x: m.x / 100,
          y: m.y / 100,
          z: (m.z ?? 0) / 100,
          purity,
          ...(m.obstructed ? { obstructed: true } : {}),
        });
      }
    }

    if (nodes.length === 0) continue;
    resources.push({ id, name: group.name, kind, color, nodes });
  }

  return resources;
}

async function main() {
  const data = (await loadSource()) as {
    options: Array<{
      name?: string;
      options?: Array<{ name: string; options: ScimOption[] }>;
    }>;
    version?: string;
  };

  const resources = [
    ...extractTab(data, 'Resource nodes', 'node'),
    ...extractTab(data, 'Resource wells', 'well'),
  ];

  const payload = {
    source: 'SCIM mapData (Satisfactory-Calculator)',
    sourceUrl: SCIM_MAPDATA,
    version: data.version ?? 'Stable',
    generatedAt: new Date().toISOString(),
    count: resources.reduce((n, r) => n + r.nodes.length, 0),
    resources,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload));
  console.log(
    `Wrote ${outPath} (${payload.count} markers across ${resources.length} resources, ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
