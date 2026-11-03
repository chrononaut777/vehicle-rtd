import { useProjectStore } from '../../store/useProjectStore';

function fmt(n: number, digits = 1) {
  return n.toFixed(digits);
}

export default function CoordsChip() {
  const cursor = useProjectStore((s) => s.cursor);

  return (
    <div className="coords-chip mono" aria-live="polite">
      {cursor
        ? `X ${fmt(cursor.x, 1)}  Y ${fmt(cursor.y, 1)}`
        : 'Move over map'}
    </div>
  );
}
