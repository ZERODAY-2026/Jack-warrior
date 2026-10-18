import type { Finding } from '../../types/api';
import { CATEGORY_LABEL, passageLocation } from '../../utils/labels';
import { ClassificationBadge, EvidenceBadge, PriorityTag } from '../common/Badges';

interface Props {
  finding: Finding;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function FindingCard({ finding, selected, onSelect }: Props) {
  const first = finding.source_passages[0];
  return (
    <button
      type="button"
      className={`finding-card finding-card--${finding.classification}${selected ? ' is-selected' : ''}`}
      aria-pressed={selected}
      onClick={() => onSelect(finding.id)}
    >
      <span className="finding-card__top">
        <span className="category">{CATEGORY_LABEL[finding.category]}</span>
        <PriorityTag value={finding.priority} />
      </span>
      <span className="finding-card__title">{finding.title}</span>
      <span className="finding-card__badges">
        <ClassificationBadge value={finding.classification} />
      </span>
      <span className="finding-card__explanation">{finding.explanation}</span>
      {first ? (
        <span className="finding-card__quote">
          <span className="quote-text">“{first.text}”</span>
          <span className="quote-meta">
            {passageLocation(first)}
            {finding.source_passages.length > 1 && ` · +${finding.source_passages.length - 1} more`}
          </span>
        </span>
      ) : null}
      <span className="finding-card__foot">
        <EvidenceBadge value={finding.evidence_status} />
        <span className="finding-card__open">View evidence</span>
      </span>
    </button>
  );
}
