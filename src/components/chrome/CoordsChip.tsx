import { sampleHeight } from '../../terrain/heightmap';
import { useProjectStore } from '../../store/useProjectStore';

function fmt(n: number, digits = 1) {
  return n.toFixed(digits);
}

export default function CoordsChip() {
  const cursor = useProjectStore((s) => s.cursor);
  const heightmap = useProjectStore((s) => s.heightmap);
  const terrainZ =
    cursor && heightmap ? sampleHeight(heightmap, cursor.x, cursor.y) : null;

  return (
    <div className="coords-chip mono" aria-live="polite">
      {cursor ? (
        <>
          {`X ${fmt(cursor.x, 1)}  Y ${fmt(cursor.y, 1)}`}
          <span className="coords-chip-z">
            {terrainZ != null ? `Z ≈ ${fmt(terrainZ, 1)}` : 'Z —'}
          </span>
        </>
      ) : (
        'Move over map'
      )}
    </div>
  );
}
