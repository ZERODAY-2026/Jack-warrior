import { FileText } from 'lucide-react';
import type { BackendStatus } from '../../hooks/useBackendHealth';
import { BackendPill } from '../privacy/BackendPill';

export function AppHeader({ status, onOpenPrivacy }: { status: BackendStatus; onOpenPrivacy: () => void }) {
  return (
    <header className="app-header">
      <div className="app-header__brand">
        <span className="brand-mark" aria-hidden="true">
          <FileText size={18} />
        </span>
        <div>
          <p className="brand-name">Clausewise</p>
          <p className="brand-tagline">Private legal document review</p>
        </div>
      </div>
      <BackendPill status={status} onClick={onOpenPrivacy} />
    </header>
  );
}
