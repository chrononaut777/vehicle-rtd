import { useUiStore, type UiPanel } from '../../store/useUiStore';
import { useProjectStore } from '../../store/useProjectStore';

const RAIL_ITEMS: {
  id: Exclude<UiPanel, null | 'layers' | 'coords'>;
  label: string;
  title: string;
}[] = [
  { id: 'routes', label: '☰', title: 'Routes' },
  { id: 'settings', label: '⚙', title: 'Route settings' },
  { id: 'issues', label: '!', title: 'Issues' },
  { id: 'project', label: '⧉', title: 'Project' },
];

export default function IconRail() {
  const panel = useUiStore((s) => s.panel);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const issues = useProjectStore((s) => s.issues);
  const issueCount = issues.filter(
    (i) => i.severity === 'error' || i.severity === 'warning',
  ).length;

  return (
    <nav className="icon-rail" aria-label="Map panels">
      <div className="icon-rail-brand" title="Map RTD">
        RTD
      </div>
      {RAIL_ITEMS.map((item) => {
        const active = panel === item.id;
        const showBadge = item.id === 'issues' && issueCount > 0;
        return (
          <button
            key={item.id}
            type="button"
            className={`icon-rail-btn ${active ? 'active' : ''} ${item.id === 'issues' && issueCount > 0 ? 'has-issues' : ''}`}
            title={item.title}
            aria-label={item.title}
            aria-pressed={active}
            onClick={() => togglePanel(item.id)}
          >
            <span aria-hidden>{item.label}</span>
            {showBadge && (
              <span className="icon-rail-badge">{issueCount > 9 ? '9+' : issueCount}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
