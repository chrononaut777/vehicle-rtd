import { useNodeLayersStore } from '../store/useNodeLayersStore';
import { PURITY_FILL, PURITY_LABEL, type NodePurity } from '../data/resourceNodes';

export default function NodeLayersPanel({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const catalog = useNodeLayersStore((s) => s.catalog);
  const loading = useNodeLayersStore((s) => s.loading);
  const prefs = useNodeLayersStore((s) => s.prefs);
  const setEnabled = useNodeLayersStore((s) => s.setEnabled);
  const setShowWells = useNodeLayersStore((s) => s.setShowWells);
  const setResourceEnabled = useNodeLayersStore((s) => s.setResourceEnabled);
  const setPurity = useNodeLayersStore((s) => s.setPurity);
  const enableAllResources = useNodeLayersStore((s) => s.enableAllResources);

  const nodeGroups = catalog?.resources.filter((r) => r.kind === 'node') ?? [];
  const wellGroups = catalog?.resources.filter((r) => r.kind === 'well') ?? [];

  const body = (
    <>
      {!embedded && <h2>Resource nodes</h2>}
      <label className="check">
        <input
          type="checkbox"
          checked={prefs.enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Show SCIM nodes
      </label>
      <p className="hint">
        Lazy-loaded from a compact local extract of SCIM map data. Off by
        default for a snappy map.
      </p>

      {prefs.enabled && (
        <>
          {loading && <p className="hint">Loading nodes…</p>}
          {catalog && (
            <>
              <div className="purity-row">
                {(Object.keys(PURITY_LABEL) as NodePurity[]).map((p) => (
                  <label key={p} className="check purity-chip">
                    <input
                      type="checkbox"
                      checked={prefs.purity[p]}
                      onChange={(e) => setPurity(p, e.target.checked)}
                    />
                    <span
                      className="purity-dot"
                      style={{ background: PURITY_FILL[p] }}
                    />
                    {PURITY_LABEL[p]}
                  </label>
                ))}
              </div>

              <div className="btn-row tight">
                <button type="button" onClick={() => enableAllResources(true)}>
                  All resources
                </button>
                <button type="button" onClick={() => enableAllResources(false)}>
                  None
                </button>
              </div>

              <ul className="resource-toggles">
                {nodeGroups.map((r) => (
                  <li key={r.id}>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={prefs.resources[r.id] !== false}
                        onChange={(e) =>
                          setResourceEnabled(r.id, e.target.checked)
                        }
                      />
                      <span
                        className="resource-swatch"
                        style={{ background: r.color }}
                      />
                      {r.name}
                      <span className="count">{r.nodes.length}</span>
                    </label>
                  </li>
                ))}
              </ul>

              <label className="check" style={{ marginTop: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={prefs.showWells}
                  onChange={(e) => setShowWells(e.target.checked)}
                />
                Resource wells
              </label>
              {prefs.showWells && (
                <ul className="resource-toggles">
                  {wellGroups.map((r) => (
                    <li key={r.id}>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={prefs.resources[r.id] !== false}
                          onChange={(e) =>
                            setResourceEnabled(r.id, e.target.checked)
                          }
                        />
                        <span
                          className="resource-swatch"
                          style={{ background: r.color }}
                        />
                        {r.name}
                        <span className="count">{r.nodes.length}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}

              <p className="hint">
                {catalog.count} markers · SCIM {catalog.version}
              </p>
            </>
          )}
        </>
      )}
    </>
  );

  if (embedded) return <div className="node-layers-embedded">{body}</div>;
  return <section>{body}</section>;
}
