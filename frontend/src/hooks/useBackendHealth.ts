import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../services/api';
import type { HealthResponse } from '../types/api';

export type BackendStatus =
  | { kind: 'checking' }
  | { kind: 'online'; health: HealthResponse; checkedAt: number }
  | { kind: 'offline'; message: string; checkedAt: number };

const POLL_NOT_READY_MS = 5_000;
const POLL_READY_MS = 30_000;

/** Polls the local backend's /api/health. Only ever talks to the same origin. */
export function useBackendHealth(): { status: BackendStatus; refresh: () => void } {
  const [status, setStatus] = useState<BackendStatus>({ kind: 'checking' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    let next: BackendStatus;
    try {
      const health = await api.health(c.signal);
      next = { kind: 'online', health, checkedAt: Date.now() };
    } catch (e) {
      if (c.signal.aborted) return;
      next = {
        kind: 'offline',
        message: e instanceof ApiError ? e.message : 'Cannot reach the local backend.',
        checkedAt: Date.now(),
      };
    }
    setStatus(next);
    const ready = next.kind === 'online' && next.health.model.state === 'ready';
    timer.current = setTimeout(() => void check(), ready ? POLL_READY_MS : POLL_NOT_READY_MS);
  }, []);

  useEffect(() => {
    void check();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      controller.current?.abort();
    };
  }, [check]);

  return { status, refresh: () => void check() };
}
