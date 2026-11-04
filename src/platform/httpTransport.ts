import { AbortedError, NetworkError, TimeoutError } from '../delivery/errors';
import type { HttpRequest, HttpResponse, HttpTransport } from '../delivery/ports';

// XHR instead of fetch: upload progress events, and ArrayBuffer bodies are sent as raw bytes.
export const xhrTransport: HttpTransport = {
  request(req: HttpRequest): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      if (req.signal?.aborted) return reject(new AbortedError('aborted'));
      const xhr = new XMLHttpRequest();
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        req.signal?.removeEventListener('abort', onAbort);
        clearTimeout(timer);
        clearTimeout(idleTimer);
        fn();
      };
      const onAbort = () => {
        settle(() => reject(new AbortedError('aborted')));
        xhr.abort();
      };
      const timeOut = (ms: number) => {
        // Settle before abort(): abort() fires onabort synchronously, which would win the race.
        settle(() => reject(new TimeoutError(`no response in ${ms} ms`)));
        xhr.abort();
      };
      // Our own timers, so a server that goes silent after receiving the bytes still times out.
      const timer = setTimeout(() => timeOut(req.timeoutMs), req.timeoutMs);
      // The idle timer restarts whenever bytes move, so a slow upload is fine and a stalled one isn't.
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const restartIdle = () => {
        if (!req.idleTimeoutMs) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => timeOut(req.idleTimeoutMs!), req.idleTimeoutMs);
      };
      restartIdle();

      xhr.open(req.method, req.url);
      for (const [k, v] of Object.entries(req.headers ?? {})) xhr.setRequestHeader(k, v);
      if ((req.onUploadProgress || req.idleTimeoutMs) && xhr.upload) {
        xhr.upload.onprogress = e => {
          restartIdle();
          req.onUploadProgress?.(e.loaded);
        };
      }
      xhr.onload = () =>
        settle(() =>
          resolve({
            status: xhr.status,
            text: typeof xhr.responseText === 'string' ? xhr.responseText : '',
            headers: parseHeaders(xhr.getAllResponseHeaders()),
          }),
        );
      xhr.onerror = () => settle(() => reject(new NetworkError('connection failed')));
      xhr.onabort = () => settle(() => reject(new AbortedError('aborted')));
      req.signal?.addEventListener('abort', onAbort);
      xhr.send(req.body ?? null);
    });
  },
};

function parseHeaders(raw: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of (raw ?? '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}
