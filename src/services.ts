import { DEFAULT_SERVER_URL } from './config';
import { ServerApi } from './delivery/api';
import { DraftStore } from './delivery/drafts';
import { DeliveryEngine } from './delivery/engine';
import { Outbox } from './delivery/outbox';
import { realClock } from './delivery/ports';
import { cachesDir, nativeFileSystem } from './platform/fileSystem';
import { xhrTransport } from './platform/httpTransport';
import { nativeImageProcessor } from './platform/imageProcessor';
import { createKeepAlive } from './platform/keepAlive';
import { createNetworkMonitor } from './platform/network';
import { Settings } from './settings';

/** The composition root: the one place that knows which concrete adapters back each port. */
const fs = nativeFileSystem;
export const settings = new Settings(fs, DEFAULT_SERVER_URL);
export const outbox = new Outbox(fs);
export const drafts = new DraftStore(fs, outbox);
export const api = new ServerApi(xhrTransport, () => settings.get().serverUrl);
export const network = createNetworkMonitor();
export const engine = new DeliveryEngine({
  outbox,
  api,
  fs,
  images: nativeImageProcessor,
  network,
  keepAlive: createKeepAlive(),
  clock: realClock,
});

let booting: Promise<void> | null = null;

/** Loads persisted state and starts delivery. Safe to call from the UI and the background task. */
export function boot(): Promise<void> {
  booting ??= (async () => {
    await settings.load();
    await outbox.load();
    await drafts.load();
    await outbox.removeOrphanFiles(); // after drafts.load, which may reclaim a half-saved report
    engine.start();
  })();
  return booting;
}

/** Start over: clears everything on this phone, keeps what is on the server. */
export async function resetDevice(): Promise<void> {
  await boot();
  const abandoned = outbox.all().filter(r => r.status !== 'delivered').map(r => r.id);
  await engine.stop(); // aborts in-flight requests and waits for the loop to exit
  await outbox.clear();
  await drafts.discard();
  for (const name of await fs.list(cachesDir)) await fs.remove(`${cachesDir}/${name}`);
  engine.start();
  // Best effort, after local state is gone: let the server drop half-uploaded bytes.
  abandoned.forEach(id => api.discardPartial(id));
}
