import { useEffect, useMemo } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { gameToLatLng } from '../domain/world';
import { PURITY_FILL, PURITY_LABEL } from '../data/resourceNodes';
import { useNodeLayersStore } from '../store/useNodeLayersStore';

/** Canvas-backed SCIM resource markers — one shared renderer, rebuilt only when filters change. */
export default function ResourceNodesLayer() {
  const map = useMap();
  const catalog = useNodeLayersStore((s) => s.catalog);
  const prefs = useNodeLayersStore((s) => s.prefs);
  const ensureLoaded = useNodeLayersStore((s) => s.ensureLoaded);

  useEffect(() => {
    if (prefs.enabled) void ensureLoaded();
  }, [prefs.enabled, ensureLoaded]);

  const filterKey = useMemo(() => {
    if (!prefs.enabled || !catalog) return '';
    const res = catalog.resources
      .filter((r) => prefs.resources[r.id] !== false)
      .filter((r) => (r.kind === 'well' ? prefs.showWells : true))
      .map((r) => r.id)
      .join(',');
    const pur = (['impure', 'normal', 'pure'] as const)
      .filter((p) => prefs.purity[p])
      .join(',');
    return `${res}|${pur}|wells:${prefs.showWells}`;
  }, [catalog, prefs]);

  useEffect(() => {
    if (!prefs.enabled || !catalog || !filterKey) return;

    const canvas = L.canvas({ padding: 0.5 });
    const group = L.layerGroup();

    for (const resource of catalog.resources) {
      if (prefs.resources[resource.id] === false) continue;
      if (resource.kind === 'well' && !prefs.showWells) continue;

      for (const node of resource.nodes) {
        if (!prefs.purity[node.purity]) continue;

        const marker = L.circleMarker(gameToLatLng(node.x, node.y), {
          radius: resource.kind === 'well' ? 6 : 5,
          color: resource.color,
          fillColor: PURITY_FILL[node.purity],
          fillOpacity: node.obstructed ? 0.35 : 0.92,
          weight: 1.5,
          opacity: 0.95,
          renderer: canvas,
          interactive: true,
        });

        marker.bindTooltip(
          `${resource.name} · ${PURITY_LABEL[node.purity]}<br/>X ${node.x.toFixed(1)}  Y ${node.y.toFixed(1)}  Z ${node.z.toFixed(1)}${node.obstructed ? '<br/><em>Obstructed</em>' : ''}`,
          { sticky: true, opacity: 0.95 },
        );
        marker.addTo(group);
      }
    }

    group.addTo(map);
    return () => {
      map.removeLayer(group);
      if (map.hasLayer(canvas)) map.removeLayer(canvas);
    };
  }, [map, catalog, prefs.enabled, filterKey, prefs.resources, prefs.purity, prefs.showWells]);

  return null;
}
