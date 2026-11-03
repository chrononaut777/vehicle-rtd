import type { ReactNode } from 'react';

interface FloatingPanelProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Anchor side for desktop layout */
  side?: 'left' | 'right' | 'top-right';
}

export default function FloatingPanel({
  title,
  onClose,
  children,
  className = '',
  side = 'left',
}: FloatingPanelProps) {
  return (
    <div
      className={`floating-panel floating-panel-${side} ${className}`}
      role="dialog"
      aria-label={title}
    >
      <header className="floating-panel-header">
        <h2>{title}</h2>
        <button
          type="button"
          className="floating-panel-close"
          onClick={onClose}
          aria-label="Close panel"
        >
          ✕
        </button>
      </header>
      <div className="floating-panel-body">{children}</div>
    </div>
  );
}
