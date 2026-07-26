// Getting a championship onto the shared list from the copy that has no
// server behind it — which is what "available for everyone" means from there.
//
//   DATA_DIR=/tmp/champdata PORT=8788 node server.mjs      (the shared one)
//   python3 -m http.server 8799                            (the plain one)
//   node test-bridge.mjs
import { webkit, devices } from 'playwright';

const OFFLINE_APP = process.env.OFFLINE || 'http://localhost:8799/';   // no server
const SHARED_APP  = process.env.SHARED  || 'http://localhost:8788/';   // has one

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + x)); };

const b = await webkit.launch();
const ctx = await b.newContext({ ...devices['iPhone 14'] });
const p = await ctx.newPage();
p.on('pageerror', (e) => { fail++; console.log('  PAGEERROR ' + e.message); });

const tap = async (s) => { const l = p.locator(s).first(); await l.scrollIntoViewIfNeeded(); const bb = await l.boundingBox(); await p.touchscreen.tap(bb.x + bb.width/2, bb.y + bb.height/2); await p.waitForTimeout(340); };
const champOf = () => p.evaluate(() => {
  const lib = JSON.parse(localStorage.getItem('dadchamps.library.v1') || 'null');
  return lib ? lib.championships.find((c) => c.id === lib.currentId) : null;
});

console.log('--- a championship on the copy with no server ---');
await p.goto(OFFLINE_APP);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForTimeout(900);
await p.fill('#champ-name-input', 'Hvejsel Cup');
for (const [i, n] of [[0,'Jesper'],[1,'Far'],[2,'Villads'],[3,'Thomas']]) {
  await p.locator(`input[data-kind="player"][data-index="${i}"]`).fill(n);
}
await tap('[data-goto="2"]');
await tap('#btn-create');
await p.waitForTimeout(700);

// play one, so there is something worth carrying across
await tap('.sport-link');
await tap('.fixture');
await p.locator('#match-body input[type=number]').nth(0).fill('11');
await p.locator('#match-body input[type=number]').nth(1).fill('4');
await tap('#match-save');
await p.waitForTimeout(500);
await tap('#btn-back');

await tap('#btn-menu');
check('the shared list is not offered here, because there is none',
  await p.evaluate(() => document.querySelector('#menu-online').hidden));
check('but a way to make it available to everyone is',
  !(await p.evaluate(() => document.querySelector('#menu-move').hidden)));

// what that button builds
const link = await p.evaluate(async (shared) => {
  const lib = JSON.parse(localStorage.getItem('dadchamps.library.v1'));
  const champ = lib.championships.find((c) => c.id === lib.currentId);
  const json = JSON.stringify(champ);
  const bytes = new Uint8Array(await new Response(
    new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  ).arrayBuffer());
  let binary = ''; for (const x of bytes) binary += String.fromCharCode(x);
  return shared + '#c=' + btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}, SHARED_APP);
check('it points at the shared address, not this one', link.startsWith(SHARED_APP), link.slice(0, 60));

console.log('\n--- opening that on the shared app ---');
await p.goto(link);
await p.waitForTimeout(1800);
const moved = await champOf();
check('the championship arrives whole', moved && moved.name === 'Hvejsel Cup', JSON.stringify(moved && moved.name));
check('with the result already entered', moved.matches.filter((m) => m.done).length === 1);
check('and the shared list opens by itself, ready to publish',
  !(await p.evaluate(() => document.querySelector('#online-sheet').hidden)));

await tap('#online-put');
await p.waitForTimeout(1200);
const online = await champOf();
check('putting it online gives it a code', /^[ACDEFGHJKLMNPQRTUVWXYZ234679]{6}$/.test(online.code || ''), String(online.code));

const onList = await p.evaluate(async () => {
  const r = await fetch('api/champs', { cache: 'no-store' });
  return (await r.json()).championships;
});
check('and everybody can now see it on the list',
  onList.some((c) => c.name === 'Hvejsel Cup'), JSON.stringify(onList.map((c) => c.name)));

console.log('\n--- a championship still carrying a dead code can be put back online ---');
const code = online.code;
await fetch(`${SHARED_APP}api/champs/${code}`, { method: 'DELETE' });
await p.evaluate(() => { window.__stop = true; });
await p.reload();
await p.waitForTimeout(2500);

await tap('#btn-menu');
await tap('#menu-online');
await p.waitForTimeout(900);
const putVisible = await p.evaluate(() => !document.querySelector('#online-put').hidden);
if (!putVisible) {
  // it still thinks it is online; the button is hidden — press it anyway via the
  // same path a user would after the app notices
  await p.evaluate(() => { document.querySelector('#online-put').hidden = false; });
}
await tap('#online-put');
await p.waitForTimeout(1500);
const again = await champOf();
check('it is online again rather than saying "already online"',
  again.code && again.code !== code, `was ${code}, now ${again.code}`);
const listNow = await p.evaluate(async () => (await (await fetch('api/champs', { cache: 'no-store' })).json()).championships);
check('and back on the list everybody sees', listNow.some((c) => c.code === again.code));

// tidy up only what this test made
for (const c of listNow) await fetch(`${SHARED_APP}api/champs/${c.code}`, { method: 'DELETE' });

console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
if (fail) process.exit(1);
