import { BookOpen } from 'lucide-react';
import type { GlossaryTerm } from '../../types/api';

interface Props {
  terms: GlossaryTerm[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}

export function GlossaryCard({ terms, selectedIndex, onSelect }: Props) {
  if (terms.length === 0) return null;
  return (
    <section className="card" aria-labelledby="glossary-title">
      <h2 id="glossary-title" className="card-title">
        <BookOpen size={16} aria-hidden="true" /> Terms explained
      </h2>
      <p className="muted">Legal wording used in this document, in plain language. Select a term to see where it appears.</p>
      <ul className="glossary">
        {terms.map((t, i) => (
          <li key={`${t.term}-${i}`}>
            <button
              type="button"
              className={`glossary__item${i === selectedIndex ? ' is-selected' : ''}`}
              aria-pressed={i === selectedIndex}
              onClick={() => onSelect(i)}
            >
              <span className="glossary__term">{t.term}</span>
              <span className="glossary__explanation">{t.explanation}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
