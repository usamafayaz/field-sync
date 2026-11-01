/** The one decision that matters on every failure: is trying again going to help? */

export class TransientError extends Error {
  readonly name = 'TransientError';
}

export class PermanentError extends Error {
  readonly name = 'PermanentError';
}

/** Raised by transports when no HTTP response arrived. */
export class NetworkError extends Error {
  readonly name = 'NetworkError';
}
export class TimeoutError extends Error {
  readonly name = 'TimeoutError';
}
export class AbortedError extends Error {
  readonly name = 'AbortedError';
}

/** Statuses where the same request may well succeed later. */
export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

export function serverMessage(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}

/** Turns an HTTP status the caller didn't expect into the right error class. */
export function errorForStatus(status: number, text: string, what: string): Error {
  const detail = serverMessage(text);
  if (isRetryableStatus(status)) {
    return new TransientError(`The server had a problem (${status}) while ${what}.`);
  }
  if (status === 413) {
    return new PermanentError('The server refused a photo as too large.');
  }
  return new PermanentError(`The server refused this report (${status}${detail ? `: ${detail}` : ''}).`);
}

/** Wraps transport rejections so the engine only ever sees Transient/Permanent/Aborted. */
export function classifyTransportError(err: unknown, what: string): Error {
  if (err instanceof AbortedError) return err;
  if (err instanceof TimeoutError) return new TransientError(`No answer from the server while ${what}.`);
  if (err instanceof NetworkError) return new TransientError(`Connection lost while ${what}.`);
  if (err instanceof TransientError || err instanceof PermanentError) return err;
  return new TransientError(`Unexpected error while ${what}: ${String((err as Error)?.message ?? err)}`);
}
