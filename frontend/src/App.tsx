import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { FileSearch, ListChecks, MessageSquareText, Quote, ShieldCheck, TriangleAlert } from 'lucide-react';
import { AppHeader } from './components/layout/AppHeader';
import { FileUploader } from './components/upload/FileUploader';
import { SelectedFile } from './components/upload/SelectedFile';
import { AnalysisProgress } from './components/analysis/AnalysisProgress';
import { DocumentBar } from './components/analysis/DocumentBar';
import { OverviewPanel } from './components/analysis/OverviewPanel';
import { FindingsList } from './components/analysis/FindingsList';
import { EvidencePanel, type EvidenceItem } from './components/evidence/EvidencePanel';
import { SourceViewer } from './components/evidence/SourceViewer';
import { AskPanel } from './components/ask/AskPanel';
import { PrivacyDialog } from './components/privacy/PrivacyDialog';
import { Callout } from './components/common/Callout';
import { Disclaimer } from './components/common/Disclaimer';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useBackendHealth, type BackendStatus } from './hooks/useBackendHealth';
import { useDocumentSession } from './hooks/useDocumentSession';
import { api } from './services/api';
import type { DocumentText, Passage } from './types/api';
import { CATEGORY_LABEL } from './utils/labels';
import { DEFAULT_RULES, type FileRules } from './utils/validateFile';

type Tab = 'overview' | 'findings' | 'ask';
type Selection = { kind: 'finding' | 'answer' | 'term'; id: string } | null;

const TABS: { id: Tab; label: string; icon: typeof FileSearch }[] = [
  { id: 'overview', label: 'Overview', icon: FileSearch },
  { id: 'findings', label: 'Findings', icon: ListChecks },
  { id: 'ask', label: 'Ask a question', icon: MessageSquareText },
];

// Errors where the same file may succeed on a second attempt. Others are about the file itself.
const RETRYABLE = new Set(['backend_unreachable', 'timeout', 'model_not_ready', 'analysis_failed', 'http_error', 'malformed_response', 'unknown']);

function blockedReason(status: BackendStatus): string | null {
  if (status.kind === 'checking') return 'Checking the local backend…';
  if (status.kind === 'offline') return 'Start the local backend to analyse documents.';
  const m = status.health.model;
  if (m.state === 'ready') return null;
  if (m.state === 'loading') return 'The local model is still loading. This page will update when it is ready.';
  return m.detail ?? (m.state === 'not_installed' ? 'The local model is not installed. See the README setup steps.' : 'The local model failed to load. Check the backend console.');
}

export default function App() {
  const { status, refresh } = useBackendHealth();
  const health = status.kind === 'online' ? status.health : null;
  const rules: FileRules = useMemo(
    () =>
      health
        ? { maxBytes: health.limits.max_file_bytes, acceptedExtensions: health.limits.accepted_extensions }
        : DEFAULT_RULES,
    [health],
  );
  const { state, selectFile, analyze, cancel, ask, reset, dismissNotice } = useDocumentSession(rules);
  const { phase, file, analysis } = state;

  const [tab, setTab] = useState<Tab>('overview');
  const [selection, setSelection] = useState<Selection>(null);
  const [viewing, setViewing] = useState<Passage | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const textCache = useRef(new Map<string, Promise<DocumentText>>());
  const evidenceRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ overview: null, findings: null, ask: null });

  const blocked = blockedReason(status);

  // Reset per-document UI whenever the document changes, so nothing stale carries over.
  const documentId = analysis?.document_id ?? null;
  useEffect(() => {
    setSelection(null);
    setViewing(null);
    setTab('overview');
    textCache.current.clear();
  }, [documentId]);

  useEffect(() => {
    if (phase === 'analyzing') setAnnouncement('Analysis started.');
    if (phase === 'failed') setAnnouncement('Analysis failed.');
    if (phase === 'ready' && analysis) {
      setAnnouncement(`Analysis complete. ${analysis.findings.length} findings.`);
      document.getElementById('document-heading')?.focus();
    }
  }, [phase, analysis]);

  const loadText = useCallback(() => {
    if (!documentId) return Promise.reject(new Error('No document is loaded.'));
    let p = textCache.current.get(documentId);
    if (!p) {
      p = api.documentText(documentId);
      p.catch(() => textCache.current.delete(documentId));
      textCache.current.set(documentId, p);
    }
    return p;
  }, [documentId]);

  const select = (next: Selection) => {
    setSelection(next);
    // On narrow screens the evidence panel sits below the list; bring it into view.
    if (window.matchMedia?.('(max-width: 1000px)').matches) {
      requestAnimationFrame(() => {
        evidenceRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        evidenceRef.current?.focus({ preventScroll: true });
      });
    }
  };

  const evidenceItem: EvidenceItem | null = useMemo(() => {
    if (!selection || !analysis) return null;
    if (selection.kind === 'finding') {
      const f = analysis.findings.find((x) => x.id === selection.id);
      if (!f) return null;
      return {
        kind: 'finding',
        heading: f.title,
        eyebrow: CATEGORY_LABEL[f.category],
        classification: f.classification,
        evidenceStatus: f.evidence_status,
        explanation: f.explanation,
        passages: f.source_passages,
        limitations: f.limitations,
        nextStep: f.next_step,
        escalation: null,
        jurisdictionNote: null,
        priorityReason: f.priority_reason || undefined,
      };
    }
    if (selection.kind === 'term') {
      const t = analysis.glossary[Number(selection.id)];
      if (!t) return null;
      return {
        kind: 'finding',
        heading: t.term,
        eyebrow: 'Term explained',
        classification: 'interpretation',
        evidenceStatus: t.source_passages.length === 0 ? 'none' : t.source_passages.every((p) => p.verified) ? 'verified' : 'unverified',
        explanation: t.explanation,
        passages: t.source_passages,
        limitations: [],
        nextStep: null,
        escalation: null,
        jurisdictionNote: null,
      };
    }
    const q = state.qa.find((x) => x.id === selection.id);
    if (!q?.response) return null;
    const r = q.response;
    return {
      kind: 'answer',
      heading: q.question,
      eyebrow: 'Your question',
      classification: r.classification,
      answerType: r.answer_type,
      evidenceStatus: r.source_passages.length === 0 ? 'none' : r.source_passages.every((p) => p.verified) ? 'verified' : 'unverified',
      explanation: r.answer,
      passages: r.source_passages,
      limitations: r.limitations,
      nextStep: null,
      escalation: r.escalation,
      jurisdictionNote: r.jurisdiction_note,
    };
  }, [selection, analysis, state.qa]);

  const onRemove = async () => {
    setRemoving(true);
    await reset();
    setRemoving(false);
    setAnnouncement('Document removed.');
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = TABS[(i + dir + TABS.length) % TABS.length]!.id;
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <AppHeader status={status} onOpenPrivacy={() => setPrivacyOpen(true)} />
      <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>

      <main id="main" className="workspace">
        {state.notice && (
          <Callout tone={state.notice.tone} onDismiss={dismissNotice} role="status">
            {state.notice.text}
          </Callout>
        )}

        {status.kind === 'offline' && (
          <Callout
            tone="danger"
            title="Local backend not connected"
            action={<button type="button" className="button button--secondary button--small" onClick={refresh}>Check again</button>}
          >
            {status.message} Analysis needs the Clausewise backend running on this computer.
          </Callout>
        )}
        {health && health.model.state !== 'ready' && (
          <Callout tone={health.model.state === 'loading' ? 'info' : 'danger'} title="Local model not ready">
            {blocked}
          </Callout>
        )}

        {phase === 'analyzing' && file && state.startedAt !== null && (
          <AnalysisProgress
            fileName={file.name}
            modelName={health?.model.name ?? null}
            startedAt={state.startedAt}
            onCancel={() => void cancel()}
          />
        )}

        {(phase === 'empty' || phase === 'selected' || phase === 'failed') && (
          <div className="landing">
            <section className="landing__intro">
              <p className="eyebrow">Workspace · Document review</p>
              <h1 className="landing__title">Understand your agreement.</h1>
              <p className="lead">
                Upload a rental agreement, employment contract, notice or service agreement. Clausewise explains key
                terms in plain language and shows the exact passage behind every finding, all on your own computer.
              </p>

              <div className="card upload-card">
                {phase === 'failed' && state.error && (
                  <Callout
                    tone="danger"
                    title="Analysis failed"
                    role="alert"
                    action={
                      RETRYABLE.has(state.error.code) ? (
                        <button type="button" className="button button--secondary button--small" onClick={() => void analyze()} disabled={blocked !== null}>
                          Try again
                        </button>
                      ) : (
                        <button type="button" className="button button--secondary button--small" onClick={() => void reset()}>
                          Choose a different file
                        </button>
                      )
                    }
                  >
                    {state.error.message}
                  </Callout>
                )}
                {file ? (
                  <SelectedFile
                    file={file}
                    canAnalyze={blocked === null}
                    blockedReason={blocked}
                    onAnalyze={() => void analyze()}
                    onRemove={() => void reset()}
                  />
                ) : (
                  <FileUploader
                    onFile={(f) => void selectFile(f)}
                    acceptedExtensions={rules.acceptedExtensions}
                    maxBytes={rules.maxBytes}
                    ocrSupported={health?.limits.ocr_supported ?? false}
                    error={state.fileError}
                  />
                )}
              </div>
              <Disclaimer />
            </section>

            <aside className="landing__side" aria-label="What you get">
              <div className="card privacy-card">
                <ShieldCheck size={20} aria-hidden="true" />
                <div>
                  <h2 className="card-title">Private by design</h2>
                  <p className="muted">
                    Your document is sent only to the backend on this computer and analysed by a local Gemma model.
                    Nothing is stored in your browser.
                  </p>
                  <button type="button" className="link-button" onClick={() => setPrivacyOpen(true)}>
                    How to verify this
                  </button>
                </div>
              </div>
              <ul className="feature-list">
                <li><FileSearch size={18} aria-hidden="true" /><div><strong>Summary</strong><span>The agreement in plain language</span></div></li>
                <li><Quote size={18} aria-hidden="true" /><div><strong>Evidence first</strong><span>Every finding links to its source passage</span></div></li>
                <li><ListChecks size={18} aria-hidden="true" /><div><strong>Obligations and dates</strong><span>Duties, deadlines, payments, termination</span></div></li>
                <li><TriangleAlert size={18} aria-hidden="true" /><div><strong>Needs review</strong><span>Ambiguity, uncertainty and what to ask a lawyer</span></div></li>
              </ul>
            </aside>
          </div>
        )}

        {phase === 'ready' && analysis && (
          <ErrorBoundary label="analysis results">
            <DocumentBar analysis={analysis} onRemove={() => void onRemove()} removing={removing} />
            <div className="review-layout">
              <nav className="review-nav" aria-label="Review sections">
                <div role="tablist" aria-orientation="vertical" aria-label="Review sections">
                  {TABS.map((t, i) => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.id}
                        ref={(el) => { tabRefs.current[t.id] = el; }}
                        id={`tab-${t.id}`}
                        role="tab"
                        type="button"
                        aria-selected={tab === t.id}
                        aria-controls={`panel-${t.id}`}
                        tabIndex={tab === t.id ? 0 : -1}
                        className="review-nav__tab"
                        onClick={() => setTab(t.id)}
                        onKeyDown={(e) => onTabKey(e, i)}
                      >
                        <Icon size={16} aria-hidden="true" />
                        <span>{t.label}</span>
                        {t.id === 'findings' && <span className="count">{analysis.findings.length}</span>}
                        {t.id === 'ask' && state.qa.length > 0 && <span className="count">{state.qa.length}</span>}
                      </button>
                    );
                  })}
                </div>
              </nav>

              <section id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="review-main">
                {tab === 'overview' && (
                  <OverviewPanel
                    analysis={analysis}
                    selectedId={selection?.kind === 'finding' ? selection.id : null}
                    onSelect={(id) => select({ kind: 'finding', id })}
                    onShowAll={() => setTab('findings')}
                    selectedTerm={selection?.kind === 'term' ? Number(selection.id) : null}
                    onSelectTerm={(i) => select({ kind: 'term', id: String(i) })}
                  />
                )}
                {tab === 'findings' && (
                  <FindingsList
                    findings={analysis.findings}
                    selectedId={selection?.kind === 'finding' ? selection.id : null}
                    onSelect={(id) => select({ kind: 'finding', id })}
                  />
                )}
                {tab === 'ask' && (
                  <AskPanel
                    entries={state.qa}
                    maxChars={health?.limits.max_question_chars ?? 500}
                    disabled={blocked !== null}
                    disabledReason={blocked}
                    selectedId={selection?.kind === 'answer' ? selection.id : null}
                    onAsk={(q) => void ask(q)}
                    onSelect={(id) => select({ kind: 'answer', id })}
                  />
                )}
              </section>

              <EvidencePanel ref={evidenceRef} item={evidenceItem} onViewSource={setViewing} />
            </div>
            <SourceViewer passage={viewing} loadText={loadText} onClose={() => setViewing(null)} />
          </ErrorBoundary>
        )}
      </main>

      <footer className="app-footer">
        <Disclaimer compact />
        <p>Runs locally · No analytics · Document data stays in this tab's memory</p>
      </footer>

      <PrivacyDialog open={privacyOpen} onClose={() => setPrivacyOpen(false)} status={status} onRefresh={refresh} />
    </>
  );
}
