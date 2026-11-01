// Persisted outbox types. Live upload progress is kept in memory, not here.

export type ReportId = string;

/** A photo as the user picked it, copied into app storage so it outlives the picker's cache. */
export interface SourceImage {
  path: string;
  bytes: number;
  width: number;
  height: number;
  mime: string;
}

/** The re-encoded file we actually send. Exists once preparation has finished for that photo. */
export interface PreparedImage {
  path: string;
  bytes: number;
  sha256: string;
  width: number;
  height: number;
}

export interface ReportImage {
  source: SourceImage;
  prepared?: PreparedImage;
}

export type ReportStatus = 'waiting' | 'delivered' | 'blocked';

export interface FailureNote {
  /** Plain-language reason, written for the person holding the phone. */
  message: string;
  at: number;
}

export interface LocalReport {
  id: ReportId;
  description: string;
  createdAt: number;
  images: ReportImage[];
  status: ReportStatus;
  attempts: number;
  lastFailure?: FailureNote;
  deliveredAt?: number;
}

export interface OutboxFile {
  version: 1;
  reports: LocalReport[];
}

/** What the engine is doing this instant, for the UI. Not persisted. */
export type Activity =
  | { kind: 'idle' }
  | { kind: 'offline' }
  | { kind: 'preparing'; reportId: ReportId; imageIndex: number }
  | { kind: 'uploading'; reportId: ReportId; imageIndex: number }
  | { kind: 'committing'; reportId: ReportId }
  | { kind: 'backing-off'; until: number; reason: string };

/** Bytes confirmed by the server per report, for progress bars. */
export interface Progress {
  sentBytes: number;
  totalBytes: number;
}

/** A report as the server holds it (GET /api/reports). */
export interface ServerReport {
  id: ReportId;
  description: string;
  createdAt: number | null;
  receivedAt: string;
  images: Array<{ index: number; size: number; sha256: string; width: number | null; height: number | null }>;
}
