import { useCallback, useReducer, useRef } from 'react';
import { api, ApiError } from '../services/api';
import type { AnalysisResult, AskResponse } from '../types/api';
import { checkFile, checkText, DEFAULT_RULES, type FileRules } from '../utils/validateFile';

export interface UiError {
  code: string;
  message: string;
}

export interface QaEntry {
  id: string;
  question: string;
  status: 'pending' | 'done' | 'error';
  response?: AskResponse;
  error?: UiError;
}

export type Phase = 'empty' | 'selected' | 'analyzing' | 'ready' | 'failed';

export interface PastedText {
  text: string;
  title: string | null;
}

/** The display name for whatever is being analysed. */
export function sourceName(s: { file: File | null; pasted: PastedText | null }): string {
  return s.file?.name ?? s.pasted?.title ?? 'Pasted text';
}

export interface SessionState {
  phase: Phase;
  file: File | null;
  pasted: PastedText | null;
  fileError: string | null;
  textError: string | null;
  analysis: AnalysisResult | null;
  error: UiError | null;
  startedAt: number | null;
  qa: QaEntry[];
  notice: { tone: 'info' | 'warning'; text: string } | null;
  /** Set while a loaded document is being analysed again as another type. */
  reanalysis: { startedAt: number; typeLabel: string } | null;
}

const initial: SessionState = {
  phase: 'empty',
  file: null,
  pasted: null,
  fileError: null,
  textError: null,
  analysis: null,
  error: null,
  startedAt: null,
  qa: [],
  notice: null,
  reanalysis: null,
};

type Action =
  | { type: 'select'; file: File }
  | { type: 'select_text'; pasted: PastedText }
  | { type: 'reject'; message: string }
  | { type: 'reject_text'; message: string }
  | { type: 'start'; at: number }
  | { type: 'success'; analysis: AnalysisResult }
  | { type: 'fail'; error: UiError }
  | { type: 'ask'; entry: QaEntry }
  | { type: 'answer'; id: string; response: AskResponse }
  | { type: 'answer_fail'; id: string; error: UiError }
  | { type: 'reanalyse_start'; at: number; typeLabel: string }
  | { type: 'reanalyse_done'; analysis: AnalysisResult }
  | { type: 'reanalyse_end'; notice: SessionState['notice'] }
  | { type: 'reset'; notice: SessionState['notice'] }
  | { type: 'notice'; notice: SessionState['notice'] };

function reducer(state: SessionState, a: Action): SessionState {
  switch (a.type) {
    case 'select':
      return { ...initial, phase: 'selected', file: a.file, notice: state.notice };
    case 'select_text':
      return { ...initial, phase: 'selected', pasted: a.pasted, notice: state.notice };
    case 'reject':
      return { ...initial, fileError: a.message, notice: null };
    case 'reject_text':
      return { ...initial, textError: a.message, notice: null };
    case 'start':
      return { ...state, phase: 'analyzing', error: null, startedAt: a.at, notice: null };
    case 'success':
      return { ...state, phase: 'ready', analysis: a.analysis, startedAt: null };
    case 'fail':
      return { ...state, phase: 'failed', error: a.error, startedAt: null };
    case 'ask':
      return { ...state, qa: [...state.qa, a.entry] };
    case 'answer':
      return {
        ...state,
        qa: state.qa.map((q) => (q.id === a.id ? { ...q, status: 'done', response: a.response } : q)),
      };
    case 'answer_fail':
      return {
        ...state,
        qa: state.qa.map((q) => (q.id === a.id ? { ...q, status: 'error', error: a.error } : q)),
      };
    case 'reanalyse_start':
      return { ...state, reanalysis: { startedAt: a.at, typeLabel: a.typeLabel }, notice: null };
    case 'reanalyse_done':
      // Same document, new reading of it: questions already asked stay valid.
      return { ...state, analysis: a.analysis, reanalysis: null };
    case 'reanalyse_end':
      return { ...state, reanalysis: null, notice: a.notice };
    case 'reset':
      return { ...initial, notice: a.notice };
    case 'notice':
      return { ...state, notice: a.notice };
  }
}

function toUiError(e: unknown): UiError {
  if (e instanceof ApiError) return { code: e.code, message: e.message };
  return { code: 'unknown', message: 'Something unexpected went wrong. Please try again.' };
}

/**
 * Owns one document's lifecycle: select → analyse → ask → remove.
 * Document content lives only in this in-memory state; nothing is written to
 * localStorage, sessionStorage, IndexedDB or the console.
 *
 * Every async call captures a session number. If the user removes or replaces the
 * document before the call returns, the stale result is dropped, so answers from an
 * earlier document can never appear next to a new one.
 */
export function useDocumentSession(rules: FileRules = DEFAULT_RULES) {
  const [state, dispatch] = useReducer(reducer, initial);
  const session = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  const askControllers = useRef(new Set<AbortController>());
  const stateRef = useRef(state);
  stateRef.current = state;

  const abortAll = () => {
    inflight.current?.abort();
    inflight.current = null;
    askControllers.current.forEach((c) => c.abort());
    askControllers.current.clear();
  };

  /** Deletes the current document on the backend and reports honestly what happened. */
  const discard = useCallback(async (): Promise<SessionState['notice']> => {
    const { analysis, phase } = stateRef.current;
    const wasAnalyzing = phase === 'analyzing';
    session.current += 1;
    abortAll();
    if (analysis) {
      try {
        const res = await api.deleteDocument(analysis.document_id);
        return res.deleted
          ? { tone: 'info', text: `“${analysis.document.filename}” was removed from this screen and the local backend confirmed it deleted its copy.` }
          : { tone: 'warning', text: `“${analysis.document.filename}” was removed from this screen, but the backend did not confirm deleting its copy.` };
      } catch (e) {
        return {
          tone: 'warning',
          text: `“${analysis.document.filename}” was removed from this screen, but the backend could not confirm deletion: ${toUiError(e).message}`,
        };
      }
    }
    if (wasAnalyzing) {
      return {
        tone: 'warning',
        text: 'Analysis cancelled. The backend may finish processing in the background; restart it to make sure it holds no copy.',
      };
    }
    return null;
  }, []);

  const selectFile = useCallback(
    async (file: File) => {
      const check = checkFile(file, rules);
      const hadDocument = stateRef.current.analysis !== null || stateRef.current.phase === 'analyzing';
      const notice = hadDocument ? await discard() : null;
      if (!check.ok) {
        dispatch({ type: 'reject', message: check.message });
        if (notice) dispatch({ type: 'notice', notice });
        return;
      }
      dispatch({ type: 'reset', notice });
      dispatch({ type: 'select', file });
    },
    [discard, rules],
  );

  const run = useCallback(async (source: { file: File } | { pasted: PastedText }, documentType: string) => {
    const mySession = ++session.current;
    const controller = new AbortController();
    inflight.current = controller;
    dispatch({ type: 'start', at: Date.now() });
    try {
      const analysis =
        'file' in source
          ? await api.analyze(source.file, documentType, controller.signal)
          : await api.analyzeText(source.pasted.text, source.pasted.title, documentType, controller.signal);
      if (session.current !== mySession) {
        // The user moved on while the backend worked; don't keep its copy around.
        void api.deleteDocument(analysis.document_id).catch(() => undefined);
        return;
      }
      dispatch({ type: 'success', analysis });
    } catch (e) {
      if (session.current !== mySession) return;
      dispatch({ type: 'fail', error: toUiError(e) });
    } finally {
      if (inflight.current === controller) inflight.current = null;
    }
  }, []);

  const analyze = useCallback(async (documentType = 'auto') => {
    const { file, pasted, phase } = stateRef.current;
    if (phase === 'analyzing') return; // guards double submission
    if (file) await run({ file }, documentType);
    else if (pasted) await run({ pasted }, documentType);
  }, [run]);

  /** Validates pasted text, replaces any current document, and starts analysis. */
  const submitText = useCallback(
    async (text: string, title: string, documentType = 'auto') => {
      if (stateRef.current.phase === 'analyzing') return;
      const check = checkText(text, rules);
      if (!check.ok) {
        dispatch({ type: 'reject_text', message: check.message });
        return;
      }
      const hadDocument = stateRef.current.analysis !== null;
      const notice = hadDocument ? await discard() : null;
      const pasted: PastedText = { text, title: title.trim() || null };
      dispatch({ type: 'reset', notice });
      dispatch({ type: 'select_text', pasted });
      await run({ pasted }, documentType);
    },
    [discard, rules, run],
  );

  /**
   * Analyses the loaded document again as another type. The earlier results stay in
   * state and come back if this fails or is cancelled.
   */
  const reanalyse = useCallback(async (documentType: string, typeLabel: string) => {
    const { analysis, reanalysis } = stateRef.current;
    if (!analysis || reanalysis) return;
    const mySession = session.current;
    const controller = new AbortController();
    inflight.current = controller;
    dispatch({ type: 'reanalyse_start', at: Date.now(), typeLabel });
    try {
      const next = await api.reanalyse(analysis.document_id, documentType, controller.signal);
      if (session.current !== mySession) return;
      dispatch({ type: 'reanalyse_done', analysis: next });
    } catch (e) {
      if (session.current !== mySession) return;
      const err = toUiError(e);
      dispatch({
        type: 'reanalyse_end',
        notice:
          err.code === 'aborted'
            ? { tone: 'info', text: 'Re-analysis cancelled. The earlier results are shown.' }
            : { tone: 'warning', text: `Could not analyse it again: ${err.message} The earlier results are still shown.` },
      });
    } finally {
      if (inflight.current === controller) inflight.current = null;
    }
  }, []);

  const cancelReanalyse = useCallback(() => {
    inflight.current?.abort();
  }, []);

  const cancel = useCallback(async () => {
    const { file, pasted } = stateRef.current;
    const notice = await discard();
    dispatch({ type: 'reset', notice });
    if (file) dispatch({ type: 'select', file });
    else if (pasted) dispatch({ type: 'select_text', pasted });
  }, [discard]);

  const ask = useCallback(async (question: string) => {
    const { analysis } = stateRef.current;
    const q = question.trim();
    if (!analysis || !q) return;
    const mySession = session.current;
    const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    dispatch({ type: 'ask', entry: { id, question: q, status: 'pending' } });
    const controller = new AbortController();
    askControllers.current.add(controller);
    try {
      const response = await api.ask(analysis.document_id, q, controller.signal);
      if (session.current !== mySession) return;
      dispatch({ type: 'answer', id, response });
    } catch (e) {
      if (session.current !== mySession) return;
      dispatch({ type: 'answer_fail', id, error: toUiError(e) });
    } finally {
      askControllers.current.delete(controller);
    }
  }, []);

  const reset = useCallback(async () => {
    const notice = await discard();
    dispatch({ type: 'reset', notice });
  }, [discard]);

  const dismissNotice = useCallback(() => dispatch({ type: 'notice', notice: null }), []);

  return { state, selectFile, submitText, analyze, cancel, reanalyse, cancelReanalyse, ask, reset, dismissNotice };
}
