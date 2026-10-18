import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { formatDuration } from '../../utils/labels';

interface Props {
  fileName: string;
  modelName: string | null;
  startedAt: number;
  onCancel: () => void;
}

/**
 * The backend does not report progress, so this shows elapsed time rather than an
 * invented percentage.
 */
export function AnalysisProgress({ fileName, modelName, startedAt, onCancel }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, now - startedAt);

  return (
    <section className="card progress-card" aria-labelledby="progress-title" aria-busy="true">
      <Loader2 className="spin progress-card__spinner" size={28} aria-hidden="true" />
      <div>
        <h2 id="progress-title" className="progress-card__title">
          Analysing “{fileName}” on this computer
        </h2>
        <p className="muted">
          Extracting text, finding key clauses and checking every quote against the document
          {modelName ? ` with ${modelName}` : ''}. Local models can take a few minutes on a laptop.
        </p>
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
