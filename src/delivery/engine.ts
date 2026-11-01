import { CHUNK_MAX_BYTES, CHUNK_MIN_BYTES, CHUNK_START_BYTES, CHUNK_TARGET_SECONDS } from '../config';
import type { ServerApi } from './api';
import { backoffDelay } from './backoff';
import { AbortedError, PermanentError, TransientError } from './errors';
import type { Outbox } from './outbox';
import type { Clock, FileSystem, ImageProcessor, KeepAlive, NetworkMonitor } from './ports';
import { prepareImage } from './prepareImage';
import type { Activity, LocalReport, Progress, ReportId } from './types';

export interface EngineDeps {
  outbox: Outbox;
  api: ServerApi;
  fs: FileSystem;
  images: ImageProcessor;
  network: NetworkMonitor;
  keepAlive: KeepAlive;
  clock: Clock;
  random?: () => number;
}

export interface EngineSnapshot {
  activity: Activity;
  online: boolean;
  /** Bytes the server has confirmed, per report in flight. */
  progress: Readonly<Record<ReportId, Progress>>;
}

/** After this many "missing bytes" commits in a row, back off and retry later. */
const MAX_COMMIT_ROUNDS = 3;

/** Moves reports from the outbox to the server, one at a time, oldest first. */
export class DeliveryEngine {
  private activity: Activity = { kind: 'idle' };
  private progress: Record<ReportId, Progress> = {};
  private snapshot: EngineSnapshot;
  private listeners = new Set<() => void>();
  private idleWaiters: Array<() => void> = [];

  private run?: { controller: AbortController; done: Promise<void> };
  private wakeController = new AbortController();
  private unsubscribers: Array<() => void> = [];

  private consecutiveFailures = 0;
  private backoffUntil = 0;
  private chunkSize = CHUNK_START_BYTES;

  constructor(private readonly deps: EngineDeps) {
    this.snapshot = this.buildSnapshot();
  }

  /* ----------------------------------------------------------- lifecycle */

  start(): void {
    if (this.run) return;
    const controller = new AbortController();
    this.unsubscribers = [
      this.deps.network.subscribe(online => {
        if (online) {
          // The link just came back: whatever we were waiting out is probably over.
          this.backoffUntil = 0;
          this.consecutiveFailures = 0;
        }
        this.emit();
        this.wake();
      }),
      // A new report, a retry, a deletion: re-read the outbox. Cheap, and no caller can forget.
      this.deps.outbox.subscribe(() => this.wake()),
    ];
    this.run = { controller, done: this.loop(controller.signal) };
  }

  /** Stops the loop and aborts any request in flight. Resolves once nothing is running. */
  async stop(): Promise<void> {
    const run = this.run;
    if (!run) return;
    this.run = undefined;
    this.unsubscribers.splice(0).forEach(u => u());
    run.controller.abort();
    this.wake();
    await run.done;
    this.progress = {};
    this.setActivity({ kind: 'idle' });
  }

  /** Re-check the outbox now: a new report, a reconnect, or the user asked. */
  wake(): void {
    const old = this.wakeController;
    this.wakeController = new AbortController();
    old.abort();
  }

  /** The user asked to try now, skipping any backoff. Also un-blocks a refused report. */
  async retryNow(id?: ReportId): Promise<void> {
    if (id) {
      await this.deps.outbox.update(id, r => ({ ...r, status: 'waiting', lastFailure: undefined }));
    }
    this.backoffUntil = 0;
    this.consecutiveFailures = 0;
    this.wake();
  }

  /** Resolves when no report is waiting. Used to end the background task. */
  whenIdle(): Promise<void> {
    if (!this.hasWork()) return Promise.resolve();
    return new Promise(resolve => this.idleWaiters.push(resolve));
  }

  hasWork(): boolean {
    return this.deps.outbox.all().some(r => r.status === 'waiting');
  }

  /* ----------------------------------------------------------- snapshot for UI */

  getSnapshot = (): EngineSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private buildSnapshot(): EngineSnapshot {
    return { activity: this.activity, online: this.deps.network.isOnline(), progress: this.progress };
  }

  private emit() {
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }

  private setActivity(activity: Activity) {
    this.activity = activity;
    this.emit();
  }

  private setProgress(id: ReportId, p: Progress | undefined) {
    const next = { ...this.progress };
    if (p) next[id] = p;
    else delete next[id];
    this.progress = next;
    this.emit();
  }

  /* ----------------------------------------------------------- the loop */

  private async loop(stop: AbortSignal): Promise<void> {
    const { outbox, network, clock, keepAlive } = this.deps;
    while (!stop.aborted) {
      const waiting = outbox.all().filter(r => r.status === 'waiting');
      this.updateKeepAlive(waiting);

      if (waiting.length === 0) {
        this.setActivity({ kind: 'idle' });
        this.idleWaiters.splice(0).forEach(r => r());
        await this.waitForWake(stop);
        continue;
      }

      // Preparing photos needs no network, so it never waits for one.
      const unprepared = waiting.find(r => r.images.some(i => !i.prepared));
      if (unprepared) {
        await this.guard(unprepared, stop, () => this.prepare(unprepared, stop), false);
        continue;
      }

      if (!network.isOnline()) {
        this.setActivity({ kind: 'offline' });
        await this.waitForWake(stop);
        continue;
      }

      const wait = this.backoffUntil - clock.now();
      if (wait > 0) {
        const reason = waiting[0].lastFailure?.message ?? 'Retrying shortly.';
        this.setActivity({ kind: 'backing-off', until: this.backoffUntil, reason });
        await clock.sleep(wait, anySignal(stop, this.wakeController.signal));
        continue;
      }

      const next = waiting[0];
      await this.guard(next, stop, () => this.deliver(next, stop), true);
    }
    keepAlive.release();
  }

  /** Runs one unit of work and turns its failure into the right outbox state. */
  private async guard(report: LocalReport, stop: AbortSignal, work: () => Promise<void>, countsAsAttempt: boolean) {
    try {
      await work();
      if (countsAsAttempt) this.consecutiveFailures = 0;
    } catch (err) {
      if (stop.aborted || err instanceof AbortedError) return;
      const at = this.deps.clock.now();
      if (err instanceof PermanentError) {
        this.setProgress(report.id, undefined);
        await this.deps.outbox.update(report.id, r => ({
          ...r,
          status: 'blocked',
          attempts: r.attempts + (countsAsAttempt ? 1 : 0),
          lastFailure: { message: err.message, at },
        }));
        return;
      }
      const message = err instanceof TransientError ? err.message : `Something went wrong: ${String(err)}`;
      this.consecutiveFailures += 1;
      this.chunkSize = Math.max(CHUNK_MIN_BYTES, Math.floor(this.chunkSize / 2));
      this.backoffUntil = at + backoffDelay(this.consecutiveFailures, this.deps.random);
      await this.deps.outbox.update(report.id, r => ({
        ...r,
        attempts: r.attempts + 1,
        lastFailure: { message, at },
      }));
    }
  }

  private waitForWake(stop: AbortSignal): Promise<void> {
    const wake = this.wakeController.signal;
    return new Promise(resolve => {
      if (stop.aborted || wake.aborted) return resolve();
      const done = () => {
        stop.removeEventListener('abort', done);
        wake.removeEventListener('abort', done);
        resolve();
      };
      stop.addEventListener('abort', done);
      wake.addEventListener('abort', done);
    });
  }

  private updateKeepAlive(waiting: LocalReport[]) {
    if (waiting.length === 0) return this.deps.keepAlive.release();
    const n = waiting.length;
    const noun = n === 1 ? 'report' : 'reports';
    this.deps.keepAlive.hold(
      this.deps.network.isOnline() ? `Sending ${n} ${noun}` : `${n} ${noun} saved on this phone, waiting for signal`,
    );
  }

  /* ----------------------------------------------------------- work units */

  private async prepare(report: LocalReport, stop: AbortSignal): Promise<void> {
    const { outbox, fs, images } = this.deps;
    const dir = outbox.reportDir(report.id);
    for (let i = 0; i < report.images.length; i++) {
      if (stop.aborted) return;
      if (report.images[i].prepared) continue;
      this.setActivity({ kind: 'preparing', reportId: report.id, imageIndex: i });
      const prepared = await prepareImage(report.images[i].source, `${dir}/send-${i}.jpg`, `${dir}/work`, fs, images);
      if (stop.aborted) return;
      await outbox.update(report.id, r => ({
        ...r,
        images: r.images.map((img, j) => (j === i ? { ...img, prepared } : img)),
      }));
    }
    await fs.remove(`${dir}/work`);
  }

  private async deliver(report: LocalReport, stop: AbortSignal): Promise<void> {
    const prepared = report.images.map(i => i.prepared!);
    const totalBytes = prepared.reduce((sum, p) => sum + p.bytes, 0);

    for (let round = 1; ; round++) {
      const committedEarly = await this.uploadImages(report.id, prepared, totalBytes, stop);

      this.setActivity({ kind: 'committing', reportId: report.id });
      const result = committedEarly
        ? ({ kind: 'stored' } as const)
        : await this.deps.api.commit(
            report.id,
            {
              description: report.description,
              createdAt: report.createdAt,
              images: prepared.map(p => ({ size: p.bytes, sha256: p.sha256, width: p.width, height: p.height })),
            },
            stop,
          );

      if (result.kind === 'stored') {
        await this.markDelivered(report.id);
        return;
      }
      // Server is missing or discarded some bytes. Go round again: offsets come from the server.
      if (round >= MAX_COMMIT_ROUNDS) {
        throw new TransientError('The server keeps losing parts of this report. Retrying later.');
      }
    }
  }

  /** Returns true if the server already has this report committed (an earlier reply was lost). */
  private async uploadImages(id: ReportId, prepared: LocalReport['images'][number]['prepared'][], totalBytes: number, stop: AbortSignal) {
    const { api, fs, clock } = this.deps;
    let doneBefore = 0;

    for (let i = 0; i < prepared.length; i++) {
      const image = prepared[i]!;
      this.setActivity({ kind: 'uploading', reportId: id, imageIndex: i });

      const start = await api.getOffset(id, i, stop);
      if (start.kind === 'already-committed') return true;
      let offset = start.offset > image.bytes ? 0 : start.offset;
      this.setProgress(id, { sentBytes: doneBefore + offset, totalBytes });

      while (offset < image.bytes) {
        if (stop.aborted) throw new AbortedError('stopped');
        const length = Math.min(this.chunkSize, image.bytes - offset);
        const chunk = await fs.readChunk(image.path, length, offset);
        const base = doneBefore + offset;
        const t0 = clock.now();

        const res = await api.sendChunk(id, i, offset, image.bytes, chunk, sent => {
          this.setProgress(id, { sentBytes: base + Math.min(sent, length), totalBytes });
        }, stop);
        if (res.kind === 'already-committed') return true;

        if (res.offset === offset + length) this.adaptChunkSize(length, clock.now() - t0);
        offset = res.offset;
        this.setProgress(id, { sentBytes: doneBefore + offset, totalBytes });
      }
      doneBefore += image.bytes;
    }
    return false;
  }

  /** Picks a chunk size that takes about CHUNK_TARGET_SECONDS on the current link. */
  private adaptChunkSize(bytes: number, ms: number) {
    const bytesPerSecond = bytes / Math.max(ms / 1000, 0.05);
    const ideal = bytesPerSecond * CHUNK_TARGET_SECONDS;
    // Grow at most 2× per step so one lucky chunk can't set us up for a timeout.
    const next = Math.min(ideal, this.chunkSize * 2);
    this.chunkSize = Math.round(Math.min(CHUNK_MAX_BYTES, Math.max(CHUNK_MIN_BYTES, next)));
  }

  private async markDelivered(id: ReportId) {
    const { outbox, fs, clock } = this.deps;
    // Record the fact first, then free the space.
    await outbox.update(id, r => ({ ...r, status: 'delivered', deliveredAt: clock.now(), lastFailure: undefined }));
    this.setProgress(id, undefined);
    await fs.remove(outbox.reportDir(id));
  }
}

function anySignal(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener('abort', () => controller.abort());
  }
  return controller.signal;
}
