import type { FileSystem } from './delivery/ports';

export type Appearance = 'system' | 'light' | 'dark';

export interface AppSettings {
  serverUrl: string;
  appearance: Appearance;
}

/** Tiny persisted settings file: the server address and the appearance choice. */
export class Settings {
  private value: AppSettings;
  private listeners = new Set<() => void>();

  constructor(private readonly fs: FileSystem, defaultUrl: string) {
    this.value = { serverUrl: defaultUrl, appearance: 'system' };
  }

  private get file() {
    return `${this.fs.documentDir}/settings.json`;
  }

  async load() {
    if (await this.fs.exists(this.file)) {
      this.value = { ...this.value, ...(JSON.parse(await this.fs.readText(this.file)) as Partial<AppSettings>) };
      this.emit();
    }
  }

  get = () => this.value;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private emit() {
    this.listeners.forEach(l => l());
  }

  private async update(change: Partial<AppSettings>) {
    this.value = { ...this.value, ...change };
    this.emit();
    await this.fs.writeTextAtomic(this.file, JSON.stringify(this.value));
  }

  setServerUrl(url: string) {
    return this.update({ serverUrl: url.trim().replace(/\/+$/, '') });
  }

  setAppearance(appearance: Appearance) {
    return this.update({ appearance });
  }
}
