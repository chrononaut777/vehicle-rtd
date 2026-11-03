export type NodePurity = 'impure' | 'normal' | 'pure';

export interface ResourceNodePoint {
  x: number;
  y: number;
  z: number;
  purity: NodePurity;
  obstructed?: boolean;
}

export interface ResourceGroup {
  id: string;
  name: string;
  kind: 'node' | 'well';
  color: string;
  nodes: ResourceNodePoint[];
}

export interface ResourceNodesCatalog {
  source: string;
  version: string;
  count: number;
  resources: ResourceGroup[];
}

let cached: ResourceNodesCatalog | null = null;
let loadPromise: Promise<ResourceNodesCatalog | null> | null = null;

export async function loadResourceNodesCatalog(): Promise<ResourceNodesCatalog | null> {
  if (cached) return cached;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
      const res = await fetch(`${base}data/resource-nodes.json`);
      if (!res.ok) return null;
      const data = (await res.json()) as ResourceNodesCatalog;
      if (!Array.isArray(data.resources)) return null;
      cached = data;
      return cached;
    } catch {
      return null;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

export function getCachedResourceNodes(): ResourceNodesCatalog | null {
  return cached;
}

export const PURITY_FILL: Record<NodePurity, string> = {
  impure: '#d23430',
  normal: '#f26418',
  pure: '#80b139',
};

export const PURITY_LABEL: Record<NodePurity, string> = {
  impure: 'Impure',
  normal: 'Normal',
  pure: 'Pure',
};
