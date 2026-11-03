import { create } from 'zustand';
import {
  loadResourceNodesCatalog,
  type NodePurity,
  type ResourceNodesCatalog,
} from '../data/resourceNodes';

const PREFS_KEY = 'map-rtd:node-layers:v1';

interface NodeLayerPrefs {
  enabled: boolean;
  showWells: boolean;
  resources: Record<string, boolean>;
  purity: Record<NodePurity, boolean>;
}

interface NodeLayersState {
  catalog: ResourceNodesCatalog | null;
  loading: boolean;
  prefs: NodeLayerPrefs;
  ensureLoaded: () => Promise<void>;
  setEnabled: (enabled: boolean) => void;
  setShowWells: (show: boolean) => void;
  setResourceEnabled: (id: string, enabled: boolean) => void;
  setPurity: (purity: NodePurity, enabled: boolean) => void;
  enableAllResources: (enabled: boolean) => void;
}

function defaultPrefs(): NodeLayerPrefs {
  return {
    enabled: false,
    showWells: true,
    resources: {},
    purity: { impure: true, normal: true, pure: true },
  };
}

function loadPrefs(): NodeLayerPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaultPrefs();
    const parsed = JSON.parse(raw) as Partial<NodeLayerPrefs>;
    return {
      ...defaultPrefs(),
      ...parsed,
      purity: { ...defaultPrefs().purity, ...parsed.purity },
      resources: parsed.resources ?? {},
    };
  } catch {
    return defaultPrefs();
  }
}

function savePrefs(prefs: NodeLayerPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota
  }
}

function withDefaults(
  catalog: ResourceNodesCatalog | null,
  prefs: NodeLayerPrefs,
): NodeLayerPrefs {
  if (!catalog) return prefs;
  const resources = { ...prefs.resources };
  for (const r of catalog.resources) {
    if (resources[r.id] === undefined) resources[r.id] = true;
  }
  return { ...prefs, resources };
}

export const useNodeLayersStore = create<NodeLayersState>((set, get) => ({
  catalog: null,
  loading: false,
  prefs: loadPrefs(),

  async ensureLoaded() {
    if (get().catalog || get().loading) return;
    set({ loading: true });
    const catalog = await loadResourceNodesCatalog();
    const prefs = withDefaults(catalog, get().prefs);
    savePrefs(prefs);
    set({ catalog, prefs, loading: false });
  },

  setEnabled(enabled) {
    const prefs = { ...get().prefs, enabled };
    savePrefs(prefs);
    set({ prefs });
    if (enabled) void get().ensureLoaded();
  },

  setShowWells(showWells) {
    const prefs = { ...get().prefs, showWells };
    savePrefs(prefs);
    set({ prefs });
  },

  setResourceEnabled(id, enabled) {
    const prefs = {
      ...get().prefs,
      resources: { ...get().prefs.resources, [id]: enabled },
    };
    savePrefs(prefs);
    set({ prefs });
  },

  setPurity(purity, enabled) {
    const prefs = {
      ...get().prefs,
      purity: { ...get().prefs.purity, [purity]: enabled },
    };
    savePrefs(prefs);
    set({ prefs });
  },

  enableAllResources(enabled) {
    const resources = { ...get().prefs.resources };
    for (const r of get().catalog?.resources ?? []) {
      resources[r.id] = enabled;
    }
    const prefs = { ...get().prefs, resources };
    savePrefs(prefs);
    set({ prefs });
  },
}));
