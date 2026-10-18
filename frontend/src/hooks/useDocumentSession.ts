import { useCallback, useReducer, useRef } from 'react';
import { api, ApiError } from '../services/api';
import type { AnalysisResult, AskResponse } from '../types/api';
import { checkFile, DEFAULT_RULES, type FileRules } from '../utils/validateFile';

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

export interface SessionState {
  phase: Phase;
  file: File | null;
  fileError: string | null;
  analysis: AnalysisResult | null;
  error: UiError | null;
  startedAt: number | null;
  qa: QaEntry[];
  notice: { tone: 'info' | 'warning'; text: string } | null;
}

const initial: SessionState = {
  phase: 'empty',
  file: null,
  fileError: null,
  analysis: null,
  error: null,
  startedAt: null,
  qa: [],
  notice: null,
};

type Action =
  | { type: 'select'; file: File }
  | { type: 'reject'; message: string }
  | { type: 'start'; at: number }
  | { type: 'success'; analysis: AnalysisResult }
  | { type: 'fail'; error: UiError }
  | { type: 'ask'; entry: QaEntry }
  | { type: 'answer'; id: string; response: AskResponse }
  | { type: 'answer_fail'; id: string; error: UiError }
  | { type: 'reset'; notice: SessionState['notice'] }
  | { type: 'notice'; notice: SessionState['notice'] };

function reducer(state: SessionState, a: Action): SessionState {
  switch (a.type) {
    case 'select':
      return { ...initial, phase: 'selected', file: a.file, notice: state.notice };
    case 'reject':
      return { ...initial, fileError: a.message, notice: null };
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

  const analyze = useCallback(async () => {
    const { file, phase } = stateRef.current;
    if (!file || phase === 'analyzing') return; // guards double submission
    const mySession = ++session.current;
    const controller = new AbortController();
    inflight.current = controller;
    dispatch({ type: 'start', at: Date.now() });
    try {
      const analysis = await api.analyze(file, controller.signal);
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

  const cancel = useCallback(async () => {
    const file = stateRef.current.file;
    const notice = await discard();
    dispatch({ type: 'reset', notice });
    if (file) dispatch({ type: 'select', file });
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

  return { state, selectFile, analyze, cancel, ask, reset, dismissNotice };
}
