import { useProjectStore } from '../../store/useProjectStore';

export default function StatusToast() {
  const statusMessage = useProjectStore((s) => s.statusMessage);
  if (!statusMessage) return null;
  return (
    <div className="status-toast" role="status">
      {statusMessage}
    </div>
  );
}
