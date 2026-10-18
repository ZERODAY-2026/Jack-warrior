import { FileText, Trash2 } from 'lucide-react';
import type { AnalysisResult } from '../../types/api';
import { formatDuration } from '../../utils/labels';
import { formatBytes } from '../../utils/validateFile';

export function DocumentBar({ analysis, onRemove, removing, pasted = false }: { analysis: AnalysisResult; onRemove: () => void; removing: boolean; pasted?: boolean }) {
  const { document: doc, findings, processing } = analysis;
  const needsReview = findings.filter((f) => f.classification === 'concern' || f.category === 'ambiguity').length;
  const unsupported = findings.filter((f) => f.evidence_status !== 'verified').length;
  return (
    <section className="document-bar" aria-label="Current document">
      <div className="document-bar__top">
        <div className="document-bar__file">
          <span className="file-icon" aria-hidden="true">
            <FileText size={20} />
          </span>
          <div>
            <h1 id="document-heading" tabIndex={-1} className="document-bar__name">{doc.filename}</h1>
            <p className="muted">
              {pasted ? 'Pasted text' : doc.file_type.toUpperCase()} · {formatBytes(doc.size_bytes)}
              {doc.page_count !== null && ` · ${doc.page_count} ${doc.page_count === 1 ? 'page' : 'pages'}`}
              {processing.duration_ms !== null && ` · analysed locally in ${formatDuration(processing.duration_ms)}`}
              {processing.model && ` · ${processing.model}`}
            </p>
          </div>
        </div>
        <button type="button" className="button button--danger-ghost" onClick={onRemove} disabled={removing}>
          <Trash2 size={16} aria-hidden="true" /> {removing ? 'Removing…' : 'Remove document'}
        </button>
      </div>
      <dl className="stats">
        <div className="stat"><dt>Findings</dt><dd>{findings.length}</dd></div>
        <div className={`stat${needsReview > 0 ? ' stat--warning' : ''}`}><dt>Needs review</dt><dd>{needsReview}</dd></div>
        <div className={`stat${unsupported > 0 ? ' stat--danger' : ''}`}><dt>Without verified quote</dt><dd>{unsupported}</dd></div>
      </dl>
    </section>
  );
}
