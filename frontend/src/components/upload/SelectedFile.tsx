import { FileText, Play, X } from 'lucide-react';
import { formatBytes } from '../../utils/validateFile';

interface Props {
  file: File;
  canAnalyze: boolean;
  blockedReason: string | null;
  onAnalyze: () => void;
  onRemove: () => void;
}

export function SelectedFile({ file, canAnalyze, blockedReason, onAnalyze, onRemove }: Props) {
  return (
    <div className="selected-file">
      <span className="file-icon" aria-hidden="true">
        <FileText size={20} />
      </span>
      <div className="selected-file__meta">
        <p className="selected-file__name">{file.name}</p>
        <p className="muted">
          {file.name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'Plain text'} · {formatBytes(file.size)}
        </p>
        {blockedReason && <p className="field-hint">{blockedReason}</p>}
      </div>
      <div className="selected-file__actions">
        <button type="button" className="button button--ghost" onClick={onRemove}>
          <X size={16} aria-hidden="true" /> Remove
        </button>
        <button type="button" className="button button--primary" onClick={onAnalyze} disabled={!canAnalyze}>
          <Play size={16} aria-hidden="true" /> Analyse document
        </button>
      </div>
    </div>
  );
}
