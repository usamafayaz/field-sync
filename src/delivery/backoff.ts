import { BACKOFF_BASE_MS, BACKOFF_MAX_MS } from '../config';

/** Exponential backoff with "full jitter": a random delay between 0 and the exponential cap. */
export function backoffDelay(failures: number, random: () => number = Math.random): number {
  const cap = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
  return Math.round(BACKOFF_BASE_MS / 2 + random() * (cap - BACKOFF_BASE_MS / 2));
}
