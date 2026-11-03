import { useUiStore } from '../../store/useUiStore';
import CoordsChip from './CoordsChip';
import CoordsPopover from './CoordsPopover';
import IconRail from './IconRail';
import IssuesPanel from './IssuesPanel';
import LayersControl from './LayersControl';
import ProjectPanel from './ProjectPanel';
import RoutesPanel from './RoutesPanel';
import RtHud from './RtHud';
import SelectionInspector from './SelectionInspector';
import SettingsPanel from './SettingsPanel';
import StatusToast from './StatusToast';
import ToolStrip from './ToolStrip';

export default function MapChrome() {
  const panel = useUiStore((s) => s.panel);

  return (
    <div className="map-chrome">
      <IconRail />
      <ToolStrip />
      <LayersControl />

      {panel === 'routes' && <RoutesPanel />}
      {panel === 'settings' && <SettingsPanel />}
      {panel === 'issues' && <IssuesPanel />}
      {panel === 'project' && <ProjectPanel />}
      {panel === 'coords' && <CoordsPopover />}

      <SelectionInspector />
      <CoordsChip />
      <StatusToast />
      <RtHud />
    </div>
  );
}
