// The shared championship server.
//
// It serves the app itself and holds the championships everybody shares. A
// championship put online gets a six-letter code; anyone who opens the address
// sees the list, picks one, and enters scores on their own phone. Nothing here
// has a login: the code is the way in, which is the right trade for a family
// championship and the wrong one for anything else.
//
// Data lives as one file per championship under DATA_DIR, on a disk that
// survives a restart. Small on purpose — the whole thing is meant to be
// deleted again when the championship is over.

import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeChampionships, makeCode, isCode } from './sync.mjs';
import { configure, generateKeys, sendToAll, isSubscription, dueMessages } from './push.mjs';

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || '/data';
const APP_DIR = fileURLToPath(new URL('.', import.meta.url));
const MAX_BODY = 2_000_000; // a championship is a few kB; this is a wide margin
const CHECK_DUE_EVERY = 60_000;
const CONTACT = process.env.PUSH_CONTACT || 'mailto:dad-championships@example.com';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/* ------------------------------- the store ------------------------------- */

const keyFile = () => join(DATA_DIR, 'vapid.json');

/**
 * The signing keys for push. Made once on first boot and kept on the disk, so
 * the phones that already subscribed stay subscribed across a restart — new
 * keys would silently invalidate every subscription out there.
 */
async function loadPushKeys() {
  try {
    const keys = JSON.parse(await readFile(keyFile(), 'utf8'));
    if (keys.publicKey && keys.privateKey) return keys;
  } catch {
    /* first boot */
  }
  const keys = generateKeys();
  await writeFile(keyFile(), JSON.stringify(keys));
  return keys;
}


const fileFor = (code) => join(DATA_DIR, `${code}.json`);
const binFor = (code) => join(DATA_DIR, `bin-${code}.json`);

async function readChampionship(code) {
  try {
    return JSON.parse(await readFile(fileFor(code), 'utf8'));
  } catch {
    return null;
  }
}

async function writeChampionship(code, champ) {
  // written beside and moved into place, so a restart mid-write cannot leave
  // half a championship behind
  const temp = `${fileFor(code)}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(champ));
  await writeFile(fileFor(code), JSON.stringify(champ));
  await unlink(temp).catch(() => {});
}

async function listChampionships() {
  const names = await readdir(DATA_DIR).catch(() => []);
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json') || name === 'vapid.json' || name.startsWith('bin-')) continue;
    const champ = await readChampionship(name.slice(0, -5));
    if (!champ) continue;
    out.push({
      code: champ.code,
      name: champ.name,
      players: (champ.players || []).length,
      sports: (champ.sports || []).length,
      played: (champ.matches || []).filter((m) => m.done).length,
      matches: (champ.matches || []).length,
      updatedAt: champ.updatedAt || null,
    });
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return out;
}

/**
 * What a phone is allowed to see. A push subscription is the right to make
 * somebody's phone buzz, so it stays on the server; handing the list out with
 * the championship would let anyone with the address notify the whole family.
 * `announced` is the server's own memory and is no business of the client's.
 */
function publicView(champ) {
  if (!champ) return champ;
  const { subscriptions, announced, ...rest } = champ;
  return rest;
}

/**
 * Fields the server owns. A phone sends its whole copy on every save, and its
 * copy has no subscriptions in it — without this, the first save of the day
 * would quietly unsubscribe everybody.
 */
function keepServerFields(next, held) {
  if (!held) return next;
  return { ...next, subscriptions: held.subscriptions || [], announced: held.announced || {} };
}

/* One write at a time per championship, so two phones saving at the same
   moment cannot read-modify-write over each other. */
const queues = new Map();
function inOrder(code, job) {
  const previous = queues.get(code) || Promise.resolve();
  const next = previous.then(job, job);
  queues.set(code, next.catch(() => {}));
  return next;
}

/* ------------------------------ telling people --------------------------- */

/** Send one message to everybody following a championship, and tidy up after. */
async function announce(code, champ, payload) {
  const { delivered, gone } = await sendToAll(champ.subscriptions || [], payload);
  if (gone.length) {
    await inOrder(code, async () => {
      const latest = await readChampionship(code);
      if (!latest) return;
      latest.subscriptions = (latest.subscriptions || []).filter((s) => !gone.includes(s.endpoint));
      await writeChampionship(code, latest);
    });
  }
  return { delivered, forgotten: gone.length, phones: (champ.subscriptions || []).length };
}

/**
 * Once a minute: has any sport's booked time arrived? A phone in a pocket is
 * not running anything, so this has to happen here rather than in the browser.
 * Each sport is announced once and the championship remembers that it was.
 */
export async function sendWhatIsDue(now = Date.now()) {
  const names = await readdir(DATA_DIR).catch(() => []);
  let sent = 0;
  for (const name of names) {
    if (!name.endsWith('.json') || name === 'vapid.json' || name.startsWith('bin-')) continue;
    const code = name.slice(0, -5);
    const champ = await readChampionship(code);
    if (!champ || !(champ.subscriptions || []).length) continue;

    for (const message of dueMessages(champ, now)) {
      await announce(code, champ, { title: message.title, body: message.body });
      sent += 1;
      await inOrder(code, async () => {
        const latest = await readChampionship(code);
        if (!latest) return;
        latest.announced = { ...(latest.announced || {}), [message.key]: new Date(now).toISOString() };
        await writeChampionship(code, latest);
      });
    }
  }
  return sent;
}

/* -------------------------------- serving -------------------------------- */

const json = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('too big'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('not json'));
      }
    });
    req.on('error', reject);
  });
}

async function serveFile(res, pathname) {
  // never let a path climb out of the app folder
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(APP_DIR, safe === '/' || safe === '' ? 'index.html' : safe);
  if (!file.startsWith(APP_DIR) || !existsSync(file)) {
    const fallback = join(APP_DIR, 'index.html');
    const html = await readFile(fallback);
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' });
    res.end(html);
    return;
  }
  const body = await readFile(file);
  const type = TYPES[extname(file)] || 'application/octet-stream';
  // the app updates itself, so it must never be served from a stale cache
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // api, champs, CODE
  const code = (parts[2] || '').toUpperCase();

  if (url.pathname === '/api/health') return json(res, 200, { ok: true });

  // the key a phone needs before it can subscribe
  if (url.pathname === '/api/push/key') return json(res, 200, { publicKey: pushKeys.publicKey });

  // a phone asking to be told things, or asking to stop
  if (url.pathname === '/api/push/subscribe' && req.method === 'POST') {
    const body = await readBody(req);
    const target = String(body.code || '').toUpperCase();
    if (!isCode(target)) return json(res, 400, { error: 'no such championship' });
    if (!isSubscription(body.subscription)) return json(res, 400, { error: 'not a subscription' });

    const ok = await inOrder(target, async () => {
      const champ = await readChampionship(target);
      if (!champ) return false;
      champ.subscriptions = (champ.subscriptions || []).filter(
        (sub) => sub.endpoint !== body.subscription.endpoint
      );
      champ.subscriptions.push(body.subscription);
      await writeChampionship(target, champ);
      return true;
    });
    return ok ? json(res, 200, { ok: true }) : json(res, 404, { error: 'no such championship' });
  }

  if (url.pathname === '/api/push/unsubscribe' && req.method === 'POST') {
    const body = await readBody(req);
    const target = String(body.code || '').toUpperCase();
    if (!isCode(target)) return json(res, 400, { error: 'no such championship' });
    await inOrder(target, async () => {
      const champ = await readChampionship(target);
      if (!champ) return;
      champ.subscriptions = (champ.subscriptions || []).filter((sub) => sub.endpoint !== body.endpoint);
      await writeChampionship(target, champ);
    });
    return json(res, 200, { ok: true });
  }

  // everybody can see what is being played, so they can pick one
  if (url.pathname === '/api/champs' && req.method === 'GET') {
    return json(res, 200, { championships: await listChampionships() });
  }

  // everything that has been deleted but not destroyed
  if (url.pathname === '/api/bin' && req.method === 'GET') {
    const names = await readdir(DATA_DIR).catch(() => []);
    const binned = [];
    for (const name of names) {
      if (!name.startsWith('bin-') || !name.endsWith('.json')) continue;
      try {
        const champ = JSON.parse(await readFile(join(DATA_DIR, name), 'utf8'));
        binned.push({
          code: champ.code,
          name: champ.name,
          players: (champ.players || []).length,
          played: (champ.matches || []).filter((m) => m.done).length,
          matches: (champ.matches || []).length,
          binnedAt: champ.binnedAt || null,
        });
      } catch {
        /* skip anything unreadable */
      }
    }
    binned.sort((a, b) => String(b.binnedAt).localeCompare(String(a.binnedAt)));
    return json(res, 200, { binned });
  }

  // put a championship online and get its code
  if (url.pathname === '/api/champs' && req.method === 'POST') {
    const body = await readBody(req);
    const champ = body.championship;
    if (!champ || !Array.isArray(champ.players)) return json(res, 400, { error: 'no championship' });

    let fresh = makeCode();
    for (let i = 0; i < 12 && existsSync(fileFor(fresh)); i++) fresh = makeCode();
    champ.code = fresh;
    champ.updatedAt = champ.updatedAt || new Date().toISOString();
    champ.subscriptions = [];
    champ.announced = {};
    await inOrder(fresh, () => writeChampionship(fresh, champ));
    return json(res, 200, { code: fresh, championship: publicView(champ) });
  }

  if (!isCode(code)) return json(res, 404, { error: 'no such championship' });

  if (req.method === 'GET') {
    const champ = await readChampionship(code);
    if (!champ) return json(res, 404, { error: 'no such championship' });
    return json(res, 200, { championship: publicView(champ) });
  }

  // a phone sends its whole copy; the two are merged rather than overwritten
  if (req.method === 'PUT') {
    const body = await readBody(req);
    if (!body.championship) return json(res, 400, { error: 'no championship' });
    const merged = await inOrder(code, async () => {
      const held = await readChampionship(code);
      if (!held) return null;
      const next = keepServerFields(mergeChampionships(body.championship, held), held);
      next.code = code;
      await writeChampionship(code, next);
      return next;
    });
    if (!merged) return json(res, 404, { error: 'no such championship' });
    return json(res, 200, { championship: publicView(merged) });
  }

  // somebody in the championship telling the others to get moving
  if (url.pathname === `/api/champs/${code}/notify` && req.method === 'POST') {
    const body = await readBody(req);
    const champ = await readChampionship(code);
    if (!champ) return json(res, 404, { error: 'no such championship' });
    const title = String(body.title || champ.name).slice(0, 80);
    const message = String(body.body || '').slice(0, 200);
    if (!message) return json(res, 400, { error: 'nothing to say' });

    const result = await announce(code, champ, { title, body: message });
    return json(res, 200, result);
  }

  // A championship is never destroyed, only put in the bin. Somebody deletes
  // the wrong one, or a tidy-up goes too wide, and a whole day of scores is
  // gone with no way back — this makes that survivable.
  if (req.method === 'DELETE') {
    const moved = await inOrder(code, async () => {
      const champ = await readChampionship(code);
      if (!champ) return false;
      champ.binnedAt = new Date().toISOString();
      await writeFile(binFor(code), JSON.stringify(champ));
      await unlink(fileFor(code)).catch(() => {});
      return true;
    });
    return json(res, 200, { ok: true, binned: moved });
  }

  // and taken back out again
  if (url.pathname === `/api/champs/${code}/restore` && req.method === 'POST') {
    const back = await inOrder(code, async () => {
      try {
        const champ = JSON.parse(await readFile(binFor(code), 'utf8'));
        delete champ.binnedAt;
        await writeChampionship(code, champ);
        await unlink(binFor(code)).catch(() => {});
        return champ;
      } catch {
        return null;
      }
    });
    if (!back) return json(res, 404, { error: 'not in the bin' });
    return json(res, 200, { championship: publicView(back) });
  }

  return json(res, 405, { error: 'not allowed' });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    await serveFile(res, url.pathname);
  } catch (error) {
    json(res, 500, { error: String((error && error.message) || error) });
  }
});

await mkdir(DATA_DIR, { recursive: true }).catch(() => {});
const pushKeys = await loadPushKeys();
configure({ ...pushKeys, contact: CONTACT });

setInterval(() => {
  sendWhatIsDue().catch((error) => console.error('due check failed:', error.message));
}, CHECK_DUE_EVERY).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dad Championships listening on ${PORT}, data in ${DATA_DIR}`);
});
