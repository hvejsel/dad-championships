// Deleting a championship must be survivable — mine, or anybody's.
//
//   rm -rf /tmp/champdata && DATA_DIR=/tmp/champdata PORT=8788 node server.mjs
//   node test-bin.mjs
let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + x)); };
const BASE = process.env.BASE || 'http://localhost:8788';

const champ = (name) => ({
  id: 'c' + Math.random().toString(36).slice(2), name,
  players: [{ id: 'p1', name: 'Jesper' }, { id: 'p2', name: 'Far' }],
  sports: [{ id: 's1', name: 'Padel', order: 0 }],
  matches: [{ id: 'm1', sportId: 's1', sides: [{ players: ['p1'], score: 11 }, { players: ['p2'], score: 4 }], done: true, updatedAt: new Date().toISOString() }],
  standIns: [], removed: {}, nextMatchNo: 1,
  updatedAt: new Date().toISOString(), metaAt: new Date().toISOString(),
});

const post = async (path, body) => (await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })).json();
const get = async (path) => { const r = await fetch(BASE + path, { cache: 'no-store' }); return { status: r.status, body: r.ok ? await r.json() : null }; };

console.log('--- a deleted championship goes to the bin, not away ---');
const { code } = await post('/api/champs', { championship: champ('Hvejsel Cup') });
check('it is online', (await get(`/api/champs/${code}`)).status === 200);

await fetch(`${BASE}/api/champs/${code}`, { method: 'DELETE' });
check('after deleting it is off the list', (await get(`/api/champs/${code}`)).status === 404);
const bin = (await get('/api/bin')).body.binned;
check('but it is in the bin', bin.some((b) => b.code === code), JSON.stringify(bin.map((b) => b.code)));
const entry = bin.find((b) => b.code === code);
check('with its name', entry.name === 'Hvejsel Cup');
check('and its results still counted', entry.played === 1, String(entry.played));
check('and when it was binned', Boolean(entry.binnedAt));

console.log('\n--- and it can be brought back, whole ---');
const back = await post(`/api/champs/${code}/restore`);
check('restoring returns it', back.championship && back.championship.name === 'Hvejsel Cup');
check('with every result', back.championship.matches.filter((m) => m.done).length === 1);
check('it is on the list again', (await get(`/api/champs/${code}`)).status === 200);
check('and no longer in the bin', !(await get('/api/bin')).body.binned.some((b) => b.code === code));

console.log('\n--- the bin never masquerades as a live championship ---');
await fetch(`${BASE}/api/champs/${code}`, { method: 'DELETE' });
const live = (await get('/api/champs')).body.championships;
check('a binned one is not on the public list', !live.some((c) => c.code === code));
check('and the bin does not show up as a nameless entry', live.every((c) => c.code && c.name), JSON.stringify(live));
check('restoring something never binned is refused', (await fetch(`${BASE}/api/champs/ZZZZZZ/restore`, { method: 'POST' })).status === 404);

// tidy up after ourselves, by code, never by "everything on the list"
await fetch(`${BASE}/api/champs/${code}/restore`, { method: 'POST' });
await fetch(`${BASE}/api/champs/${code}`, { method: 'DELETE' });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
