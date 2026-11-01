import type { EngineSnapshot } from '../delivery/engine';
import type { LocalReport } from '../delivery/types';
import type { StateTone } from './theme';

/** The words the app uses for where a report is. */
export interface ReportStatusView {
  tone: StateTone;
  label: string;
  detail: string;
  /** 0–1 when bytes are moving or partly confirmed. */
  progress?: number;
}

export function describeReport(r: LocalReport, s: EngineSnapshot, now: number): ReportStatusView {
  if (r.status === 'delivered') {
    return { tone: 'server', label: 'On the server', detail: `Confirmed ${timeAgo(r.deliveredAt ?? now, now)}` };
  }
  if (r.status === 'blocked') {
    return { tone: 'needs', label: 'Needs you', detail: r.lastFailure?.message ?? 'The server refused this report.' };
  }

  const a = s.activity;
  const p = s.progress[r.id];
  const progress = p && p.totalBytes > 0 ? p.sentBytes / p.totalBytes : undefined;
  const mine = 'reportId' in a && a.reportId === r.id;

  if (mine && a.kind === 'preparing') {
    return { tone: 'phone', label: 'On this phone', detail: `Preparing photo ${a.imageIndex + 1} of ${r.images.length}` };
  }
  if (mine && a.kind === 'uploading') {
    return { tone: 'moving', label: 'Sending', detail: `Photo ${a.imageIndex + 1} of ${r.images.length}`, progress };
  }
  if (mine && a.kind === 'committing') {
    return { tone: 'moving', label: 'Sending', detail: 'Waiting for the server to confirm', progress: 1 };
  }
  if (!s.online) {
    return { tone: 'phone', label: 'On this phone', detail: 'Will send when there’s signal', progress };
  }
  if (r.lastFailure) {
    return { tone: 'phone', label: 'On this phone', detail: `${r.lastFailure.message} Retrying automatically.`, progress };
  }
  return { tone: 'phone', label: 'On this phone', detail: 'Queued to send', progress };
}

/** The one-glance answer at the top of the outbox. */
export interface Headline {
  tone: StateTone;
  title: string;
  body: string;
  progress?: number;
  canRetryNow?: boolean;
}

export function describeOutbox(reports: readonly LocalReport[], s: EngineSnapshot, now: number): Headline {
  const waiting = reports.filter(r => r.status === 'waiting');
  const blocked = reports.filter(r => r.status === 'blocked');
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

  if (blocked.length) {
    return {
      tone: 'needs',
      title: `${n(blocked.length, 'report')} ${blocked.length === 1 ? 'needs' : 'need'} you`,
      body: 'The server refused it. It’s still saved on this phone. Open it to see why.',
    };
  }
  if (waiting.length === 0) {
    const any = reports.length > 0;
    return {
      tone: 'server',
      title: any ? 'Everything is on the server' : 'Nothing waiting',
      body: any ? 'Every report from this phone has been confirmed by the server.' : 'Reports you save will appear here until the server confirms them.',
    };
  }

  const a = s.activity;
  const total = waiting.reduce((sum, r) => sum + (s.progress[r.id]?.totalBytes ?? 0), 0);
  const sent = waiting.reduce((sum, r) => sum + (s.progress[r.id]?.sentBytes ?? 0), 0);
  const progress = total > 0 ? sent / total : undefined;
  const count = n(waiting.length, 'report');

  if (!s.online) {
    return { tone: 'phone', title: `${count} on this phone`, body: 'No signal. They’re saved and will send by themselves when the connection is back.' };
  }
  if (a.kind === 'backing-off') {
    const secs = Math.max(1, Math.ceil((a.until - now) / 1000));
    return { tone: 'phone', title: `${count} on this phone`, body: `${a.reason} Trying again in ${secs}s.`, canRetryNow: true, progress };
  }
  if (a.kind === 'preparing') {
    return { tone: 'phone', title: `${count} on this phone`, body: 'Preparing photos for sending.' };
  }
  if (a.kind === 'uploading' || a.kind === 'committing') {
    const index = waiting.findIndex(r => r.id === a.reportId) + 1;
    return { tone: 'moving', title: `Sending ${index} of ${waiting.length}`, body: 'Keep working. This continues in the background.', progress };
  }
  return { tone: 'phone', title: `${count} on this phone`, body: 'Queued to send.' };
}

export function timeAgo(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(then).toLocaleDateString();
}

export function formatBytes(bytes: number): string {
  // Decimal units, matching how the 5 MB limit is enforced.
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
