import { useEffect } from 'react';
import { useProjectStore } from '../store/useProjectStore';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

/** Ctrl/Cmd+Z undo/redo; Ctrl+C/V station copy-paste; Delete removes selection. */
export function useHistoryHotkeys() {
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const deleteSelection = useProjectStore((s) => s.deleteSelection);
  const copyStation = useProjectStore((s) => s.copyStation);
  const pasteStation = useProjectStore((s) => s.pasteStation);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const { selectedStationIds, selectedWaypointIds } = useProjectStore.getState();
        if (selectedStationIds.length || selectedWaypointIds.length) {
          e.preventDefault();
          deleteSelection();
        }
        return;
      }

      if (!(e.ctrlKey || e.metaKey)) return;

      const key = e.key.toLowerCase();
      if (key === 'c') {
        const { selectedStationIds } = useProjectStore.getState();
        if (selectedStationIds.length === 1) {
          e.preventDefault();
          copyStation(selectedStationIds[0]);
        }
        return;
      }
      if (key === 'v') {
        const { stationClipboard } = useProjectStore.getState();
        if (stationClipboard) {
          e.preventDefault();
          pasteStation();
        }
        return;
      }
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, deleteSelection, copyStation, pasteStation]);
}
