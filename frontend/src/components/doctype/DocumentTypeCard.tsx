import { useEffect, useState } from 'react';
import { RefreshCw, Tag } from 'lucide-react';
import type { DocumentTypeInfo, DocumentTypeOption } from '../../types/api';
import { DocumentTypeSelect } from './DocumentTypeSelect';

interface Props {
  info: DocumentTypeInfo;
  types: DocumentTypeOption[] | null;
  busy: boolean;
  onReanalyse: (typeId: string, label: string) => void;
}

/**
 * Says which type of document the analysis assumed and lets the user correct it.
 * When the backend is unsure, the picker opens by itself and names the alternatives.
 */
export function DocumentTypeCard({ info, types, busy, onReanalyse }: Props) {
  const fallback = info.method === 'fallback';
  const unsure = (info.confidence === 'low' || fallback) && info.source === 'detected';
  const [open, setOpen] = useState(unsure);
  const [choice, setChoice] = useState(info.source === 'user' ? info.id : 'auto');
  useEffect(() => {
    setOpen((info.confidence === 'low' || info.method === 'fallback') && info.source === 'detected');
    setChoice(info.source === 'user' ? info.id : 'auto');
  }, [info]);

  const labelOf = (id: string) => types?.find((t) => t.id === id)?.label ?? id;
  const detectedLabel = labelOf(info.detected_id);
  const alternatives = info.alternatives.filter((a) => a !== info.id);
  const current = info.source === 'user' ? info.id : 'auto';
  const canChange = types !== null;

  return (
    <section className={`type-card${unsure ? ' type-card--unsure' : ''}`} aria-labelledby="type-card-title">
      <span className="type-card__icon" aria-hidden="true"><Tag size={16} /></span>
      <div className="type-card__body">
        <p id="type-card-title" className="type-card__title">
          Analysed as: <strong>{info.label}</strong>
        </p>
        <p className="type-card__meta">
          {info.source === 'user'
            ? `Chosen by you. Detected type: ${detectedLabel}.`
            : fallback
              ? 'The type could not be detected, so it was analysed as a general legal document. Pick the right type if you know it.'
              : unsure
              ? `Detected automatically, but the wording fits more than one type${alternatives.length ? ` (it could also be ${alternatives.map(labelOf).join(' or ')})` : ''}. Please confirm or pick the right type.`
              : 'Detected automatically. The findings and the "not identified" list are tailored to this type.'}
        </p>
        {open && canChange && (
          <form
            className="type-card__form"
            onSubmit={(e) => {
              e.preventDefault();
              if (choice !== current) onReanalyse(choice, choice === 'auto' ? `${detectedLabel} (auto-detected)` : labelOf(choice));
            }}
          >
            <DocumentTypeSelect
              id="reanalyse-type"
              types={types}
              value={choice}
              onChange={setChoice}
              disabled={busy}
              autoLabel={`Auto-detect (${detectedLabel})`}
              label="Analyse as"
            />
            <button type="submit" className="button button--primary button--small" disabled={busy || choice === current}>
              <RefreshCw size={14} aria-hidden="true" /> Analyse again
            </button>
          </form>
        )}
      </div>
      {!open && canChange && (
        <button type="button" className="button button--secondary button--small" onClick={() => setOpen(true)}>
          Change type
        </button>
      )}
    </section>
  );
}
