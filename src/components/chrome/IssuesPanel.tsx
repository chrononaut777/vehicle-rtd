import { getActiveRoute } from '../../domain/types';
import { useProjectStore } from '../../store/useProjectStore';
import { useUiStore } from '../../store/useUiStore';
import FloatingPanel from './FloatingPanel';

export default function IssuesPanel() {
  const project = useProjectStore((s) => s.project);
  const issues = useProjectStore((s) => s.issues);
  const mapFocus = useProjectStore((s) => s.mapFocus);
  const focusOnMap = useProjectStore((s) => s.focusOnMap);
  const setPanel = useUiStore((s) => s.setPanel);

  const active = getActiveRoute(project);
  const isDrone = active.vehicleType === 'drone';
  const stopWordPlural = isDrone ? 'ports' : 'stations';

  return (
    <FloatingPanel title="Issues" side="left" onClose={() => setPanel(null)}>
      {issues.length === 0 ? (
        <p className="hint">No issues.</p>
      ) : (
        <ul className="issues">
          {issues.map((iss) => {
            const hasCoords = iss.x != null && iss.y != null;
            const activeIssue = mapFocus?.issueId === iss.id;
            const sevLabel =
              iss.severity === 'error'
                ? 'Error'
                : iss.severity === 'warning'
                  ? 'Warning'
                  : 'Info';
            const body = (
              <>
                <span className="issue-sev-label">{sevLabel}</span>
                <span className="issue-message">{iss.message}</span>
              </>
            );
            return (
              <li key={iss.id} className={`sev-${iss.severity}`}>
                {hasCoords ? (
                  <button
                    type="button"
                    className={`issue-jump ${activeIssue ? 'active' : ''}`}
                    onClick={() => focusOnMap(iss.x!, iss.y!, iss.id)}
                    title={`Show on map (${iss.x!.toFixed(0)}, ${iss.y!.toFixed(0)})`}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="issue-static">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {issues.some(
        (i) =>
          i.severity === 'error' ||
          i.severity === 'warning' ||
          (i.x != null && i.y != null),
      ) && (
        <>
          {(issues.some((i) => i.severity === 'error') ||
            issues.some((i) => i.severity === 'warning')) && (
            <div className="issue-map-legend" aria-label="Map highlight colors">
              <span>
                <i className="issue-swatch error" aria-hidden /> Error on map
              </span>
              <span>
                <i className="issue-swatch warning" aria-hidden /> Warning on map
              </span>
              <span>
                <i className="issue-swatch route" aria-hidden /> Clear track
              </span>
            </div>
          )}
          {issues.some((i) => i.x != null && i.y != null) && (
            <p className="hint">
              Colored {stopWordPlural}/segments match these issues. Click a
              located issue to spotlight it.
            </p>
          )}
        </>
      )}
    </FloatingPanel>
  );
}
