import { useState, type FormEvent } from 'react';
import { Loader2, Scale, Send } from 'lucide-react';
import { motion } from 'motion/react';
import { fadeRise } from '../motion/Reveal';
import type { QaEntry } from '../../hooks/useDocumentSession';
import { AnswerTypeBadge, ClassificationBadge } from '../common/Badges';

const SUGGESTIONS = [
  'What is the notice period?',
  'What happens if payment is late?',
  'When can either party terminate the agreement?',
  'Is this contract enforceable?',
];

interface Props {
  entries: QaEntry[];
  maxChars: number;
  disabled: boolean;
  disabledReason: string | null;
  selectedId: string | null;
  onAsk: (q: string) => void;
  onSelect: (id: string) => void;
}

export function AskPanel({ entries, maxChars, disabled, disabledReason, selectedId, onAsk, onSelect }: Props) {
  const [question, setQuestion] = useState('');
  const pending = entries.some((e) => e.status === 'pending');
  const trimmed = question.trim();
  const tooLong = trimmed.length > maxChars;
  const canSend = !disabled && !pending && trimmed.length > 0 && !tooLong;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    onAsk(trimmed);
    setQuestion('');
  };

  return (
    <div className="stack">
      <form className="card ask-form" onSubmit={submit}>
        <label htmlFor="question" className="card-title">
          Ask about this document
        </label>
        <p className="muted" id="question-help">
          Answers come only from this document. If it does not say, Clausewise will tell you rather than guess.
        </p>
        <div className="ask-form__row">
          <textarea
            id="question"
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) submit(e);
            }}
            aria-describedby="question-help question-count"
            placeholder="e.g. What is the notice period?"
            disabled={disabled}
          />
          <button type="submit" className="button button--primary" disabled={!canSend}>
            {pending ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
            {pending ? 'Answering…' : 'Ask'}
          </button>
        </div>
        <p id="question-count" className={`char-count${tooLong ? ' char-count--over' : ''}`}>
          {trimmed.length}/{maxChars}
        </p>
        {disabledReason && <p className="field-hint">{disabledReason}</p>}
        {entries.length === 0 && (
          <div className="suggestions" aria-label="Example questions">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => setQuestion(s)} disabled={disabled}>
                {s}
              </button>
            ))}
          </div>
        )}
      </form>

      <ol className="qa-list" aria-label="Questions and answers" aria-live="polite">
        {[...entries].reverse().map((e) => (
          <motion.li key={e.id} className={`qa${e.id === selectedId ? ' is-selected' : ''}`} {...fadeRise} layout="position">
            <p className="qa__question">{e.question}</p>
            {e.status === 'pending' && (
              <p className="muted qa__pending">
                <Loader2 size={14} className="spin" aria-hidden="true" /> Searching the document and asking the local model…
              </p>
            )}
            {e.status === 'error' && e.error && (
              <p className="field-error" role="alert">
                {e.error.message}
              </p>
            )}
            {e.status === 'done' && e.response && (
              <motion.div className="qa__body" {...fadeRise}>
                <div className="badge-row">
                  <AnswerTypeBadge value={e.response.answer_type} />
                  {e.response.answer_type === 'answered' && <ClassificationBadge value={e.response.classification} />}
                </div>
                <p className="qa__answer">{e.response.answer}</p>
                {e.response.escalation && (
                  <p className="note note--escalation">
                    <Scale size={16} aria-hidden="true" />
                    <span>{e.response.escalation}</span>
                  </p>
                )}
                <button type="button" className="button button--ghost button--small" onClick={() => onSelect(e.id)}>
                  {e.response.source_passages.length > 0
                    ? `Show evidence (${e.response.source_passages.length} ${e.response.source_passages.length === 1 ? 'passage' : 'passages'})`
                    : 'Show details'}
                </button>
              </motion.div>
            )}
          </motion.li>
        ))}
      </ol>
    </div>
  );
}
