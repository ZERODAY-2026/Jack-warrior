import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { BackendStatus } from '../../hooks/useBackendHealth';
import { PrivacyDetails } from './PrivacyDetails';

export function PrivacyDialog({
  open,
  onClose,
  status,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  status: BackendStatus;
  onRefresh: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);

  return (
    <dialog ref={ref} className="dialog" aria-labelledby="privacy-title" onClose={onClose} onCancel={onClose}>
      <div className="dialog__head">
        <h2 id="privacy-title">Privacy and local processing</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="dialog__body">{open && <PrivacyDetails status={status} onRefresh={onRefresh} />}</div>
    </dialog>
  );
}
