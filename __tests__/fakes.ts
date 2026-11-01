/// <reference types="node" />
import { createHash } from 'crypto';
import { AbortedError, NetworkError, TimeoutError } from '../src/delivery/errors';
import type { Clock, FileSystem, HttpRequest, HttpResponse, HttpTransport, ImageProcessor, KeepAlive, NetworkMonitor } from '../src/delivery/ports';

/* In-memory stand-ins for every port. */

export class MemoryFs implements FileSystem {
  readonly documentDir = '/docs';
  files = new Map<string, Uint8Array>();
  dirs = new Set<string>(['/docs']);

  async exists(p: string) {
    return this.files.has(p) || this.dirs.has(p);
  }
  async mkdir(p: string) {
    this.dirs.add(p);
  }
  async readText(p: string) {
    return Buffer.from(this.must(p)).toString('utf8');
  }
  async writeTextAtomic(p: string, content: string) {
    this.files.set(p, new Uint8Array(Buffer.from(content, 'utf8')));
  }
  async readChunk(p: string, length: number, position: number) {
    const slice = this.must(p).slice(position, position + length);
    return slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) as ArrayBuffer;
  }
  async copy(from: string, to: string) {
    this.files.set(to, new Uint8Array(this.must(from)));
  }
  async move(from: string, to: string) {
    this.files.set(to, this.must(from));
    this.files.delete(from);
  }
  async remove(p: string) {
    this.files.delete(p);
    this.dirs.delete(p);
    for (const k of [...this.files.keys()]) if (k.startsWith(`${p}/`)) this.files.delete(k);
    for (const k of [...this.dirs]) if (k.startsWith(`${p}/`)) this.dirs.delete(k);
  }
  async size(p: string) {
    return this.must(p).byteLength;
  }
  async sha256(p: string) {
    return createHash('sha256').update(this.must(p)).digest('hex');
  }
  async list(dir: string) {
    const names = new Set<string>();
    for (const k of [...this.files.keys(), ...this.dirs]) {
      if (k.startsWith(`${dir}/`)) names.add(k.slice(dir.length + 1).split('/')[0]);
    }
    return [...names];
  }
  put(p: string, bytes: number, seed = 1) {
    const data = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++) data[i] = (i * 31 + seed * 7) & 0xff;
    this.files.set(p, data);
  }
  private must(p: string) {
    const f = this.files.get(p);
    if (!f) throw new Error(`ENOENT ${p}`);
    return f;
  }
}

/** Shrinks to a fixed fraction of the original per ladder step, like a real encoder would. */
export class FakeImages implements ImageProcessor {
  calls = 0;
  constructor(private fs: MemoryFs) {}
  async resizeJpeg(src: string, maxEdge: number, quality: number, outDir: string) {
    this.calls++;
    const orig = await this.fs.size(src);
    const bytes = Math.round(orig * (maxEdge / 6000) ** 2 * (quality / 100));
    const path = `${outDir}/r${this.calls}.jpg`;
    this.fs.put(path, bytes, this.calls);
    return { path, bytes, width: maxEdge, height: Math.round(maxEdge * 0.75) };
  }
}

export interface Faults {
  /** Next N chunk uploads lose the connection halfway through. */
  dropChunks?: number;
  /** Next N requests get 503. */
  errors?: number;
  /** Next N requests never answer (transport times out). */
  hangs?: number;
  /** All uploads refused with 400. */
  refuse?: boolean;
  /** Next N commits are stored but the response is lost. */
  loseCommitResponses?: number;
}

/** A faithful in-memory version of server/index.js, reachable through HttpTransport. */
export class FakeServer implements HttpTransport {
  uploads = new Map<string, Uint8Array>();
  reports = new Map<string, { description: string; images: Uint8Array[] }>();
  faults: Faults = {};
  log: string[] = [];
  online = true;

  async request(req: HttpRequest): Promise<HttpResponse> {
    if (req.signal?.aborted) throw new AbortedError('aborted');
    if (!this.online) throw new NetworkError('offline');
    const path = new URL(req.url).pathname;
    this.log.push(`${req.method} ${path}`);
    if (this.faults.hangs) {
      this.faults.hangs--;
      throw new TimeoutError('hung');
    }
    if (this.faults.errors) {
      this.faults.errors--;
      return this.reply(503, { error: 'injected' });
    }
    const [, , kind, id, idx] = path.split('/');
    if (kind === 'uploads') return this.upload(req, id, Number(idx));
    if (kind === 'reports' && req.method === 'PUT') return this.commit(req, id);
    if (kind === 'reports' && req.method === 'GET') {
      return this.reply(200, { reports: [...this.reports.entries()].map(([rid, r]) => ({ id: rid, description: r.description, images: [] })) });
    }
    return this.reply(404, {});
  }

  private upload(req: HttpRequest, id: string, idx: number): HttpResponse {
    const key = `${id}/${idx}`;
    if (this.reports.has(id)) return this.reply(200, { offset: -1, committed: true });
    const current = this.uploads.get(key) ?? new Uint8Array(0);
    if (req.method === 'GET') return this.reply(200, { offset: current.byteLength });
    if (req.method === 'DELETE') {
      for (const k of [...this.uploads.keys()]) if (k.startsWith(`${id}/`)) this.uploads.delete(k);
      return this.reply(200, {});
    }
    if (this.faults.refuse) return this.reply(400, { error: 'refused' });
    const offset = Number(req.headers!['Upload-Offset']);
    if (offset !== current.byteLength) return this.reply(409, { offset: current.byteLength });
    let body = new Uint8Array(req.body as ArrayBuffer);
    if (this.faults.dropChunks) {
      this.faults.dropChunks--;
      body = body.slice(0, Math.floor(body.byteLength / 2)); // half arrives, then the line dies
      this.uploads.set(key, concat(current, body));
      throw new NetworkError('dropped');
    }
    const next = concat(current, body);
    this.uploads.set(key, next);
    return this.reply(200, { offset: next.byteLength });
  }

  private commit(req: HttpRequest, id: string): HttpResponse {
    if (this.reports.has(id)) return this.reply(200, { id });
    const body = JSON.parse(req.body as string) as { description: string; images: Array<{ size: number; sha256: string }> };
    const missing: Array<{ index: number }> = [];
    const corrupt: number[] = [];
    body.images.forEach((img, i) => {
      const data = this.uploads.get(`${id}/${i}`);
      if (!data || data.byteLength !== img.size) missing.push({ index: i });
      else if (createHash('sha256').update(data).digest('hex') !== img.sha256) {
        corrupt.push(i);
        this.uploads.delete(`${id}/${i}`);
      }
    });
    if (missing.length || corrupt.length) return this.reply(409, { missing, corrupt });
    this.reports.set(id, { description: body.description, images: body.images.map((_, i) => this.uploads.get(`${id}/${i}`)!) });
    if (this.faults.loseCommitResponses) {
      this.faults.loseCommitResponses--;
      throw new NetworkError('response lost');
    }
    return this.reply(201, { id });
  }

  private reply(status: number, body: unknown): HttpResponse {
    return { status, headers: {}, text: JSON.stringify(body) };
  }

  count(method: string, fragment: string) {
    return this.log.filter(l => l.startsWith(method) && l.includes(fragment)).length;
  }
}

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a);
  out.set(b, a.byteLength);
  return out;
}

export class FakeNetwork implements NetworkMonitor {
  private listeners = new Set<(o: boolean) => void>();
  constructor(private server: FakeServer) {}
  isOnline = () => this.server.online;
  subscribe(l: (o: boolean) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  set(online: boolean) {
    this.server.online = online;
    this.listeners.forEach(l => l(online));
  }
}

/** Time is virtual: sleeping advances the clock instantly, so backoff doesn't slow tests down. */
export class FakeClock implements Clock {
  t = 1_700_000_000_000;
  now = () => this.t;
  sleep = async (ms: number) => {
    this.t += ms;
    await Promise.resolve();
  };
}

export const noKeepAlive: KeepAlive = { hold: () => undefined, release: () => undefined };
