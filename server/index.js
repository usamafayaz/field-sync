#!/usr/bin/env node
/* FieldSync test backend: resumable uploads, idempotent commit, fault injection (see /admin). */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT || 4000);
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOADS = path.join(DATA, 'uploads');
const REPORTS = path.join(DATA, 'reports');
const MAX_IMAGE_BYTES = 5_000_000; // the ceiling from the brief, decimal MB (the stricter reading)
const MAX_IMAGES = 5;
const ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

/** @type {Record<string, number>} */
const faults = {
  latencyMs: 0, // added before every API request is handled
  bandwidthBps: 0, // 0 = unthrottled. ~5000 is honest 2G.
  dropRate: 0, // chance the socket is destroyed mid-request
  errorRate: 0, // chance of a 503 (transient, client should retry)
  hangRate: 0, // chance the request is accepted and never answered
  rejectRate: 0, // chance an upload is refused with 400 (permanent, client must NOT retry)
  loseResponseRate: 0, // chance a commit succeeds but its response is dropped
};

const PRESETS = {
  healthy: {},
  '2g': { latencyMs: 800, bandwidthBps: 6000 },
  // Unreliable but not slow (slow is 2G's job), so a full report still lands in a minute or two.
  flaky: { latencyMs: 200, bandwidthBps: 300000, dropRate: 0.2, errorRate: 0.1, loseResponseRate: 0.3 },
  // For recording: throttled, a few drops, and every report loses its reply once.
  demo: { bandwidthBps: 800000, dropRate: 0.15, loseResponseRate: 1 },
  down: { errorRate: 1 },
  'black-hole': { hangRate: 1 },
  refuse: { rejectRate: 1 },
};

const log = (...args) => console.log(new Date().toISOString().slice(11, 23), ...args);
const roll = p => p > 0 && Math.random() < p;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function send(res, status, body, headers = {}) {
  if (res.destroyed || res.headersSent) return;
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(payload);
}

const uploadPath = (rid, idx) => path.join(UPLOADS, rid, `${idx}.part`);
const reportDir = rid => path.join(REPORTS, rid);

async function sizeOf(file) {
  try {
    return (await fsp.stat(file)).size;
  } catch {
    return 0;
  }
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', d => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

async function readJson(req, limit = 64 * 1024) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw Object.assign(new Error('body too large'), { status: 413 });
  }
  try {
    return JSON.parse(raw || '{}');
  } catch {
    throw Object.assign(new Error('invalid json'), { status: 400 });
  }
}

/* ---------------------------------------------------------------- uploads */

// Per-file lock so a retry and an old request never mix their appends.
const locks = new Map();
async function withLock(key, fn) {
  while (locks.has(key)) await locks.get(key);
  let release;
  locks.set(key, new Promise(r => (release = r)));
  try {
    return await fn();
  } finally {
    locks.delete(key);
    release();
  }
}

async function headUpload(req, res, rid, idx) {
  if (fs.existsSync(path.join(reportDir(rid), 'report.json'))) {
    return send(res, 200, { offset: -1, committed: true });
  }
  const offset = await sizeOf(uploadPath(rid, idx));
  send(res, 200, { offset }, { 'Upload-Offset': String(offset) });
}

async function patchUpload(req, res, rid, idx) {
  const offset = Number(req.headers['upload-offset']);
  const length = Number(req.headers['upload-length']);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length <= 0) {
    req.resume();
    return send(res, 400, { error: 'Upload-Offset and Upload-Length headers are required' });
  }
  if (length > MAX_IMAGE_BYTES) {
    req.resume();
    return send(res, 413, { error: `image is ${length} bytes; the limit is ${MAX_IMAGE_BYTES}` });
  }
  if (fs.existsSync(path.join(reportDir(rid), 'report.json'))) {
    req.resume();
    return send(res, 200, { offset: length, committed: true });
  }

  await withLock(`${rid}/${idx}`, async () => {
    const file = uploadPath(rid, idx);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const current = await sizeOf(file);
    if (offset !== current) {
      req.resume();
      return send(res, 409, { error: 'offset mismatch', offset: current }, { 'Upload-Offset': String(current) });
    }

    const willDrop = roll(faults.dropRate);
    const dropAt = willDrop ? Math.floor(Math.random() * Number(req.headers['content-length'] || 1)) : -1;
    const out = fs.createWriteStream(file, { flags: 'a' });
    let written = current;
    let received = 0;
    let tooBig = false;

    await new Promise(resolve => {
      const finish = () => out.end(resolve);
      req.on('data', chunk => {
        if (tooBig) return;
        if (written + chunk.length > length || written + chunk.length > MAX_IMAGE_BYTES) {
          tooBig = true;
          return;
        }
        out.write(chunk);
        written += chunk.length;
        received += chunk.length;
        if (faults.bandwidthBps > 0) {
          req.pause();
          setTimeout(() => req.resume(), (chunk.length / faults.bandwidthBps) * 1000);
        }
        if (willDrop && received >= dropAt) {
          log(`  ✂ dropping connection mid-upload ${rid}/${idx} after ${received}B`);
          req.socket.destroy();
        }
      });
      req.on('end', finish);
      req.on('close', finish); // client vanished: keep whatever arrived
      req.on('error', finish);
    });

    if (tooBig) return send(res, 413, { error: 'body exceeds declared Upload-Length' });
    if (res.destroyed) return;
    const offsetNow = await sizeOf(file);
    send(res, 200, { offset: offsetNow }, { 'Upload-Offset': String(offsetNow) });
  });
}

/* ---------------------------------------------------------------- reports */

async function commitReport(req, res, rid) {
  const body = await readJson(req);
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const images = Array.isArray(body.images) ? body.images : [];
  if (!description) return send(res, 422, { error: 'description is required' });
  if (images.length < 1 || images.length > MAX_IMAGES) {
    return send(res, 422, { error: `a report needs 1–${MAX_IMAGES} images, got ${images.length}` });
  }

  const dir = reportDir(rid);
  const existing = path.join(dir, 'report.json');
  if (fs.existsSync(existing)) {
    // Replay after a lost response. Same id means same report: say yes again.
    log(`  ↺ commit replay for ${rid} — already stored, returning 200`);
    return send(res, 200, JSON.parse(await fsp.readFile(existing, 'utf8')));
  }

  return withLock(`commit/${rid}`, async () => {
    if (fs.existsSync(existing)) return send(res, 200, JSON.parse(await fsp.readFile(existing, 'utf8')));

    const missing = [];
    const corrupt = [];
    for (let i = 0; i < images.length; i++) {
      const file = uploadPath(rid, i);
      const size = await sizeOf(file);
      if (size !== images[i].size) {
        missing.push({ index: i, offset: size });
        continue;
      }
      if ((await sha256(file)) !== images[i].sha256) {
        corrupt.push(i);
        await fsp.rm(file, { force: true }); // make the client start that one over
      }
    }
    if (missing.length || corrupt.length) {
      return send(res, 409, { error: 'images incomplete', missing, corrupt });
    }

    // Assemble in a temp dir, then one rename: a report is either fully there or not at all.
    const tmp = path.join(REPORTS, `.${rid}.${process.pid}.tmp`);
    await fsp.rm(tmp, { recursive: true, force: true });
    await fsp.mkdir(tmp, { recursive: true });
    const stored = [];
    for (let i = 0; i < images.length; i++) {
      await fsp.copyFile(uploadPath(rid, i), path.join(tmp, `${i}.jpg`));
      stored.push({
        index: i,
        size: images[i].size,
        sha256: images[i].sha256,
        width: images[i].width ?? null,
        height: images[i].height ?? null,
      });
    }
    const record = {
      id: rid,
      description,
      createdAt: body.createdAt ?? null,
      receivedAt: new Date().toISOString(),
      images: stored,
    };
    await fsp.writeFile(path.join(tmp, 'report.json'), JSON.stringify(record, null, 2));
    await fsp.rename(tmp, dir);
    await fsp.rm(path.join(UPLOADS, rid), { recursive: true, force: true });
    log(`  ✔ committed ${rid} (${images.length} images, ${stored.reduce((a, b) => a + b.size, 0)}B)`);

    if (roll(faults.loseResponseRate)) {
      log(`  ✂ losing the response for committed ${rid}`);
      return req.socket.destroy();
    }
    send(res, 201, record);
  });
}

async function listReports(req, res) {
  await fsp.mkdir(REPORTS, { recursive: true });
  const entries = await fsp.readdir(REPORTS);
  const reports = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    try {
      reports.push(JSON.parse(await fsp.readFile(path.join(REPORTS, name, 'report.json'), 'utf8')));
    } catch {
      /* half-written dirs cannot exist (rename), but never let one break the list */
    }
  }
  reports.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  send(res, 200, { reports, serverTime: new Date().toISOString() });
}

function serveImage(req, res, rid, idx) {
  const file = path.join(reportDir(rid), `${idx}.jpg`);
  fs.stat(file, (err, st) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': st.size, 'Cache-Control': 'max-age=31536000, immutable' });
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------------------------------------------------------------- admin */

function adminPage(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(__dirname, 'admin.html')));
}

// The admin page uses the app's own fonts, so it looks the same with no internet.
const FONTS = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'fonts');
function serveFont(res, name) {
  if (!/^IBMPlex[A-Za-z]+_\d{3}[A-Za-z]+\.ttf$/.test(name)) return send(res, 404, { error: 'not found' });
  fs.readFile(path.join(FONTS, name), (err, data) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'font/ttf', 'Cache-Control': 'max-age=86400' });
    res.end(data);
  });
}

/** The preset the current faults match exactly, or null when they've been customised. */
function currentMode() {
  const zero = Object.fromEntries(Object.keys(faults).map(k => [k, 0]));
  for (const [name, preset] of Object.entries(PRESETS)) {
    const expected = { ...zero, ...preset };
    if (Object.keys(faults).every(k => faults[k] === expected[k])) return name;
  }
  return null;
}

async function handleAdmin(req, res, url) {
  if (url.pathname === '/admin' && req.method === 'GET') return adminPage(res);
  if (url.pathname.startsWith('/admin/fonts/') && req.method === 'GET') return serveFont(res, url.pathname.slice(13));
  if (url.pathname === '/admin/faults' && req.method === 'GET') return send(res, 200, { faults, presets: Object.keys(PRESETS) });
  if (url.pathname === '/admin/faults' && req.method === 'POST') {
    const body = await readJson(req);
    if (body.preset) {
      if (!PRESETS[body.preset]) return send(res, 400, { error: 'unknown preset' });
      for (const k of Object.keys(faults)) faults[k] = 0;
      Object.assign(faults, PRESETS[body.preset]);
    }
    for (const k of Object.keys(faults)) if (typeof body[k] === 'number') faults[k] = body[k];
    log('⚙ faults now', JSON.stringify(faults));
    return send(res, 200, { faults });
  }
  if (url.pathname === '/admin/wipe' && req.method === 'POST') {
    await fsp.rm(DATA, { recursive: true, force: true });
    await fsp.mkdir(UPLOADS, { recursive: true });
    await fsp.mkdir(REPORTS, { recursive: true });
    log('🧹 wiped all server data');
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/admin/state' && req.method === 'GET') {
    const partial = fs.existsSync(UPLOADS) ? (await fsp.readdir(UPLOADS)).filter(n => !n.startsWith('.')) : [];
    const committed = fs.existsSync(REPORTS) ? (await fsp.readdir(REPORTS)).filter(n => !n.startsWith('.')) : [];
    return send(res, 200, { faults, mode: currentMode(), partialUploads: partial.length, committedReports: committed.length });
  }
  send(res, 404, { error: 'not found' });
}

/* ---------------------------------------------------------------- router */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const started = Date.now();
  // The admin page polls /admin/state every 2 s; logging it would bury the upload lines.
  if (url.pathname !== '/admin/state') {
    res.on('finish', () => log(`${req.method} ${url.pathname} → ${res.statusCode} ${Date.now() - started}ms`));
  }

  try {
    if (url.pathname.startsWith('/admin')) return await handleAdmin(req, res, url);
    if (url.pathname === '/health') return send(res, 200, { ok: true });

    if (url.pathname.startsWith('/api/')) {
      if (faults.latencyMs) await sleep(faults.latencyMs);
      if (roll(faults.hangRate)) {
        log(`  ⏳ hanging ${req.method} ${url.pathname} forever`);
        req.resume();
        return; // never answer; the client's timeout must save it
      }
      if (roll(faults.errorRate)) {
        req.resume();
        return send(res, 503, { error: 'injected: service unavailable' });
      }
    }

    const parts = url.pathname.split('/').filter(Boolean); // api, uploads, rid, idx
    if (parts[0] === 'api' && parts[1] === 'uploads' && parts.length >= 3) {
      const [, , rid, idxRaw] = parts;
      if (!ID_RE.test(rid)) return send(res, 400, { error: 'bad report id' });
      if (req.method === 'DELETE' && parts.length === 3) {
        await fsp.rm(path.join(UPLOADS, rid), { recursive: true, force: true });
        return send(res, 200, { ok: true });
      }
      const idx = Number(idxRaw);
      if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_IMAGES) return send(res, 400, { error: 'bad image index' });
      if (req.method === 'HEAD' || req.method === 'GET') return await headUpload(req, res, rid, idx);
      if (req.method === 'PATCH') {
        if (roll(faults.rejectRate)) {
          req.resume();
          return send(res, 400, { error: 'injected: upload refused' });
        }
        return await patchUpload(req, res, rid, idx);
      }
    }
    if (parts[0] === 'api' && parts[1] === 'reports') {
      if (parts.length === 2 && req.method === 'GET') return await listReports(req, res);
      const rid = parts[2];
      if (!ID_RE.test(rid)) return send(res, 400, { error: 'bad report id' });
      if (parts.length === 3 && req.method === 'PUT') return await commitReport(req, res, rid);
      if (parts.length === 5 && parts[3] === 'images' && req.method === 'GET') return serveImage(req, res, rid, Number(parts[4]));
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    log('✗', err.message);
    send(res, err.status || 500, { error: err.message });
  }
});

// Longer than any sane 2G chunk, shorter than forever.
server.requestTimeout = 10 * 60 * 1000;

fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(REPORTS, { recursive: true });
server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal);
  log(`FieldSync server on :${PORT}`);
  log(`  emulator:  http://10.0.2.2:${PORT}`);
  if (lan) log(`  device:    http://${lan.address}:${PORT}`);
  log(`  controls:  http://localhost:${PORT}/admin`);
  log(`  data:      ${DATA}`);
});
