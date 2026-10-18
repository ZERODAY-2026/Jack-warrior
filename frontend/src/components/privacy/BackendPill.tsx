import { CircleAlert, Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import type { BackendStatus } from '../../hooks/useBackendHealth';

export function describeBackend(status: BackendStatus): { tone: 'ok' | 'wait' | 'bad'; label: string } {
  if (status.kind === 'checking') return { tone: 'wait', label: 'Checking local backend…' };
  if (status.kind === 'offline') return { tone: 'bad', label: 'Local backend not connected' };
  switch (status.health.model.state) {
    case 'ready':
      return { tone: 'ok', label: 'Local backend connected · Model ready' };
    case 'loading':
      return { tone: 'wait', label: 'Local model loading…' };
    case 'not_installed':
      return { tone: 'bad', label: 'Local model not installed' };
    case 'error':
      return { tone: 'bad', label: 'Local model failed to load' };
  }
}

function shortLabel(status: BackendStatus): string {
  if (status.kind === 'checking') return 'Checking…';
  if (status.kind === 'offline') return 'Offline';
  return status.health.model.state === 'ready' ? 'Local · Ready' : 'Model not ready';
}

export function BackendPill({ status, onClick }: { status: BackendStatus; onClick: () => void }) {
  const { tone, label } = describeBackend(status);
  const Icon =
    tone === 'ok' ? ShieldCheck : tone === 'wait' ? Loader2 : status.kind === 'offline' ? ShieldOff : CircleAlert;
  return (
    <button type="button" className={`backend-pill backend-pill--${tone}`} onClick={onClick} aria-haspopup="dialog">
      <Icon aria-hidden="true" size={16} className={tone === 'wait' ? 'spin' : undefined} />
      <span className="backend-pill__long">{label}</span>
      <span className="backend-pill__short" aria-hidden="true">{shortLabel(status)}</span>
      <span className="visually-hidden">. Show privacy and backend details</span>
    </button>
  );
}
