import type { Finding } from '../../types/api';
import { CATEGORY_LABEL, isNotAddressed, passageLocation } from '../../utils/labels';
import { ClassificationBadge, EvidenceBadge } from '../common/Badges';

interface Props {
  finding: Finding;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function FindingCard({ finding, selected, onSelect }: Props) {
  const hasPassage = finding.source_passages.length > 0;
  return (
    <button
      type="button"
      className={`finding-card finding-card--${finding.classification}${selected ? ' is-selected' : ''}`}
      aria-pressed={selected}
      onClick={() => onSelect(finding.id)}
    >
      <span className="finding-card__top">
        <span className="category">{CATEGORY_LABEL[finding.category]}</span>
        {finding.source_passages.length > 1 && (
          <span className="finding-card__count">{finding.source_passages.length} passages</span>
        )}
      </span>
      <span className="finding-card__title">{finding.title}</span>
      <span className="finding-card__badges">
        <ClassificationBadge value={finding.classification} />
      </span>
      <span className="finding-card__explanation">{finding.explanation}</span>
      {finding.impact && (
        <span className="finding-card__impact">
          <strong>Why it matters:</strong> {finding.impact}
        </span>
      )}
      {/* A finding can merge up to three passages about the same issue; every one is shown. */}
      {finding.source_passages.map((p, i) => (
        <span key={`${p.char_start ?? 'x'}-${i}`} className="finding-card__quote">
          <span className="quote-text">“{p.text}”</span>
          <span className="quote-meta">{passageLocation(p)}</span>
        </span>
      ))}
      {finding.next_step && (
        <span className="finding-card__action">
          <strong>Suggested action:</strong> {finding.next_step}
        </span>
      )}
      <span className="finding-card__foot">
        {isNotAddressed(finding.title) ? (
          <span className="evidence-status evidence-status--absent">Not found in the document</span>
        ) : (
          <EvidenceBadge value={finding.evidence_status} />
        )}
        <span className="finding-card__open">{hasPassage ? (finding.source_passages.length > 1 ? 'Show passages' : 'Show passage') : 'View details'}</span>
      </span>
    </button>
  );
}
