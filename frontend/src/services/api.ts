// Typed client for the local backend. Every request goes to the same origin under /api
// (proxied to 127.0.0.1 in development), and the production CSP blocks any other origin.
// Nothing here logs request or response bodies, because they contain document content.

import type {
  AnalysisResult,
  AskResponse,
  DeleteResponse,
  DocumentText,
  HealthResponse,
} from '../types/api';
import {
  MalformedResponseError,
  parseAnalysis,
  parseAsk,
  parseDelete,
  parseDocumentText,
  parseHealth,
} from './validate';

const API_BASE = '/api';

const env = import.meta.env;
export const TIMEOUTS = {
  health: 5_000,
  analyze: Number(env.VITE_ANALYZE_TIMEOUT_MS) || 15 * 60_000,
  ask: Number(env.VITE_ASK_TIMEOUT_MS) || 5 * 60_000,
  text: 30_000,
  delete: 15_000,
};

/** Error codes from the contract plus the ones the client itself produces. */
export type ApiErrorCode =
  | 'backend_unreachable'
  | 'timeout'
  | 'aborted'
  | 'malformed_response'
  | (string & {});

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const FALLBACK_MESSAGES: Record<string, string> = {
  backend_unreachable:
    'Cannot reach the local backend. Make sure it is running on this computer, then try again.',
  timeout: 'The local model took too long to respond. Try a shorter document or try again.',
  aborted: 'The request was cancelled.',
  malformed_response:
    'The backend sent a response this app does not understand, so nothing was shown. The frontend and backend versions may not match.',
};

function messageFor(code: string): string {
  return FALLBACK_MESSAGES[code] ?? 'Something went wrong in the local backend.';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: BodyInit;
  json?: unknown;
  signal?: AbortSignal | undefined;
  timeoutMs: number;
}

async function request<T>(path: string, parse: (v: unknown) => T, opts: RequestOptions): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs);
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onOuterAbort);
  if (opts.signal?.aborted) controller.abort();

  const headers: Record<string, string> = { Accept: 'application/json' };
  let body = opts.body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  // For FormData bodies the browser sets multipart/form-data with its own boundary.

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: body ?? null,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    if (timedOut) throw new ApiError('timeout', messageFor('timeout'));
    if (controller.signal.aborted) throw new ApiError('aborted', messageFor('aborted'));
    throw new ApiError('backend_unreachable', messageFor('backend_unreachable'));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }

  let data: unknown = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const err = (data as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    if (err && typeof err.code === 'string') {
      const msg = typeof err.message === 'string' && err.message ? err.message : messageFor(err.code);
      throw new ApiError(err.code, msg, res.status);
    }
    // The dev proxy answers 502/503/504 with no JSON body when the backend is down.
    if ([502, 503, 504].includes(res.status) && data === null) {
      throw new ApiError('backend_unreachable', messageFor('backend_unreachable'), res.status);
    }
    throw new ApiError('http_error', `The local backend returned an error (HTTP ${res.status}).`, res.status);
  }

  try {
    return parse(data);
  } catch (e) {
    if (e instanceof MalformedResponseError) {
      throw new ApiError('malformed_response', messageFor('malformed_response'), res.status);
    }
    throw e;
  }
}

export const api = {
  health(signal?: AbortSignal): Promise<HealthResponse> {
    return request('/health', parseHealth, { signal, timeoutMs: TIMEOUTS.health });
  },

  analyze(file: File, signal?: AbortSignal): Promise<AnalysisResult> {
    const form = new FormData();
    form.append('file', file, file.name);
    return request('/documents', parseAnalysis, {
      method: 'POST',
      body: form,
      signal,
      timeoutMs: TIMEOUTS.analyze,
    });
  },

  ask(documentId: string, question: string, signal?: AbortSignal): Promise<AskResponse> {
    return request(`/documents/${encodeURIComponent(documentId)}/ask`, parseAsk, {
      method: 'POST',
      json: { question },
      signal,
      timeoutMs: TIMEOUTS.ask,
    });
  },

  documentText(documentId: string, signal?: AbortSignal): Promise<DocumentText> {
    return request(`/documents/${encodeURIComponent(documentId)}/text`, parseDocumentText, {
      signal,
      timeoutMs: TIMEOUTS.text,
    });
  },

  deleteDocument(documentId: string): Promise<DeleteResponse> {
    return request(`/documents/${encodeURIComponent(documentId)}`, parseDelete, {
      method: 'DELETE',
      timeoutMs: TIMEOUTS.delete,
    });
  },
};
