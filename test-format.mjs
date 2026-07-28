// Changing a shared championship's game type — the one that looked like it did
// nothing. A sport put online, then set to All vs all: the old head-to-head
// matches must not come back from the server, and a sport already left in that
// state must have a way out.
//
//   rm -rf /tmp/champfmt && DATA_DIR=/tmp/champfmt PORT=8789 node server.mjs
//   node test-format.mjs
import { webkit, devices } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8789/';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

const run = async () => {
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { fail++; console.log('  PAGEERROR ' + e.message); });
  page.on('dialog', async (d) => { fail++; console.log('  NATIVE DIALOG: ' + d.message()); await d.accept(); });

  const tap = async (sel) => {
    const el = page.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
  };
  const champOf = () => page.evaluate(() => {
    const lib = JSON.parse(localStorage.getItem('dadchamps.library.v1') || 'null');
    if (!lib) return null;
    return lib.championships.find((c) => c.id === lib.currentId) || null;
  });
  const onServer = (code) => page.evaluate(async (theCode) => {
    const res = await fetch(`api/champs/${theCode}`, { cache: 'no-store' });
    return (await res.json()).championship;
  }, code);
  const forSport = (champ, sportId) => champ.matches.filter((m) => m.sportId === sportId);

  console.log('--- a championship, online, the way the family runs it ---');
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(700);
  await page.fill('#champ-name-input', 'Format Cup');
  for (const [i, n] of [[0, 'Jesper'], [1, 'Far'], [2, 'Villads'], [3, 'Thomas']]) {
    await page.locator(`input[data-kind="player"][data-index="${i}"]`).fill(n);
  }
  await tap('[data-goto="2"]');
  await tap('#btn-create');
  await page.waitForTimeout(600);

  await tap('#btn-menu');
  await tap('#menu-online');
  await page.waitForTimeout(600);
  await tap('#online-put');
  await page.waitForTimeout(900);
  const code = (await champOf()).code;
  check('it is online', /^[ACDEFGHJKLMNPQRTUVWXYZ234679]{6}$/.test(code || ''), String(code));
  await tap('#online-close');

  const sport = (await champOf()).sports[0];
  const before = forSport(await champOf(), sport.id).length;
  check('the first sport starts with head-to-head matches', before >= 1, `${before} matches`);

  console.log('\n--- set it to All vs all ---');
  await tap('.sport-link');
  await tap('#sport-settings');
  await page.selectOption('#sport-format', 'ffa');
  await tap('#sport-save');
  await page.waitForTimeout(250);
  await tap('#confirm-yes');
  await page.waitForTimeout(500);

  let local = await champOf();
  check('the sport says All vs all', local.sports[0].format === 'ffa', local.sports[0].format);
  check('one round, everybody in it', forSport(local, sport.id).length === 1,
    `${forSport(local, sport.id).length} matches`);
  check('the old matches are remembered as gone', Object.keys(local.removed || {}).length >= before,
    JSON.stringify(local.removed));

  // the phone pushes, pulls the server's copy back, and merges it in — this is
  // the round trip that used to bring every old match back to life
  await page.waitForTimeout(6000);

  local = await champOf();
  const server = await onServer(code);
  check('after talking to the server, still one round on the phone',
    forSport(local, sport.id).length === 1, `${forSport(local, sport.id).length} matches`);
  check('and one round on the server', forSport(server, sport.id).length === 1,
    JSON.stringify(forSport(server, sport.id).map((m) => m.sides.length)));
  check('the server agrees it is All vs all',
    server.sports.find((s) => s.id === sport.id).format === 'ffa');
  check('everybody is in that round',
    forSport(server, sport.id)[0].sides.length === server.players.length,
    `${forSport(server, sport.id)[0].sides.length} sides`);

  console.log('\n--- a sport already stranded: the right game type, the wrong matches ---');
  // exactly the state the merge used to leave behind: format ffa, old 1v1
  // matches still sitting there. Written straight onto the server so the phone
  // has to pull it in, the way it happened.
  await page.evaluate(async ({ theCode, sportId }) => {
    const res = await fetch(`api/champs/${theCode}`, { cache: 'no-store' });
    const { championship } = await res.json();
    const [p1, p2, p3, p4] = championship.players.map((p) => p.id);
    championship.matches.push(
      { id: 'zombie1', sportId, sides: [{ players: [p1], score: null }, { players: [p2], score: null }], done: false, updatedAt: new Date().toISOString() },
      { id: 'zombie2', sportId, sides: [{ players: [p3], score: null }, { players: [p4], score: null }], done: false, updatedAt: new Date().toISOString() }
    );
    championship.updatedAt = new Date().toISOString();
    await fetch(`api/champs/${theCode}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ championship }),
    });
  }, { theCode: code, sportId: sport.id });

  await page.waitForTimeout(6000);
  local = await champOf();
  check('the stray matches did arrive (the state he is in)',
    forSport(local, sport.id).length === 3, `${forSport(local, sport.id).length} matches`);

  await tap('#tabs button[data-view="sports"]');
  await tap('.sport-link');
  await tap('#sport-settings');
  check('there is a way to draw new matches for just this sport',
    !(await page.evaluate(() => document.querySelector('#sport-redraw').hidden)));
  await tap('#sport-redraw');
  await page.waitForTimeout(250);
  check('it asks first', !(await page.evaluate(() => document.querySelector('#confirm-sheet').hidden)));
  await tap('#confirm-yes');
  await page.waitForTimeout(500);

  local = await champOf();
  check('one round again on the phone', forSport(local, sport.id).length === 1,
    `${forSport(local, sport.id).length} matches`);

  await page.waitForTimeout(6000);
  local = await champOf();
  const server2 = await onServer(code);
  check('the strays stay gone on the phone', forSport(local, sport.id).length === 1,
    `${forSport(local, sport.id).length} matches`);
  check('and gone on the server', forSport(server2, sport.id).length === 1,
    `${forSport(server2, sport.id).length} matches`);
  check('other sports were left alone',
    server2.matches.filter((m) => m.sportId !== sport.id).length ===
      server.matches.filter((m) => m.sportId !== sport.id).length);

  await browser.close();
  console.log(`\n${pass} ok, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

run();
