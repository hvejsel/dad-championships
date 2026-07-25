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

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || '/data';
const APP_DIR = fileURLToPath(new URL('.', import.meta.url));
const MAX_BODY = 2_000_000; // a championship is a few kB; this is a wide margin

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

const fileFor = (code) => join(DATA_DIR, `${code}.json`);

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
    if (!name.endsWith('.json')) continue;
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

/* One write at a time per championship, so two phones saving at the same
   moment cannot read-modify-write over each other. */
const queues = new Map();
function inOrder(code, job) {
  const previous = queues.get(code) || Promise.resolve();
  const next = previous.then(job, job);
  queues.set(code, next.catch(() => {}));
  return next;
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

  // everybody can see what is being played, so they can pick one
  if (url.pathname === '/api/champs' && req.method === 'GET') {
    return json(res, 200, { championships: await listChampionships() });
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
    await inOrder(fresh, () => writeChampionship(fresh, champ));
    return json(res, 200, { code: fresh, championship: champ });
  }

  if (!isCode(code)) return json(res, 404, { error: 'no such championship' });

  if (req.method === 'GET') {
    const champ = await readChampionship(code);
    if (!champ) return json(res, 404, { error: 'no such championship' });
    return json(res, 200, { championship: champ });
  }

  // a phone sends its whole copy; the two are merged rather than overwritten
  if (req.method === 'PUT') {
    const body = await readBody(req);
    if (!body.championship) return json(res, 400, { error: 'no championship' });
    const merged = await inOrder(code, async () => {
      const held = await readChampionship(code);
      if (!held) return null;
      const next = mergeChampionships(body.championship, held);
      next.code = code;
      await writeChampionship(code, next);
      return next;
    });
    if (!merged) return json(res, 404, { error: 'no such championship' });
    return json(res, 200, { championship: merged });
  }

  if (req.method === 'DELETE') {
    await inOrder(code, () => unlink(fileFor(code)).catch(() => {}));
    return json(res, 200, { ok: true });
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
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dad Championships listening on ${PORT}, data in ${DATA_DIR}`);
});
