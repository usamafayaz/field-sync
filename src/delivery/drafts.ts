import { MAX_DESCRIPTION_LENGTH, MAX_IMAGES, MIN_IMAGES } from '../config';
import type { Outbox } from './outbox';
import type { FileSystem } from './ports';
import type { LocalReport, ReportId, SourceImage } from './types';

export interface Draft {
  /** Chosen when the draft starts and kept through submit, so a crash mid-submit can't make two. */
  id: ReportId;
  description: string;
  images: SourceImage[];
}

export type DraftProblem = 'description-blank' | 'description-too-long' | 'no-images' | 'too-many-images';

export function validateDraft(d: Pick<Draft, 'description' | 'images'>): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (d.description.trim().length === 0) problems.push('description-blank');
  if (d.description.length > MAX_DESCRIPTION_LENGTH) problems.push('description-too-long');
  if (d.images.length < MIN_IMAGES) problems.push('no-images');
  if (d.images.length > MAX_IMAGES) problems.push('too-many-images');
  return problems;
}

/** RFC 4122 v4. Math.random is fine here: ids only need to be unique per phone, not secret. */
export function newId(random: () => number = Math.random): ReportId {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const extFor = (mime: string) => (mime === 'image/png' ? 'png' : mime === 'image/heic' ? 'heic' : mime === 'image/webp' ? 'webp' : 'jpg');

/** The report being composed. */
export class DraftStore {
  private draft: Draft;
  private listeners = new Set<() => void>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly fs: FileSystem, private readonly outbox: Outbox, private readonly random = Math.random) {
    this.draft = this.empty();
  }

  private get dir() {
    return `${this.fs.documentDir}/draft`;
  }
  private get file() {
    return `${this.fs.documentDir}/draft.json`;
  }

  private empty(): Draft {
    return { id: newId(this.random), description: '', images: [] };
  }

  async load(): Promise<void> {
    await this.fs.mkdir(this.dir);
    if (await this.fs.exists(this.file)) {
      const saved = JSON.parse(await this.fs.readText(this.file)) as Draft;
      // Already in the outbox means we crashed after saving but before clearing. It's sent; drop it.
      if (this.outbox.get(saved.id)) {
        await this.discard();
        return;
      }
      const images: SourceImage[] = [];
      for (const img of saved.images) if (await this.fs.exists(img.path)) images.push(img);
      this.draft = { ...saved, images };
    }
    this.emit();
  }

  get = (): Draft => this.draft;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    for (const l of this.listeners) l();
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.draft);
    this.emit();
    this.writeChain = this.writeChain.catch(() => undefined).then(() => this.fs.writeTextAtomic(this.file, snapshot));
    return this.writeChain;
  }

  setDescription(description: string): Promise<void> {
    this.draft = { ...this.draft, description };
    return this.persist();
  }

  /** Copies picked photos into app storage. Returns how many were added (never past the limit). */
  async addImages(picked: SourceImage[]): Promise<number> {
    const room = MAX_IMAGES - this.draft.images.length;
    const accepted = picked.slice(0, Math.max(0, room));
    const copied: SourceImage[] = [];
    for (const img of accepted) {
      const path = `${this.dir}/${newId(this.random)}.${extFor(img.mime)}`;
      await this.fs.copy(img.path, path);
      copied.push({ ...img, path, bytes: await this.fs.size(path) });
    }
    this.draft = { ...this.draft, images: [...this.draft.images, ...copied] };
    await this.persist();
    return copied.length;
  }

  async removeImage(index: number): Promise<void> {
    const img = this.draft.images[index];
    if (!img) return;
    this.draft = { ...this.draft, images: this.draft.images.filter((_, i) => i !== index) };
    await this.persist();
    await this.fs.remove(img.path);
  }

  /** Moves the draft into the outbox. */
  async submit(now: number): Promise<LocalReport> {
    const d = this.draft;
    const problems = validateDraft(d);
    if (problems.length) throw new Error(`Draft is not ready: ${problems.join(', ')}`);

    const existing = this.outbox.get(d.id);
    if (existing) return existing;

    const dir = this.outbox.reportDir(d.id);
    await this.fs.mkdir(dir);
    const images = [];
    for (let i = 0; i < d.images.length; i++) {
      const src = d.images[i];
      const path = `${dir}/source-${i}.${extFor(src.mime)}`;
      await this.fs.copy(src.path, path); // copy, not move: the draft stays intact until the outbox has it
      images.push({ source: { ...src, path } });
    }
    const report: LocalReport = {
      id: d.id,
      description: d.description.trim(),
      createdAt: now,
      images,
      status: 'waiting',
      attempts: 0,
    };
    await this.outbox.add(report);
    await this.discard();
    return report;
  }

  /** Throws the draft away and starts a fresh one. */
  async discard(): Promise<void> {
    this.draft = this.empty();
    await this.persist();
    await this.fs.remove(this.dir);
    await this.fs.mkdir(this.dir);
  }
}
