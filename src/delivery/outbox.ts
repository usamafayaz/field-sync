import type { FileSystem } from './ports';
import type { LocalReport, OutboxFile, ReportId } from './types';

/** The outbox: the single durable list of reports this phone owns. */
export class Outbox {
  private reports: LocalReport[] = [];
  private listeners = new Set<() => void>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly fs: FileSystem) {}

  get file(): string {
    return `${this.fs.documentDir}/outbox.json`;
  }

  get reportsDir(): string {
    return `${this.fs.documentDir}/reports`;
  }

  reportDir(id: ReportId): string {
    return `${this.reportsDir}/${id}`;
  }

  async load(): Promise<void> {
    await this.fs.mkdir(this.reportsDir);
    if (await this.fs.exists(this.file)) {
      const parsed = JSON.parse(await this.fs.readText(this.file)) as OutboxFile;
      this.reports = parsed.reports ?? [];
    } else {
      this.reports = [];
    }
    this.emit();
  }

  /** Deletes report folders nothing owns (a crashed save, or files left after delivery). */
  async removeOrphanFiles(): Promise<void> {
    const known = new Set(this.reports.filter(r => r.status !== 'delivered').map(r => r.id));
    for (const name of await this.fs.list(this.reportsDir)) {
      if (!known.has(name)) await this.fs.remove(`${this.reportsDir}/${name}`);
    }
  }

  all = (): readonly LocalReport[] => this.reports;

  get(id: ReportId): LocalReport | undefined {
    return this.reports.find(r => r.id === id);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    for (const l of this.listeners) l();
  }

  async add(report: LocalReport): Promise<void> {
    this.reports = [...this.reports, report];
    await this.persist();
  }

  async update(id: ReportId, change: (r: LocalReport) => LocalReport): Promise<void> {
    this.reports = this.reports.map(r => (r.id === id ? change(r) : r));
    await this.persist();
  }

  async remove(id: ReportId): Promise<void> {
    this.reports = this.reports.filter(r => r.id !== id);
    await this.persist();
    await this.fs.remove(this.reportDir(id));
  }

  /** Empties memory and disk. Used by reset. */
  async clear(): Promise<void> {
    this.reports = [];
    await this.persist();
    await this.fs.remove(this.reportsDir);
    await this.fs.mkdir(this.reportsDir);
  }

  private persist(): Promise<void> {
    // Writes are serialised so a slow write can never land after a newer one.
    const snapshot: OutboxFile = { version: 1, reports: this.reports };
    this.emit();
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => this.fs.writeTextAtomic(this.file, JSON.stringify(snapshot)));
    return this.writeChain;
  }
}
