import { useEffect } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { useUiStore } from '../store/useUiStore';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

/** Esc clears selection first, then closes the floating panel. */
export function useChromeHotkeys() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isEditableTarget(e.target)) return;

      const {
        selectedStationIds,
        selectedWaypointIds,
        selectedMidpointIndices,
        selectStation,
      } = useProjectStore.getState();
      if (
        selectedStationIds.length ||
        selectedWaypointIds.length ||
        selectedMidpointIndices.length
      ) {
        e.preventDefault();
        selectStation(null);
        return;
      }

      const { panel, setPanel } = useUiStore.getState();
      if (panel) {
        e.preventDefault();
        setPanel(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
