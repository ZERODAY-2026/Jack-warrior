import { vi } from 'vitest';

export type Route = (init: RequestInit | undefined, url: string) => Response | Promise<Response>;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Stubs fetch with a "METHOD /path" → handler table and records every call. */
export function mockBackend(routes: Record<string, Route>) {
  const calls: { method: string; url: string; init: RequestInit | undefined }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    calls.push({ method, url, init });
    const key = `${method} ${url}`;
    const route = routes[key];
    if (!route) throw new TypeError(`Unmocked request: ${key}`);
    return route(init, url);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const textFile = (name = 'lease.txt', content = 'The Tenant shall pay rent.') =>
  new File([content], name, { type: 'text/plain' });
