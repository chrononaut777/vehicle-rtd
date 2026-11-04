import { useEffect, useState } from 'react';
import { useProjectStore } from '../../store/useProjectStore';

/** Visible hold before fade starts. */
const SHOW_MS = 4500;
/** Must match `.status-toast` opacity transition. */
const FADE_MS = 450;

export default function StatusToast() {
  const statusMessage = useProjectStore((s) => s.statusMessage);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (!statusMessage) {
      setFading(false);
      return;
    }
    setFading(false);
    const fadeTimer = window.setTimeout(() => setFading(true), SHOW_MS);
    const clearTimer = window.setTimeout(() => {
      useProjectStore.setState({ statusMessage: null });
    }, SHOW_MS + FADE_MS);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(clearTimer);
    };
  }, [statusMessage]);

  if (!statusMessage) return null;
  return (
    <div className={`status-toast${fading ? ' is-fading' : ''}`} role="status">
      {statusMessage}
    </div>
  );
}
