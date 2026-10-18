import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { formatDuration } from '../../utils/labels';

interface Props {
  fileName: string;
  modelName: string | null;
  startedAt: number;
  onCancel: () => void;
  /** Set when a loaded document is analysed again as a chosen type. */
  asType?: string;
}

/**
 * The backend does not report progress, so this shows elapsed time rather than an
 * invented percentage.
 */
export function AnalysisProgress({ fileName, modelName, startedAt, onCancel, asType }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, now - startedAt);

  return (
    <section className="card progress-card" aria-labelledby="progress-title" aria-busy="true">
      <span className="progress-card__spinner" aria-hidden="true">
        <Loader2 className="spin" size={24} />
      </span>
      <div>
        <h2 id="progress-title" className="progress-card__title">
          {asType ? `Analysing “${fileName}” again as: ${asType}` : `Analysing “${fileName}” on this computer`}
        </h2>
        <p className="muted">
          Extracting text, finding key clauses and checking every quote against the document
          {modelName ? ` with ${modelName}` : ''}. Local models can take a few minutes on a laptop.
        </p>
        {/* Indeterminate on purpose: it shows that work is happening, not how much is left. */}
        <div className="progress-track" aria-hidden="true">
          <span />
        </div>
        <p className="progress-card__elapsed">
          Elapsed <span>{formatDuration(elapsed)}</span>
        </p>
      </div>
      <button type="button" className="button button--secondary" onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}
