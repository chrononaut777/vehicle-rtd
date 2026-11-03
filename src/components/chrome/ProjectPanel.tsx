import { useRef } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { useUiStore } from '../../store/useUiStore';
import FloatingPanel from './FloatingPanel';

export default function ProjectPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const project = useProjectStore((s) => s.project);
  const setProjectName = useProjectStore((s) => s.setProjectName);
  const exportJson = useProjectStore((s) => s.exportJson);
  const importJsonText = useProjectStore((s) => s.importJsonText);
  const copyShareLink = useProjectStore((s) => s.copyShareLink);
  const clearRoute = useProjectStore((s) => s.clearRoute);
  const setPanel = useUiStore((s) => s.setPanel);

  return (
    <FloatingPanel title="Project" side="left" onClose={() => setPanel(null)}>
      <p className="tagline">Satisfactory round-trip planner</p>
      <label>
        Project name
        <input
          className="name-input"
          value={project.name}
          onChange={(e) => setProjectName(e.target.value)}
          aria-label="Project name"
        />
      </label>
      <div className="btn-row">
        <button type="button" onClick={() => exportJson()}>
          Export JSON
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          Import JSON
        </button>
        <button type="button" onClick={() => void copyShareLink()}>
          Copy share link
        </button>
        <button type="button" onClick={() => clearRoute()}>
          Clear active route
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const text = await file.text();
          importJsonText(text);
          e.target.value = '';
        }}
      />
      <p className="hint">
        Saved in this browser only. Share links encode the route in the URL hash
        — no server upload.
      </p>
      <footer className="panel-footer">
        Unofficial fan tool · Map tiles via SCIM CDN · Not affiliated with Coffee
        Stain Studios or Satisfactory-Calculator
      </footer>
    </FloatingPanel>
  );
}
