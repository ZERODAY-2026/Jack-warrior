import type { ReactNode } from 'react';
import { AlertOctagon, AlertTriangle, Info, X } from 'lucide-react';

interface Props {
  tone: 'info' | 'warning' | 'danger';
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  role?: 'alert' | 'status';
}

const ICON = { info: Info, warning: AlertTriangle, danger: AlertOctagon } as const;

export function Callout({ tone, title, children, action, onDismiss, role }: Props) {
  const Icon = ICON[tone];
  return (
    <div className={`callout callout--${tone}`} role={role}>
      <Icon className="callout__icon" aria-hidden="true" size={18} />
      <div className="callout__body">
        {title && <p className="callout__title">{title}</p>}
        <div>{children}</div>
        {action && <div className="callout__action">{action}</div>}
      </div>
      {onDismiss && (
        <button type="button" className="icon-button" onClick={onDismiss} aria-label="Dismiss message">
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
