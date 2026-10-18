import { ClipboardType, FileText, Play, X } from 'lucide-react';

interface Props {
  name: string;
  description: string;
  pasted?: boolean;
  canAnalyze: boolean;
  blockedReason: string | null;
  onAnalyze: () => void;
  onRemove: () => void;
}

/** The file or pasted text waiting to be analysed (also shown again after a failed or cancelled run). */
export function SelectedFile({ name, description, pasted = false, canAnalyze, blockedReason, onAnalyze, onRemove }: Props) {
  const Icon = pasted ? ClipboardType : FileText;
  return (
    <div className="selected-file">
      <span className="file-icon" aria-hidden="true">
        <Icon size={20} />
      </span>
      <div className="selected-file__meta">
        <p className="selected-file__name">{name}</p>
        <p className="muted">{description}</p>
        {blockedReason && <p className="field-hint">{blockedReason}</p>}
      </div>
      <div className="selected-file__actions">
        <button type="button" className="button button--ghost" onClick={onRemove}>
          <X size={16} aria-hidden="true" /> Remove
        </button>
        <button type="button" className="button button--primary" onClick={onAnalyze} disabled={!canAnalyze}>
          <Play size={16} aria-hidden="true" /> {pasted ? 'Analyse text' : 'Analyse document'}
        </button>
      </div>
    </div>
  );
}
