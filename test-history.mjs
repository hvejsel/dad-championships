// Older copies are kept, and anything deleted can be brought back.
//
//   rm -rf /tmp/champdata && DATA_DIR=/tmp/champdata PORT=8788 node server.mjs
//   node test-history.mjs
let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + x)); };
const BASE = process.env.BASE || 'http://localhost:8788';

const champ = (name, scores) => ({
  id: 'c' + Math.random().toString(36).slice(2), name,
  players: [{ id: 'p1', name: 'Jesper' }, { id: 'p2', name: 'Far' }],
  sports: [{ id: 's1', name: 'Padel', order: 0 }],
  matches: scores.map((sc, i) => ({
    id: 'm' + (i + 1), sportId: 's1',
    sides: [{ players: ['p1'], score: sc }, { players: ['p2'], score: sc === null ? null : 0 }],
    done: sc !== null, updatedAt: new Date(Date.now() + i).toISOString(),
  })),
  standIns: [], removed: {}, nextMatchNo: scores.length,
  updatedAt: new Date().toISOString(), metaAt: new Date().toISOString(),
});
const jsonOf = async (r) => (r.ok ? r.json() : null);
const post = async (p, b) => jsonOf(await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }));
const put = async (p, b) => jsonOf(await fetch(BASE + p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }));
const get = async (p) => { const r = await fetch(BASE + p, { cache: 'no-store' }); return { status: r.status, body: await jsonOf(r) }; };

console.log('--- older copies are kept as play goes on ---');
const created = await post('/api/champs', { championship: champ('History Cup', [11, null]) });
const code = created.code;
check('it is online', (await get(`/api/champs/${code}`)).status === 200);

// a second result comes in
const two = champ('History Cup', [11, 9]);
two.id = created.championship.id;
await put(`/api/champs/${code}`, { championship: two });

const hist = (await get(`/api/champs/${code}/history`)).body.versions;
check('an older copy was kept', hist.length >= 1, JSON.stringify(hist));
check('with a time on it', hist[0] && Boolean(Date.parse(hist[0].at)), JSON.stringify(hist[0]));
check('and it remembers how far that copy had got', hist[0].played === 1, String(hist[0] && hist[0].played));

const now = (await get(`/api/champs/${code}`)).body.championship;
check('while the live one has both results', now.matches.filter((m) => m.done).length === 2);

console.log('\n--- an older copy can be put back ---');
const back = await post(`/api/champs/${code}/history`, { at: hist[0].at });
check('restoring an older copy works', Boolean(back && back.championship), JSON.stringify(back));
const after = (await get(`/api/champs/${code}`)).body.championship;
check('and the live one is that copy again', after.matches.filter((m) => m.done).length === 1,
  String(after.matches.filter((m) => m.done).length));
check('asking for a copy that never existed is refused',
  (await fetch(`${BASE}/api/champs/${code}/history`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ at: '2001-01-01T00:00:00.000Z' }) })).status === 404);

console.log('\n--- the history never shows up as a championship ---');
const live = (await get('/api/champs')).body.championships;
check('only real championships are listed', live.every((c) => c.code && c.name), JSON.stringify(live));
check('and there is exactly the one', live.filter((c) => c.code === code).length === 1);

console.log('\n--- deleted still means recoverable ---');
await fetch(`${BASE}/api/champs/${code}`, { method: 'DELETE' });
check('it is in the bin', (await get('/api/bin')).body.binned.some((b) => b.code === code));
const restored = await post(`/api/champs/${code}/restore`);
check('and comes back whole', restored.championship.name === 'History Cup');

await fetch(`${BASE}/api/champs/${code}`, { method: 'DELETE' });
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
