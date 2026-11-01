/** Rules from the brief. These are product constraints, not tuning knobs. */
export const MIN_IMAGES = 1;
export const MAX_IMAGES = 5;
/** Hard ceiling at the destination. "5 MB" read as 5,000,000 bytes: the stricter of the two readings. */
export const MAX_IMAGE_BYTES = 5_000_000;
export const MAX_DESCRIPTION_LENGTH = 500;

/** Re-encode steps, tried in order until the photo fits. 3072px keeps inspection detail. */
export const IMAGE_LADDER: ReadonlyArray<{ maxEdge: number; quality: number }> = [
  { maxEdge: 3072, quality: 85 },
  { maxEdge: 3072, quality: 75 },
  { maxEdge: 2560, quality: 75 },
  { maxEdge: 2048, quality: 70 },
  { maxEdge: 1600, quality: 65 },
];
/** A little headroom under the ceiling so no rounding anywhere can push us over. */
export const IMAGE_TARGET_BYTES = 4_800_000;

/** Upload chunking. Adaptive between these bounds, aiming for ~8 s per chunk. */
export const CHUNK_MIN_BYTES = 16 * 1024;
export const CHUNK_START_BYTES = 64 * 1024;
export const CHUNK_MAX_BYTES = 1024 * 1024;
export const CHUNK_TARGET_SECONDS = 8;

/** A request that takes longer than this has hung; abort and resume from the server's offset. */
export const REQUEST_TIMEOUT_MS = 30_000;
/** Chunk timeouts allow for a link as slow as 1.5 KB/s. */
export const CHUNK_TIMEOUT_FLOOR_BPS = 1500;

/** Retry backoff for transient failures. */
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 60_000;

/** Emulator default; changeable in Settings for a real device on the same network. */
export const DEFAULT_SERVER_URL = 'http://10.0.2.2:4000';
