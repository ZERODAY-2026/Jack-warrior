import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ClipboardType, FileSearch, ListChecks, Quote, ShieldCheck, TriangleAlert, Upload } from 'lucide-react';
import { Sidebar, type Tab } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { fadeRise, Reveal } from './components/motion/Reveal';
import { FileUploader } from './components/upload/FileUploader';
import { SelectedFile } from './components/upload/SelectedFile';
import { PasteTextForm } from './components/upload/PasteTextForm';
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
import { useDocumentTypes } from './hooks/useDocumentTypes';
import { DocumentTypeSelect } from './components/doctype/DocumentTypeSelect';
import { DocumentTypeCard } from './components/doctype/DocumentTypeCard';
import { sourceName, useDocumentSession } from './hooks/useDocumentSession';
import { api } from './services/api';
import type { DocumentText, Passage } from './types/api';
import { CATEGORY_LABEL } from './utils/labels';
import { DEFAULT_RULES, describeFile, formatBytes, type FileRules } from './utils/validateFile';

type Selection = { kind: 'finding' | 'answer' | 'term'; id: string } | null;

const TAB_TITLE: Record<Tab, string> = { overview: 'Overview', findings: 'Findings', ask: 'Ask a question' };

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
  const { state, selectFile, submitText, analyze, cancel, reanalyse, cancelReanalyse, ask, reset, dismissNotice } =
    useDocumentSession(rules);
  const types = useDocumentTypes(status.kind === 'online');
  // 'auto' lets the backend detect the type; otherwise a type id the user picked before analysing.
  const [docType, setDocType] = useState('auto');
  const { phase, file, pasted, analysis } = state;
  // Older backends do not report this field; offer pasting only when the backend says it supports it.
  const canPaste = !health || health.limits.accepts_pasted_text === true;
  const [inputMode, setInputMode] = useState<'file' | 'text'>('file');

  const [tab, setTab] = useState<Tab>('overview');
  const [selection, setSelection] = useState<Selection>(null);
  const [viewing, setViewing] = useState<Passage | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const textCache = useRef(new Map<string, Promise<DocumentText>>());
  const evidenceRef = useRef<HTMLElement>(null);

  const blocked = blockedReason(status);

  // Reset per-document UI whenever the document changes, so nothing stale carries over.
  const documentId = analysis?.document_id ?? null;
  useEffect(() => {
    setViewing(null);
    textCache.current.clear();
  }, [documentId]);
  // A re-analysis keeps the document id but replaces every finding, so selections reset too.
  useEffect(() => {
    setSelection(null);
    setViewing(null);
    setTab('overview');
  }, [analysis]);

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
        impact: f.impact,
        risk: { level: f.priority, reason: f.priority_reason },
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

  const showTab = (next: Tab) => {
    setTab(next);
    // On phones the tabs sit in the sticky top bar; start the new section from its top.
    if (window.matchMedia?.('(max-width: 900px)').matches) window.scrollTo({ top: 0 });
  };

  const onRemove = async () => {
    setRemoving(true);
    await reset();
    setRemoving(false);
    setAnnouncement('Document removed.');
  };

  const view: 'landing' | 'analyzing' | 'review' =
    phase === 'ready' && analysis && !state.reanalysis
      ? 'review'
      : (phase === 'analyzing' && state.startedAt !== null) || state.reanalysis
        ? 'analyzing'
        : 'landing';
  const hasSource = file !== null || pasted !== null;
  const trail =
    view === 'review' ? ['Workspace', 'Review', TAB_TITLE[tab]] : view === 'analyzing' ? ['Workspace', 'Analysing'] : ['Workspace', 'New review'];
  const uploadKey = hasSource ? 'selected' : inputMode === 'text' && canPaste ? 'paste' : 'upload';

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <Sidebar
        status={status}
        onOpenPrivacy={() => setPrivacyOpen(true)}
        review={
          view === 'review' && analysis
            ? { tab, onTab: showTab, findingCount: analysis.findings.length, questionCount: state.qa.length }
            : null
        }
      />
      <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>

      <div className="main-col">
        <Topbar trail={trail} />
        <main id="main" className="workspace">
          <AnimatePresence initial={false}>
            {state.notice && (
              <motion.div key="notice" {...fadeRise} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
                <Callout tone={state.notice.tone} onDismiss={dismissNotice} role="status">
                  {state.notice.text}
                </Callout>
              </motion.div>
            )}
          </AnimatePresence>

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

          {/* Each view fades in when it appears; nothing waits for an exit animation. */}
          <motion.div key={view} className="view" {...fadeRise}>
            {view === 'analyzing' && state.reanalysis && analysis && (
              <AnalysisProgress
                fileName={analysis.document.filename}
                modelName={health?.model.name ?? null}
                startedAt={state.reanalysis.startedAt}
                asType={state.reanalysis.typeLabel}
                onCancel={cancelReanalyse}
              />
            )}
            {view === 'analyzing' && !state.reanalysis && state.startedAt !== null && (
              <AnalysisProgress
                fileName={sourceName(state)}
                modelName={health?.model.name ?? null}
                startedAt={state.startedAt}
                onCancel={() => void cancel()}
              />
            )}

            {view === 'landing' && (
              <div className="landing">
                <section className="landing__intro">
                  <div className="page-head">
                    <p className="eyebrow">Document review</p>
                    <h1 className="landing__title">Understand your agreement.</h1>
                    <p className="lead">
                      Upload or paste a rental agreement, employment contract, legal notice, NDA, service agreement or other legal document. Clausewise
                      explains key terms in plain language and shows the exact passage behind every finding, all on your
                      own computer.
                    </p>
                  </div>

                  <div className="card upload-card">
                    {phase === 'failed' && state.error && (
                      <Callout
                        tone="danger"
                        title="Analysis failed"
                        role="alert"
                        action={
                          RETRYABLE.has(state.error.code) ? (
                            <button type="button" className="button button--secondary button--small" onClick={() => void analyze(docType)} disabled={blocked !== null}>
                              Try again
                            </button>
                          ) : (
                            <button type="button" className="button button--secondary button--small" onClick={() => void reset()}>
                              {pasted ? 'Edit the text' : 'Choose a different file'}
                            </button>
                          )
                        }
                      >
                        {state.error.message}
                      </Callout>
                    )}
                    {!hasSource && canPaste && (
                      <div className="mode-switch" role="group" aria-label="How to add your document">
                        {(['file', 'text'] as const).map((m) => (
                          <button key={m} type="button" aria-pressed={inputMode === m} onClick={() => setInputMode(m)}>
                            {inputMode === m && (
                              <motion.span layoutId="mode-active" className="mode-switch__bg" transition={{ type: 'spring', stiffness: 520, damping: 42 }} aria-hidden="true" />
                            )}
                            {m === 'file' ? <Upload size={16} aria-hidden="true" /> : <ClipboardType size={16} aria-hidden="true" />}
                            <span>{m === 'file' ? 'Upload a file' : 'Paste text'}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {types && (
                      <div className="upload-card__type">
                        <DocumentTypeSelect id="document-type" types={types} value={docType} onChange={setDocType} />
                        <p className="muted">
                          Auto-detect works for most documents. Pick a type if you know it, so the analysis looks for
                          the right clauses.
                        </p>
                      </div>
                    )}
                    <motion.div key={uploadKey} {...fadeRise}>
                      {hasSource ? (
                        <SelectedFile
                          name={sourceName(state)}
                          description={file ? `${describeFile(file.name)} · ${formatBytes(file.size)}` : `Pasted text · ${(pasted?.text.length ?? 0).toLocaleString()} characters`}
                          pasted={!file}
                          canAnalyze={blocked === null}
                          blockedReason={blocked}
                          onAnalyze={() => void analyze(docType)}
                          onRemove={() => void reset()}
                        />
                      ) : uploadKey === 'paste' ? (
                        <PasteTextForm
                          maxBytes={rules.maxBytes}
                          disabled={blocked !== null}
                          blockedReason={blocked}
                          error={state.textError}
                          onSubmit={(t, title) => void submitText(t, title, docType)}
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
                    </motion.div>
                  </div>
                  <Disclaimer />
                </section>

                <aside className="landing__side" aria-label="What you get">
                  <Reveal className="card privacy-card" index={1}>
                    <span className="privacy-card__icon" aria-hidden="true"><ShieldCheck size={18} /></span>
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
                  </Reveal>
                  <ul className="feature-list">
                    {FEATURES.map((f, i) => (
                      <Reveal as="li" key={f.title} index={i + 2}>
                        <span className="feature-list__icon" aria-hidden="true"><f.icon size={17} /></span>
                        <div><strong>{f.title}</strong><span>{f.text}</span></div>
                      </Reveal>
                    ))}
                  </ul>
                </aside>
              </div>
            )}

            {view === 'review' && analysis && (
              <ErrorBoundary label="analysis results">
                <DocumentBar analysis={analysis} onRemove={() => void onRemove()} removing={removing} pasted={pasted !== null} />
                {analysis.document_type && (
                  <DocumentTypeCard
                    info={analysis.document_type}
                    types={types}
                    busy={state.reanalysis !== null || blocked !== null}
                    onReanalyse={(id, label) => void reanalyse(id, label)}
                  />
                )}
                <div className="review-layout">
                  <section id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="review-main">
                    <motion.div key={tab} {...fadeRise}>
                      {tab === 'overview' && (
                        <OverviewPanel
                          analysis={analysis}
                          selectedId={selection?.kind === 'finding' ? selection.id : null}
                          onSelect={(id) => select({ kind: 'finding', id })}
                          onShowAll={() => showTab('findings')}
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
                    </motion.div>
                  </section>

                  <EvidencePanel
                    ref={evidenceRef}
                    item={evidenceItem}
                    itemKey={selection ? `${selection.kind}:${selection.id}` : 'none'}
                    onViewSource={setViewing}
                  />
                </div>
                <SourceViewer passage={viewing} loadText={loadText} onClose={() => setViewing(null)} />
              </ErrorBoundary>
            )}
          </motion.div>
        </main>

        <footer className="app-footer">
          <Disclaimer compact />
          <p>Runs locally · No analytics · Document data stays in this tab's memory</p>
        </footer>
      </div>

      <PrivacyDialog open={privacyOpen} onClose={() => setPrivacyOpen(false)} status={status} onRefresh={refresh} />
    </div>
  );
}

const FEATURES = [
  { icon: FileSearch, title: 'Summary', text: 'The agreement in plain language' },
  { icon: Quote, title: 'Evidence first', text: 'Every finding links to its source passage' },
  { icon: ListChecks, title: 'Obligations and dates', text: 'Duties, deadlines, payments, termination' },
  { icon: TriangleAlert, title: 'Needs review', text: 'Ambiguity, uncertainty and what to ask a lawyer' },
];
