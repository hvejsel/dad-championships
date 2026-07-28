// Two phones, one shared championship. The point of the whole exercise:
// everybody opens the same address, picks the championship off the list, and
// enters scores — and nobody's scores get lost.
//
//   rm -rf /tmp/champdata && DATA_DIR=/tmp/champdata PORT=8788 node server.mjs
//   node test-online.mjs
import { webkit, devices } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8788/';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

const run = async () => {
  const browser = await webkit.launch();
  // two separate contexts: two phones that share nothing but the address
  const dad = await browser.newContext({ ...devices['iPhone 14'] });
  const granddad = await browser.newContext({ ...devices['iPhone 14'] });
  const a = await dad.newPage();
  const b = await granddad.newPage();
  for (const [name, page] of [['dad', a], ['granddad', b]]) {
    page.on('pageerror', (e) => { fail++; console.log(`  PAGEERROR (${name}) ` + e.message); });
  }

  const tap = async (page, sel) => {
    const el = page.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(320);
  };
  const champOf = (page) => page.evaluate(() => {
    const lib = JSON.parse(localStorage.getItem('dadchamps.library.v1') || 'null');
    if (!lib) return null;
    return lib.championships.find((c) => c.id === lib.currentId) || null;
  });

  console.log('--- dad sets a championship up and puts it online ---');
  await a.goto(BASE);
  await a.evaluate(() => localStorage.clear());
  await a.reload();
  await a.waitForTimeout(800);
  await a.fill('#champ-name-input', 'Hvejsel Cup');
  for (const [i, n] of [[0, 'Jesper'], [1, 'Far'], [2, 'Villads'], [3, 'Thomas']]) {
    await a.locator(`input[data-kind="player"][data-index="${i}"]`).fill(n);
  }
  await tap(a, '[data-goto="2"]');
  await tap(a, '#btn-create');
  await a.waitForTimeout(600);

  await tap(a, '#btn-menu');
  check('the online list is offered when a server is there', !(await a.evaluate(
    () => document.querySelector('#menu-online').hidden)));
  await tap(a, '#menu-online');
  await a.waitForTimeout(600);
  await tap(a, '#online-put');
  await a.waitForTimeout(900);

  const code = (await champOf(a)).code;
  check('it gets a code that can be read aloud', /^[ACDEFGHJKLMNPQRTUVWXYZ234679]{6}$/.test(code || ''), String(code));
  await tap(a, '#online-close');

  console.log('\n--- granddad opens the same address and picks it off the list ---');
  await b.goto(BASE);
  await b.evaluate(() => localStorage.clear());
  await b.reload();
  await b.waitForTimeout(900);
  // a phone with nothing on it lands on setup; the list is reached from there
  const onSetup = await b.evaluate(() => !document.querySelector('#view-setup').hidden);
  check('a phone with nothing on it still starts somewhere sensible', onSetup);

  const joined = await b.evaluate(async (theCode) => {
    const res = await fetch(`api/champs/${theCode}`);
    const { championship } = await res.json();
    return { name: championship.name, players: championship.players.length };
  }, code);
  check('the championship is there to be fetched', joined.name === 'Hvejsel Cup', JSON.stringify(joined));
  check('with the whole field', joined.players === 4);

  const list = await b.evaluate(async () => {
    const res = await fetch('api/champs', { cache: 'no-store' });
    return (await res.json()).championships;
  });
  check('and it shows up on the list everybody sees', list.length === 1 && list[0].name === 'Hvejsel Cup',
    JSON.stringify(list));

  // he joins it the way anyone would: the button on the very first screen
  check('a fresh phone is offered a way in', !(await b.evaluate(
    () => document.querySelector('#btn-setup-online').hidden)));
  await tap(b, '#btn-setup-online');
  await b.waitForTimeout(900);
  await tap(b, '#online-list .champ-open');
  await b.waitForTimeout(900);

  const bChamp = await champOf(b);
  check('granddad now has the same championship', bChamp && bChamp.name === 'Hvejsel Cup', JSON.stringify(bChamp && bChamp.name));
  check('following the same code', bChamp && bChamp.code === code);

  console.log('\n--- both of them enter a score, at the same time ---');
  const enter = async (page, sportIndex, index, home, away) => {
    await tap(page, '#tabs button[data-view="sports"]');
    const sport = page.locator('.sport-link').nth(sportIndex);
    await sport.scrollIntoViewIfNeeded();
    const sportBox = await sport.boundingBox();
    await page.touchscreen.tap(sportBox.x + sportBox.width / 2, sportBox.y + sportBox.height / 2);
    await page.waitForTimeout(360);
    const fixture = page.locator('.fixture').nth(index);
    await fixture.scrollIntoViewIfNeeded();
    const box = await fixture.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    const nums = page.locator('#match-body input[data-score-for]');
    await nums.nth(0).fill(String(home));
    await nums.nth(1).fill(String(away));
    await tap(page, '#match-save');
    await page.waitForTimeout(400);
  };

  await enter(a, 0, 0, 11, 4);   // dad enters the first match of the first sport
  await enter(b, 0, 1, 9, 7);    // granddad enters the second, on his own phone

  // let both phones talk to the server
  await a.waitForTimeout(5000);
  await b.waitForTimeout(5000);

  const finalA = await champOf(a);
  const finalB = await champOf(b);
  const scored = (champ) => champ.matches.filter((m) => m.done).length;

  check("dad's phone shows both results", scored(finalA) === 2, `${scored(finalA)} of 2`);
  check("granddad's phone shows both results", scored(finalB) === 2, `${scored(finalB)} of 2`);

  const sameOnBoth = JSON.stringify(finalA.matches.map((m) => [m.id, m.sides.map((s) => s.score)]).sort()) ===
    JSON.stringify(finalB.matches.map((m) => [m.id, m.sides.map((s) => s.score)]).sort());
  check('and both phones agree on every score', sameOnBoth);

  const server = await a.evaluate(async (theCode) => {
    const res = await fetch(`api/champs/${theCode}`, { cache: 'no-store' });
    return (await res.json()).championship;
  }, code);
  check('the server holds both results too', server.matches.filter((m) => m.done).length === 2,
    `${server.matches.filter((m) => m.done).length} of 2`);

  console.log('\n--- a score entered with no signal still gets there ---');
  await granddad.setOffline(true);
  await enter(b, 1, 0, 15, 2);  // a match in the next sport, with the signal gone
  const offline = await champOf(b);
  check('it is kept on the phone while the signal is gone', scored(offline) === 3, `${scored(offline)} of 3`);

  await granddad.setOffline(false);
  await b.evaluate(() => window.dispatchEvent(new Event('online')));
  await b.waitForTimeout(5000);
  await a.waitForTimeout(5000);

  const backA = await champOf(a);
  check("and turns up on dad's phone once the signal is back", scored(backA) === 3, `${scored(backA)} of 3`);

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  if (fail) process.exit(1);
};

run().catch((e) => { console.error(e); process.exit(1); });
