import { create } from 'zustand';
import type { ScimBaseLayer } from '../domain/world';

export type UiPanel =
  | 'routes'
  | 'settings'
  | 'issues'
  | 'project'
  | 'coords'
  | 'layers'
  | null;

interface UiState {
  panel: UiPanel;
  baseLayer: ScimBaseLayer;
  rtExpanded: boolean;
  setPanel: (panel: UiPanel) => void;
  togglePanel: (panel: Exclude<UiPanel, null>) => void;
  setBaseLayer: (layer: ScimBaseLayer) => void;
  setRtExpanded: (expanded: boolean) => void;
  toggleRtExpanded: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  panel: null,
  baseLayer: 'realisticLayer',
  rtExpanded: false,

  setPanel(panel) {
    set({ panel });
  },

  togglePanel(panel) {
    set({ panel: get().panel === panel ? null : panel });
  },

  setBaseLayer(layer) {
    set({ baseLayer: layer });
  },

  setRtExpanded(expanded) {
    set({ rtExpanded: expanded });
  },

  toggleRtExpanded() {
    set({ rtExpanded: !get().rtExpanded });
  },
}));
