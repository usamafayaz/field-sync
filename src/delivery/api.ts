import { CHUNK_TIMEOUT_FLOOR_BPS, REQUEST_TIMEOUT_MS } from '../config';
import { classifyTransportError, errorForStatus, PermanentError, TransientError } from './errors';
import type { HttpResponse, HttpTransport } from './ports';
import type { ReportId, ServerReport } from './types';

export interface CommitBody {
  description: string;
  createdAt: number;
  images: Array<{ size: number; sha256: string; width: number; height: number }>;
}

export type CommitResult =
  | { kind: 'stored' }
  /** The server is missing bytes for some images (or found them corrupt and discarded them). */
  | { kind: 'incomplete'; redo: number[] };

export type OffsetResult = { kind: 'offset'; offset: number } | { kind: 'already-committed' };

/** Thin, typed wrapper over the FieldSync server protocol (see server/index.js). */
export class ServerApi {
  constructor(private readonly transport: HttpTransport, private readonly baseUrl: () => string) {}

  private async send(what: string, run: () => Promise<HttpResponse>): Promise<HttpResponse> {
    try {
      return await run();
    } catch (err) {
      throw classifyTransportError(err, what);
    }
  }

  private json<T>(res: HttpResponse, what: string): T {
    try {
      return JSON.parse(res.text) as T;
    } catch {
      // A garbled body from a proxy or a half-delivered response: not the server saying no.
      throw new TransientError(`Unreadable reply from the server while ${what}.`);
    }
  }

  /** How many bytes of this image the server already has. */
  async getOffset(id: ReportId, index: number, signal?: AbortSignal): Promise<OffsetResult> {
    const what = 'checking upload progress';
    const res = await this.send(what, () =>
      this.transport.request({ method: 'GET', url: `${this.baseUrl()}/api/uploads/${id}/${index}`, timeoutMs: REQUEST_TIMEOUT_MS, signal }),
    );
    if (res.status !== 200) throw errorForStatus(res.status, res.text, what);
    const body = this.json<{ offset: number; committed?: boolean }>(res, what);
    if (body.committed) return { kind: 'already-committed' };
    return { kind: 'offset', offset: body.offset };
  }

  /** Appends `chunk` at `offset`. */
  async sendChunk(
    id: ReportId,
    index: number,
    offset: number,
    totalBytes: number,
    chunk: ArrayBuffer,
    onProgress: (sent: number) => void,
    signal?: AbortSignal,
  ): Promise<OffsetResult> {
    const what = 'uploading a photo';
    const timeoutMs = REQUEST_TIMEOUT_MS + Math.ceil((chunk.byteLength / CHUNK_TIMEOUT_FLOOR_BPS) * 1000);
    const res = await this.send(what, () =>
      this.transport.request({
        method: 'PATCH',
        url: `${this.baseUrl()}/api/uploads/${id}/${index}`,
        headers: {
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': String(offset),
          'Upload-Length': String(totalBytes),
        },
        body: chunk,
        timeoutMs,
        idleTimeoutMs: REQUEST_TIMEOUT_MS,
        onUploadProgress: onProgress,
        signal,
      }),
    );
    if (res.status === 200 || res.status === 409) {
      const body = this.json<{ offset: number; committed?: boolean }>(res, what);
      if (body.committed) return { kind: 'already-committed' };
      if (typeof body.offset !== 'number') throw new TransientError(`Unreadable reply from the server while ${what}.`);
      return { kind: 'offset', offset: body.offset };
    }
    throw errorForStatus(res.status, res.text, what);
  }

  /** Idempotent: committing the same id twice is a 200, never a second report. */
  async commit(id: ReportId, body: CommitBody, signal?: AbortSignal): Promise<CommitResult> {
    const what = 'finishing the report';
    const res = await this.send(what, () =>
      this.transport.request({
        method: 'PUT',
        url: `${this.baseUrl()}/api/reports/${id}`,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        timeoutMs: REQUEST_TIMEOUT_MS,
        signal,
      }),
    );
    if (res.status === 200 || res.status === 201) return { kind: 'stored' };
    if (res.status === 409) {
      const parsed = this.json<{ missing?: Array<{ index: number }>; corrupt?: number[] }>(res, what);
      const redo = [...(parsed.missing ?? []).map(m => m.index), ...(parsed.corrupt ?? [])];
      if (redo.length === 0) throw new PermanentError('The server rejected this report as conflicting.');
      return { kind: 'incomplete', redo };
    }
    throw errorForStatus(res.status, res.text, what);
  }

  /** Best effort: lets the server drop half-uploaded bytes for a report we've abandoned. */
  async discardPartial(id: ReportId): Promise<void> {
    await this.transport
      .request({ method: 'DELETE', url: `${this.baseUrl()}/api/uploads/${id}`, timeoutMs: 5_000 })
      .catch(() => undefined);
  }

  async listReports(signal?: AbortSignal): Promise<ServerReport[]> {
    const what = 'loading reports';
    const res = await this.send(what, () =>
      this.transport.request({ method: 'GET', url: `${this.baseUrl()}/api/reports`, timeoutMs: REQUEST_TIMEOUT_MS, signal }),
    );
    if (res.status !== 200) throw errorForStatus(res.status, res.text, what);
    return this.json<{ reports: ServerReport[] }>(res, what).reports;
  }

  imageUrl(id: ReportId, index: number): string {
    return `${this.baseUrl()}/api/reports/${id}/images/${index}`;
  }
}
