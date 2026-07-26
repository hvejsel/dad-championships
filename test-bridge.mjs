// Sharing has to work from the address the app is actually on. The app is
// served from two places and only one has a server; the other now talks to it,
// so there is one shared list wherever you opened the app from.
//
//   DATA_DIR=/tmp/champdata PORT=8788 node server.mjs      (the one with a server)
//   python3 -m http.server 8799                            (the plain one)
//   node test-bridge.mjs
import { webkit, devices } from 'playwright';

const PLAIN  = process.env.OFFLINE || 'http://localhost:8799/'; // no server of its own
const SHARED = process.env.SHARED  || 'http://localhost:8788/'; // has one

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + x)); };

const b = await webkit.launch();
const ctx = await b.newContext({ ...devices['iPhone 14'] });
// this test runs its own shared server; point the plain copy at that one
await ctx.addInitScript((shared) => { window.__SHARED_APP = shared; }, SHARED);
const p = await ctx.newPage();
p.on('pageerror', (e) => { fail++; console.log('  PAGEERROR ' + e.message); });

const tap = async (s) => {
  const l = p.locator(s).first();
  await l.scrollIntoViewIfNeeded();
  const bb = await l.boundingBox();
  await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await p.waitForTimeout(340);
};
const champOf = () => p.evaluate(() => {
  const lib = JSON.parse(localStorage.getItem('dadchamps.library.v1') || 'null');
  return lib ? lib.championships.find((c) => c.id === lib.currentId) : null;
});

console.log('--- the app on the plain address, exactly as it sits on a phone ---');
await p.goto(PLAIN);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForTimeout(1200);
await p.fill('#champ-name-input', 'Hvejsel Cup');
for (const [i, n] of [[0,'Jesper'],[1,'Far'],[2,'Villads'],[3,'Thomas']]) {
  await p.locator(`input[data-kind="player"][data-index="${i}"]`).fill(n);
}
await tap('[data-goto="2"]');
await tap('#btn-create');
await p.waitForTimeout(800);

await tap('.sport-link');
await tap('.fixture');
await p.locator('#match-body input[type=number]').nth(0).fill('11');
await p.locator('#match-body input[type=number]').nth(1).fill('4');
await tap('#match-save');
await p.waitForTimeout(600);
await tap('#btn-back');

console.log('\n--- sharing is offered here, without moving anything ---');
await tap('#btn-menu');
check('the share entry is there on the plain address too',
  !(await p.evaluate(() => document.querySelector('#menu-online').hidden)));

await tap('#menu-online');
await p.waitForTimeout(1200);
check('the shared list loads across from the other address',
  await p.evaluate(() => document.querySelector('#online-list').textContent.length > 0));

await tap('#online-put');
await p.waitForTimeout(1500);
const mine = await champOf();
check('it goes online straight from here', /^[ACDEFGHJKLMNPQRTUVWXYZ234679]{6}$/.test(mine.code || ''), String(mine.code));

const onServer = await fetch(`${SHARED}api/champs/${mine.code}`).then((r) => r.json());
check('the shared server really has it', onServer.championship.name === 'Hvejsel Cup');
check('with the result already entered', onServer.championship.matches.filter((m) => m.done).length === 1);

console.log('\n--- and a score entered here lands there ---');
await tap('#online-close');
await tap('.sport-link');
const open = p.locator('.fixture:not(.played)').first();
await open.scrollIntoViewIfNeeded();
const box = await open.boundingBox();
await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
await p.waitForTimeout(500);
await p.locator('#match-body input[type=number]').nth(0).fill('7');
await p.locator('#match-body input[type=number]').nth(1).fill('9');
await tap('#match-save');
await p.waitForTimeout(6000);

const after = await fetch(`${SHARED}api/champs/${mine.code}`, { cache: 'no-store' }).then((r) => r.json());
check('the second result reached the shared server',
  after.championship.matches.filter((m) => m.done).length === 2,
  `${after.championship.matches.filter((m) => m.done).length} of 2`);

console.log('\n--- somebody else, on the other address, sees the same championship ---');
const other = await b.newContext({ ...devices['iPhone 14'] });
await other.addInitScript((shared) => { window.__SHARED_APP = shared; }, SHARED);
const q = await other.newPage();
await q.goto(SHARED);
await q.evaluate(() => localStorage.clear());
await q.reload();
await q.waitForTimeout(1200);
const list = await q.evaluate(async () => (await (await fetch('api/champs', { cache: 'no-store' })).json()).championships);
check('it is on the list everybody sees', list.some((c) => c.code === mine.code), JSON.stringify(list.map((c) => c.name)));

await fetch(`${SHARED}api/champs/${mine.code}`, { method: 'DELETE' });
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
if (fail) process.exit(1);
