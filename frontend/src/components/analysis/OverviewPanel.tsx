import type { AnalysisResult, Classification } from '../../types/api';
import { CLASSIFICATION_HELP, isNotAddressed } from '../../utils/labels';
import { ClassificationBadge } from '../common/Badges';
import { Callout } from '../common/Callout';
import { FindingCard } from './FindingCard';
import { Reveal } from '../motion/Reveal';
import { GlossaryCard } from './GlossaryCard';

interface Props {
  analysis: AnalysisResult;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onShowAll: () => void;
  selectedTerm: number | null;
  onSelectTerm: (index: number) => void;
}

const ORDER: Classification[] = ['explicit', 'interpretation', 'concern', 'not_established'];

export function OverviewPanel({ analysis, selectedId, onSelect, onShowAll, selectedTerm, onSelectTerm }: Props) {
  const { summary, findings, glossary, not_found, warnings, processing, document: doc } = analysis;
  const partialCoverage =
    processing.chunks_total !== null && processing.chunks_analysed !== null && processing.chunks_analysed < processing.chunks_total;
  // No ranking: the first few findings in document order, leaving out topics the document does not address.
  const top = findings.filter((f) => !isNotAddressed(f.title)).slice(0, 3);
  const counts = ORDER.map((c) => ({ c, n: findings.filter((f) => f.classification === c).length })).filter((x) => x.n > 0);

  return (
    <div className="stack">
      {doc.extraction.status === 'partial' && (
        <Callout tone="warning" title="Only part of this document could be read">
          {doc.extraction.unreadable_pages.length > 0
            ? `No text could be extracted from page${doc.extraction.unreadable_pages.length > 1 ? 's' : ''} ${doc.extraction.unreadable_pages.join(', ')}. `
            : ''}
          Findings below cover the readable text only.
        </Callout>
      )}
      {partialCoverage && (
        <Callout tone="warning" title="Not every part of the document was analysed">
          The model analysed {processing.chunks_analysed} of {processing.chunks_total} sections. Findings may miss terms in
          the rest; ask a specific question to search the whole text.
        </Callout>
      )}
      {warnings.map((w) => (
        <Callout key={w.code} tone="warning">{w.message}</Callout>
      ))}

      <section className="card summary-card" aria-labelledby="summary-title">
        <p className="eyebrow">Plain-language summary{summary.document_type_guess && ` · looks like a ${summary.document_type_guess}`}</p>
        <h2 id="summary-title" className="visually-hidden">Summary</h2>
        <p className="summary-text">{summary.text}</p>
        <p className="ai-note">
          AI-generated from the extracted text. Findings are specific to this document and each one links to the
          passage it is based on. Anything marked as general information is not taken from the document. This is a
          preliminary reading, not legal advice.
        </p>
        {processing.quotes_rejected !== null && processing.quotes_rejected > 0 && (
          <p className="processing-note">
            {processing.quotes_rejected} {processing.quotes_rejected === 1 ? 'quote' : 'quotes'} proposed by the model did
            not match the document and {processing.quotes_rejected === 1 ? 'was' : 'were'} discarded.
          </p>
        )}
        {summary.limitations.length > 0 && (
          <ul className="limitations">
            {summary.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
      </section>

      {counts.length > 0 && (
        <section className="card" aria-labelledby="legend-title">
          <h2 id="legend-title" className="card-title">How to read the findings</h2>
          <ul className="legend">
            {counts.map(({ c, n }) => (
              <li key={c}>
                <ClassificationBadge value={c} />
                <span className="legend__count">{n}</span>
                <span className="muted">{CLASSIFICATION_HELP[c]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {top.length > 0 && (
        <section aria-labelledby="top-title">
          <div className="section-head">
            <h2 id="top-title" className="card-title">First findings in the document</h2>
            <button type="button" className="button button--ghost button--small" onClick={onShowAll}>
              All {findings.length} findings
            </button>
          </div>
          <ul className="findings__list">
            {top.map((f, i) => (
              <Reveal as="li" key={f.id} index={i}>
                <FindingCard finding={f} selected={f.id === selectedId} onSelect={onSelect} />
              </Reveal>
            ))}
          </ul>
        </section>
      )}

      <GlossaryCard terms={glossary} selectedIndex={selectedTerm} onSelect={onSelectTerm} />

      {not_found.length > 0 && (
        <section className="card" aria-labelledby="notfound-title">
          <h2 id="notfound-title" className="card-title">Not identified in the reviewed text</h2>
          <p className="muted">
            Topics usually checked for this type of document that the analysis could not identify. This does not mean
            the document lacks them: they may be worded differently, sit in pages that could not be read, or be left
            out on purpose.
          </p>
          <ul className="not-found">
            {not_found.map((n) => (
              <li key={n.topic}>
                <strong>{n.topic}</strong>
                <span className="muted"> · {n.note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
