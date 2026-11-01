/** Everything the delivery engine needs from the outside world. */

export interface FileSystem {
  readonly documentDir: string;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  readText(path: string): Promise<string>;
  /** Must be atomic: after a crash the file holds either the old or the new content. */
  writeTextAtomic(path: string, content: string): Promise<void>;
  readChunk(path: string, length: number, position: number): Promise<ArrayBuffer>;
  copy(from: string, to: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  size(path: string): Promise<number>;
  sha256(path: string): Promise<string>;
  list(dir: string): Promise<string[]>;
}

export interface HttpRequest {
  method: 'GET' | 'HEAD' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
  timeoutMs: number;
  onUploadProgress?: (sentBytes: number) => void;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

/** Resolves with any HTTP status. */
export interface HttpTransport {
  request(req: HttpRequest): Promise<HttpResponse>;
}

export interface NetworkMonitor {
  /** `false` only when the OS is sure there is no connection (e.g. airplane mode). */
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

export interface ResizeResult {
  path: string;
  bytes: number;
  width: number;
  height: number;
}

export interface ImageProcessor {
  /** Re-encodes to JPEG off the JS thread, fitting inside maxEdge × maxEdge, never upscaling. */
  resizeJpeg(sourcePath: string, maxEdge: number, quality: number, outputDir: string): Promise<ResizeResult>;
}

/** Keeps the process (and JS timers) alive while there is undelivered work. */
export interface KeepAlive {
  hold(summary: string): void;
  release(): void;
}

export interface Clock {
  now(): number;
  /** Resolves after `ms`, or early if `signal` aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise(resolve => {
      if (signal.aborted) return resolve();
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        signal.removeEventListener('abort', done);
        resolve();
      }
      signal.addEventListener('abort', done);
    }),
};
