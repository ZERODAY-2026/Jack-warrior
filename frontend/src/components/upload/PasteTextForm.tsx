import { useState, type FormEvent } from 'react';
import { Play } from 'lucide-react';
import { formatBytes } from '../../utils/validateFile';

interface Props {
  maxBytes: number;
  disabled: boolean;
  blockedReason: string | null;
  error: string | null;
  onSubmit: (text: string, title: string) => void;
}

/**
 * Lets people paste clauses from an email or another document. The text is held only in
 * this component and the session state, and is sent only to the local backend.
 */
export function PasteTextForm({ maxBytes, disabled, blockedReason, error, onSubmit }: Props) {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [emptyError, setEmptyError] = useState(false);
  const bytes = new Blob([text]).size;
  const tooBig = bytes > maxBytes;
  const canSubmit = !disabled && !tooBig;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setEmptyError(true);
      return;
    }
    if (canSubmit) onSubmit(text, title);
  };

  return (
    <form className="paste-form" onSubmit={submit} aria-label="Paste document text">
      <label className="field">
        <span>Name (optional)</span>
        <input
          type="text"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Clause 7 from my rental agreement"
          autoComplete="off"
        />
      </label>
      <label className="field">
        <span>Document text</span>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setEmptyError(false);
          }}
          rows={12}
          placeholder="Paste the full agreement or the clauses you want explained."
          spellCheck={false}
          aria-describedby="paste-count"
          aria-invalid={emptyError || tooBig || undefined}
        />
      </label>
      <div className="paste-form__foot">
        <p id="paste-count" className={`char-count${tooBig ? ' char-count--over' : ''}`}>
          {text.length.toLocaleString()} characters · {formatBytes(bytes)} of {formatBytes(maxBytes)}
        </p>
        <button type="submit" className="button button--primary" disabled={!canSubmit}>
          <Play size={16} aria-hidden="true" /> Analyse text
        </button>
      </div>
      {blockedReason && <p className="field-hint">{blockedReason}</p>}
      {emptyError && (
        <p className="field-error" role="alert">
          Paste some text from the document first.
        </p>
      )}
      {tooBig && (
        <p className="field-error" role="alert">
          This is more than the backend accepts ({formatBytes(maxBytes)}). Paste a shorter part, such as the clauses you
          want explained.
        </p>
      )}
      {error && !emptyError && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
