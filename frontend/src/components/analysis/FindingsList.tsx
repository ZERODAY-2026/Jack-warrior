import { useMemo, useState } from 'react';
import type { Classification, Finding, FindingCategory } from '../../types/api';
import { CATEGORY_LABEL, CLASSIFICATION_LABEL } from '../../utils/labels';
import { FindingCard } from './FindingCard';
import { Reveal } from '../motion/Reveal';

interface Props {
  findings: Finding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function FindingsList({ findings, selectedId, onSelect }: Props) {
  const [category, setCategory] = useState<FindingCategory | 'all'>('all');
  const [classification, setClassification] = useState<Classification | 'all'>('all');

  // Only offer filter values that actually occur in this document.
  const categories = useMemo(() => [...new Set(findings.map((f) => f.category))], [findings]);
  const classifications = useMemo(() => [...new Set(findings.map((f) => f.classification))], [findings]);

  const shown = useMemo(
    () =>
      findings
        .filter((f) => category === 'all' || f.category === category)
        .filter((f) => classification === 'all' || f.classification === classification),
    [findings, category, classification],
  );

  if (findings.length === 0) {
    return (
      <p className="empty-state">
        The analysis returned no findings for this document. That does not mean the document has no important terms;
        try asking a specific question instead.
      </p>
    );
  }

  const filtered = category !== 'all' || classification !== 'all';

  return (
    <div className="findings">
      <div className="filters" role="group" aria-label="Filter findings">
        <label>
          <span>Topic</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as FindingCategory | 'all')}>
            <option value="all">All topics</option>
            {categories.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Type</span>
          <select value={classification} onChange={(e) => setClassification(e.target.value as Classification | 'all')}>
            <option value="all">All types</option>
            {classifications.map((c) => (
              <option key={c} value={c}>{CLASSIFICATION_LABEL[c]}</option>
            ))}
          </select>
        </label>
        {filtered && (
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => {
              setCategory('all');
              setClassification('all');
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      <p className="muted findings__count" aria-live="polite">
        Showing {shown.length} of {findings.length} findings, in document order
      </p>
      {shown.length === 0 ? (
        <p className="empty-state">No findings match these filters.</p>
      ) : (
        <ul className="findings__list">
          {shown.map((f, i) => (
            <Reveal as="li" key={f.id} index={i}>
              <FindingCard finding={f} selected={f.id === selectedId} onSelect={onSelect} />
            </Reveal>
          ))}
        </ul>
      )}
    </div>
  );
}
