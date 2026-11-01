/// <reference types="node" />
/** The delivery guarantees, exercised without rendering anything. */
import { createHash } from 'crypto';
import { IMAGE_TARGET_BYTES, MAX_IMAGE_BYTES } from '../src/config';
import { ServerApi } from '../src/delivery/api';
import { DraftStore, validateDraft } from '../src/delivery/drafts';
import { DeliveryEngine } from '../src/delivery/engine';
import { Outbox } from '../src/delivery/outbox';
import { FakeClock, FakeImages, FakeNetwork, FakeServer, MemoryFs, noKeepAlive } from './fakes';

function setup(shared?: { fs: MemoryFs; server: FakeServer }) {
  const fs = shared?.fs ?? new MemoryFs();
  const server = shared?.server ?? new FakeServer();
  const network = new FakeNetwork(server);
  const outbox = new Outbox(fs);
  const drafts = new DraftStore(fs, outbox);
  const images = new FakeImages(fs);
  const api = new ServerApi(server, () => 'http://server');
  const engine = new DeliveryEngine({ outbox, api, fs, images, network, keepAlive: noKeepAlive, clock: new FakeClock() });
  return { fs, server, network, outbox, drafts, images, engine };
}

/** Composes and saves a report the way the UI does. Sizes are bytes of each original photo. */
async function compose(env: ReturnType<typeof setup>, description: string, sizes: number[]) {
  const picked = sizes.map((bytes, i) => {
    const path = `/picker/${description}-${i}.jpg`;
    env.fs.put(path, bytes, i + description.length);
    return { path, bytes, width: bytes > IMAGE_TARGET_BYTES ? 8000 : 3000, height: bytes > IMAGE_TARGET_BYTES ? 6000 : 2250, mime: 'image/jpeg' };
  });
  await env.drafts.setDescription(description);
  await env.drafts.addImages(picked);
  return env.drafts.submit(Date.now());
}

async function until(cond: () => boolean, label = 'condition') {
  for (let i = 0; i < 20_000; i++) {
    if (cond()) return;
    await new Promise<void>(r => setImmediate(r));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const delivered = (env: ReturnType<typeof setup>) => env.outbox.all().filter(r => r.status === 'delivered').length;

async function boot(env: ReturnType<typeof setup>) {
  await env.outbox.load();
  await env.drafts.load();
  await env.outbox.removeOrphanFiles();
  env.engine.start();
}

describe('the main scenario from the brief', () => {
  it('offline → three reports (one with five huge photos) → force-quit → reopen → flaky link → all three exactly once', async () => {
    const first = setup();
    await boot(first);
    first.network.set(false); // airplane mode

    await compose(first, 'stairwell crack', [3_000_000]);
    await compose(first, 'five originals', [18_000_000, 18_000_000, 18_000_000, 18_000_000, 18_000_000]);
    await compose(first, 'roof drain', [2_000_000, 1_500_000]);
    await until(() => first.outbox.all().every(r => r.images.every(i => i.prepared)), 'photos prepared offline');
    expect(first.server.log).toHaveLength(0); // not a single request while offline

    // Force-quit: abandon this engine mid-flight. Only the file system and the server survive.
    first.network.set(true);
    first.server.faults = { dropChunks: 2 };
    await until(() => first.server.log.length > 3, 'some upload started');
    first.engine.stop(); // not awaited: the old process just stops

    const second = setup({ fs: first.fs, server: first.server });
    await boot(second);
    second.server.faults = { dropChunks: 2, errors: 2, loseCommitResponses: 1 };
    await until(() => delivered(second) === 3, 'all delivered');

    expect(second.server.reports.size).toBe(3);
    for (const [id, stored] of second.server.reports) {
      const local = second.outbox.get(id)!;
      expect(stored.description).toBe(local.description);
      stored.images.forEach((bytes, i) => {
        expect(bytes.byteLength).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(local.images[i].prepared!.sha256);
      });
    }
    await second.engine.stop();
  });
});

describe('delivery guarantees', () => {
  it('a lost commit response does not create a second report', async () => {
    const env = setup();
    await boot(env);
    env.server.faults = { loseCommitResponses: 3 };
    await compose(env, 'lost reply', [1_000_000]);
    await until(() => delivered(env) === 1);
    expect(env.server.reports.size).toBe(1);
    // The reply was lost, so the phone had to try again; the retry learned it was already stored.
    expect(env.outbox.all()[0].attempts).toBeGreaterThanOrEqual(1);
    await env.engine.stop();
  });

  it('resumes from the server offset after a drop instead of starting over', async () => {
    const env = setup();
    await boot(env);
    env.server.faults = { dropChunks: 5 };
    await compose(env, 'resume', [4_000_000]);
    await until(() => delivered(env) === 1);
    // The bytes on the server match the phone's copy exactly.
    const [stored] = [...env.server.reports.values()];
    const local = env.outbox.all()[0].images[0].prepared!;
    expect(createHash('sha256').update(stored.images[0]).digest('hex')).toBe(local.sha256);
    expect(env.server.count('GET', '/uploads/')).toBeGreaterThanOrEqual(5); // asked "how far did you get?" after each drop
    await env.engine.stop();
  });

  it('retries 503s and hung requests', async () => {
    const env = setup();
    await boot(env);
    env.server.faults = { errors: 3, hangs: 2 };
    await compose(env, 'transient', [500_000]);
    await until(() => delivered(env) === 1);
    expect(env.outbox.all()[0].attempts).toBeGreaterThanOrEqual(5);
    await env.engine.stop();
  });

  it('does not retry a refused upload; it waits for the user', async () => {
    const env = setup();
    await boot(env);
    env.server.faults = { refuse: true };
    await compose(env, 'refused', [500_000]);
    await until(() => env.outbox.all()[0].status === 'blocked');
    const patches = env.server.count('PATCH', '/uploads/');
    await new Promise<void>(r => setTimeout(r, 50));
    expect(env.server.count('PATCH', '/uploads/')).toBe(patches); // no further attempts
    expect(patches).toBe(1);

    // The user taps "Try again" after the server is fixed.
    env.server.faults = {};
    await env.engine.retryNow(env.outbox.all()[0].id);
    await until(() => delivered(env) === 1);
    await env.engine.stop();
  });

  it('a blocked report does not hold up the ones behind it', async () => {
    const env = setup();
    await boot(env);
    env.network.set(false);
    await compose(env, 'first', [500_000]);
    await compose(env, 'second', [500_000]);
    const [a] = env.outbox.all();
    await env.outbox.update(a.id, r => ({ ...r, status: 'blocked' }));
    env.network.set(true);
    await until(() => delivered(env) === 1);
    expect(env.outbox.get(a.id)!.status).toBe('blocked');
    await env.engine.stop();
  });

  it('waits for the network instead of burning attempts while offline', async () => {
    const env = setup();
    await boot(env);
    env.network.set(false);
    await compose(env, 'patient', [500_000]);
    await until(() => env.outbox.all()[0].images[0].prepared !== undefined);
    await new Promise<void>(r => setTimeout(r, 30));
    expect(env.outbox.all()[0].attempts).toBe(0);
    env.network.set(true);
    await until(() => delivered(env) === 1);
    await env.engine.stop();
  });
});

describe('images', () => {
  it('brings an 18 MB original under the ceiling and passes a small JPEG through untouched', async () => {
    const env = setup();
    await boot(env);
    env.network.set(false);
    const report = await compose(env, 'mixed', [18_000_000, 900_000]);
    await until(() => env.outbox.get(report.id)!.images.every(i => i.prepared));
    const [big, small] = env.outbox.get(report.id)!.images;
    expect(big.prepared!.bytes).toBeLessThanOrEqual(IMAGE_TARGET_BYTES);
    expect(small.prepared!.bytes).toBe(900_000); // unchanged: re-encoding would only lose quality
    await env.engine.stop();
  });
});

describe('composing', () => {
  it('enforces 1–5 photos and a non-blank description', () => {
    const img = { path: '/x', bytes: 1, width: 1, height: 1, mime: 'image/jpeg' };
    expect(validateDraft({ description: '   ', images: [img] })).toContain('description-blank');
    expect(validateDraft({ description: 'ok', images: [] })).toContain('no-images');
    expect(validateDraft({ description: 'ok', images: Array(6).fill(img) })).toContain('too-many-images');
    expect(validateDraft({ description: 'ok', images: Array(5).fill(img) })).toEqual([]);
  });

  it('never adds a sixth photo', async () => {
    const env = setup();
    await boot(env);
    for (let i = 0; i < 6; i++) env.fs.put(`/p/${i}.jpg`, 100);
    const pick = (i: number) => ({ path: `/p/${i}.jpg`, bytes: 100, width: 10, height: 10, mime: 'image/jpeg' });
    expect(await env.drafts.addImages([0, 1, 2, 3].map(pick))).toBe(4);
    expect(await env.drafts.addImages([4, 5].map(pick))).toBe(1);
    expect(env.drafts.get().images).toHaveLength(5);
    await env.engine.stop();
  });

  it('a crash between saving and clearing the draft cannot produce a duplicate', async () => {
    const env = setup();
    await boot(env);
    env.network.set(false);
    env.fs.put('/p/a.jpg', 100);
    await env.drafts.setDescription('once');
    await env.drafts.addImages([{ path: '/p/a.jpg', bytes: 100, width: 10, height: 10, mime: 'image/jpeg' }]);
    const draftFile = await env.fs.readText('/docs/draft.json');
    await env.drafts.submit(1);
    await env.engine.stop();

    // Simulate the crash: the draft file still holds the submitted draft on next launch.
    await env.fs.writeTextAtomic('/docs/draft.json', draftFile);
    const again = setup({ fs: env.fs, server: env.server });
    await again.outbox.load();
    await again.drafts.load();
    expect(again.drafts.get().images).toHaveLength(0);
    expect(again.outbox.all()).toHaveLength(1);
  });

  it('a crash after moving the photos but before recording the report loses nothing', async () => {
    const env = setup();
    await boot(env);
    env.network.set(false);
    env.fs.put('/p/a.jpg', 100);
    await env.drafts.setDescription('half saved');
    await env.drafts.addImages([{ path: '/p/a.jpg', bytes: 100, width: 10, height: 10, mime: 'image/jpeg' }]);
    const { id } = env.drafts.get();
    await env.engine.stop();

    // The first step of submit (the folder rename) happened; the outbox write did not.
    await env.fs.move(`/docs/draft/${id}`, `/docs/reports/${id}`);
    const again = setup({ fs: env.fs, server: env.server });
    await boot(again);
    expect(again.outbox.all()).toHaveLength(0);
    expect(again.drafts.get().images).toHaveLength(1);
    expect(await again.fs.exists(again.drafts.get().images[0].path)).toBe(true);
    await again.engine.stop();
  });
});
