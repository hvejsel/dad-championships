// Mobile tests. These drive a real iPhone-sized WebKit — the engine tests in
// test.mjs cannot see a button that is covered, too small, or behind a browser
// dialog a home-screen web app never shows.
//
//   python3 -m http.server 8777      (from this folder, in another terminal)
//   npx playwright install webkit
//   node test-mobile.mjs
import { webkit, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8777/index.html';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

/** A real one-finger pull down the sheet's handle, the way a thumb does it. */
async function pullDown(page, sheetSel, distance = 200) {
  const grab = await page.locator(sheetSel + ' .grabber').boundingBox();
  const x = grab.x + grab.width / 2;
  const y = grab.y + grab.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(x, y + (distance * i) / 10);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(120); // the finger comes to rest before letting go
  await page.mouse.move(x, y + distance);
  await page.mouse.up();
  await page.waitForTimeout(420);
}

const run = async () => {
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { fail++; console.log('  PAGEERROR ' + e.message); });
  page.on('dialog', async (d) => { fail++; console.log('  NATIVE DIALOG (should not happen): ' + d.message()); await d.accept(); });

  const tap = async (sel) => {
    await page.locator(sel).first().scrollIntoViewIfNeeded();
    const b = await page.locator(sel).first().boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(280);
  };
  const hidden = (sel) => page.evaluate((s) => document.querySelector(s).hidden, sel);
  const lib = () => page.evaluate(() => JSON.parse(localStorage.getItem('dadchamps.library.v1') || 'null'));

  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);

  console.log('\n--- 1. buttons that used to be dead (they were behind the browser confirm box) ---');
  await page.fill('#champ-name-input', 'Summer Cup');
  await tap('[data-goto="2"]');
  await tap('#btn-create');
  await page.waitForTimeout(400);
  check('championship created', !(await hidden('#tabs')));

  // enter a result so "clear all results" has something to do
  await tap('.sport-link');
  await tap('.fixture');
  const scoreSel = (await page.locator('#score-0').count()) ? '#score-0' : '#match-body input[type=number]';
  await page.locator(scoreSel).first().fill('11');
  await page.locator('#match-body input[type=number]').nth(1).fill('7');
  await tap('#match-save');
  await page.waitForTimeout(300);
  check('a result was saved', (await lib()).championships[0].matches.some((m) => m.done));

  // Clear all results — the button that did nothing on a home-screen app
  await tap('#btn-menu');
  await tap('#menu-reset');
  check('an in-app question is asked instead of the browser box', !(await hidden('#confirm-sheet')));
  await tap('#confirm-no');
  check('Cancel keeps the results', (await lib()).championships[0].matches.some((m) => m.done));
  await tap('#btn-menu');
  await tap('#menu-reset');
  await tap('#confirm-yes');
  await page.waitForTimeout(300);
  check('Clear all results now works', !(await lib()).championships[0].matches.some((m) => m.done));

  // Draw up a new programme
  await tap('#btn-menu');
  await tap('#menu-rebuild');
  check('new programme asks', !(await hidden('#confirm-sheet')));
  await tap('#confirm-yes');
  await page.waitForTimeout(300);
  check('new programme drawn', (await lib()).championships[0].matches.length > 0);

  // Delete a match
  await tap('.sport-link');
  const before = (await lib()).championships[0].matches.length;
  await tap('.fixture');
  await tap('#match-delete');
  check('delete match asks', !(await hidden('#confirm-sheet')));
  await tap('#confirm-yes');
  await page.waitForTimeout(350);
  check('delete match works', (await lib()).championships[0].matches.length === before - 1);

  // Delete a sport
  const sportsBefore = (await lib()).championships[0].sports.length;
  await tap('#sport-settings');
  await tap('#sport-delete');
  await tap('#confirm-yes');
  await page.waitForTimeout(350);
  check('delete sport works', (await lib()).championships[0].sports.length === sportsBefore - 1);

  console.log('\n--- 2. more than one championship, all kept ---');
  await tap('#btn-menu');
  await tap('#menu-new');
  await page.waitForTimeout(300);
  check('setup opens for a second championship', !(await hidden('#view-setup')));
  check('a way back to the saved one is offered', !(await hidden('#btn-setup-back')));
  await page.fill('#champ-name-input', 'Winter Cup');
  await tap('[data-goto="2"]');
  await tap('#btn-create');
  await page.waitForTimeout(400);
  let l = await lib();
  check('both championships are on the phone', l.championships.length === 2, JSON.stringify(l.championships.map((c) => c.name)));
  check('the new one is the open one', l.championships.find((c) => c.id === l.currentId).name === 'Winter Cup');

  await tap('#btn-menu');
  await tap('#menu-champs');
  check('the list shows both', (await page.locator('.champ-open').count()) === 2);
  await page.locator('.champ-open', { hasText: 'Summer Cup' }).click();
  await page.waitForTimeout(400);
  l = await lib();
  check('switching back opens Summer Cup', l.championships.find((c) => c.id === l.currentId).name === 'Summer Cup');
  check('the brand shows it', (await page.textContent('#brand')).includes('Summer Cup'));

  // survives a reload
  await page.reload();
  await page.waitForTimeout(500);
  check('it is still open after a reload', (await page.textContent('#brand')).includes('Summer Cup'));
  check('both are still there after a reload', (await lib()).championships.length === 2);

  // delete one from the list
  await tap('#btn-menu');
  await tap('#menu-champs');
  await page.locator('.champ-del').nth(1).click();
  await page.waitForTimeout(250);
  await tap('#confirm-yes');
  await page.waitForTimeout(350);
  check('one can be deleted, the other kept', (await lib()).championships.length === 1);

  console.log('\n--- 3. a pull down closes the sheet ---');
  await tap('#champs-close');
  await tap('#btn-menu');
  check('menu is open', !(await hidden('#menu')));
  await pullDown(page, '#menu', 220);
  check('pulling the menu down closes it', await hidden('#menu'));

  await tap('.sport-link');
  await tap('.fixture');
  check('match sheet is open', !(await hidden('#match-sheet')));
  await pullDown(page, '#match-sheet', 220);
  check('pulling the match sheet down closes it', await hidden('#match-sheet'));

  await tap('.fixture');
  await pullDown(page, '#match-sheet', 30);
  check('a short pull springs back instead of closing', !(await hidden('#match-sheet')));
  await tap('#match-cancel');

  await tap('#sport-settings');
  await pullDown(page, '#sport-sheet', 220);
  check('pulling the sport sheet down closes it', await hidden('#sport-sheet'));

  console.log('\n--- 4. nothing blocks a tap ---');
  await tap('.fixture');
  await tap('#match-save');
  await page.waitForTimeout(150);
  check('a toast is showing', !(await hidden('#toast')));
  const blocked = await page.evaluate(() => {
    const t = document.querySelector('#toast').getBoundingClientRect();
    const el = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2);
    return el && el.id === 'toast';
  });
  check('the toast does not swallow taps under it', !blocked);


  console.log('\n--- 5. the app says which version it is, and can force its own update ---');
  await tap('#btn-menu');
  const version = (await page.textContent('#app-version')).trim();
  check('the menu shows a version', /^Version \d+ . /.test(version), JSON.stringify(version));
  check('an Update the app button is there', (await page.locator('#menu-update').count()) === 1);
  await tap('#menu-close');

  console.log('\n--- 6. sharing never dies silently ---');
  await tap('#tabs button[data-view="table"]');
  // a phone that offers neither a share sheet nor a clipboard
  await page.evaluate(() => {
    // the real-world failure: the phone refuses to open its own share sheet
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: () => Promise.reject(new DOMException('not allowed', 'NotAllowedError')),
    });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });
  await tap('#btn-share');
  check('the table is shown to copy by hand instead', !(await hidden('#share-sheet')));
  const shown = await page.inputValue('#share-text');
  check('and it holds the real table', shown.includes('matches played'), JSON.stringify(shown.slice(0, 60)));
  await tap('#share-close');


  console.log('\n--- 7. the field can be edited after the championship has started ---');
  await tap('#btn-menu');
  await tap('#menu-players');
  check('the field opens from the menu', !(await hidden('#players-sheet')));
  const rows = () => page.locator('#players-list .roster-row').count();
  check('every player has a row', (await rows()) === 4);

  // rename
  await page.locator('#players-list .roster-name').first().fill('Bedstefar');
  await page.waitForTimeout(300);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('dadchamps.library.v1')));
  let lib2 = await stored();
  const open2 = lib2.championships.find((c) => c.id === lib2.currentId);
  check('a name can be changed', open2.players[0].name === 'Bedstefar', open2.players[0].name);

  // change a generation
  await page.selectOption('#players-list select', 'granddad');
  await page.waitForTimeout(300);
  lib2 = await stored();
  check('a generation can be changed',
    lib2.championships.find((c) => c.id === lib2.currentId).players[0].generation === 'granddad');

  // somebody turns up late
  await tap('#players-add');
  check('a player can be added later', (await rows()) === 5);
  await page.locator('#players-list .roster-name').nth(4).fill('Cousin Bo');
  await page.waitForTimeout(300);
  lib2 = await stored();
  check('and he is saved',
    lib2.championships.find((c) => c.id === lib2.currentId).players.length === 5);

  // somebody has to leave
  const libBefore = await stored();
  const before2 = libBefore.championships.find((c) => c.id === libBefore.currentId).matches.length;
  await page.locator('#players-list .roster-del').nth(1).click();
  await page.waitForTimeout(300);
  check('taking somebody out asks first, in the app', !(await hidden('#confirm-sheet')));
  await tap('#confirm-yes');
  await page.waitForTimeout(400);
  lib2 = await stored();
  const open3 = lib2.championships.find((c) => c.id === lib2.currentId);
  check('he is out of the field', open3.players.length === 4);
  check('his matches went with him', open3.matches.length < before2);
  check('and no match is left with an empty side',
    open3.matches.every((m) => m.sides.every((sd) => sd.players.length && sd.players.every(Boolean))));

  console.log('\n--- 8. Pedro: a stand-in you can play against ---');
  const standIns = () => page.locator('#standins-list .roster-row').count();
  check('every championship starts with a Pedro', (await standIns()) === 1);
  const pedroName = await page.locator('#standins-list .roster-name').first().inputValue();
  check('and he is called Pedro', pedroName === 'Pedro', pedroName);

  await tap('#standin-add');
  await page.locator('#standins-list .roster-name').nth(1).fill('Anders');
  await page.waitForTimeout(300);
  check('another stand-in can be added', (await standIns()) === 2);
  await tap('#players-done');

  // Anders is pickable as an opponent
  await tap('#tabs button[data-view="sports"]');
  await tap('.sport-link');
  await tap('.fixture');
  const options = await page.locator('#match-body select').first().locator('option').allTextContents();
  check('a stand-in can be picked as an opponent', options.some((o) => o.startsWith('Anders')), JSON.stringify(options));
  check('and is marked as standing in', options.some((o) => o === 'Anders — stands in'));

  // play a player against the stand-in
  const sideSelects = page.locator('#match-body select');
  await sideSelects.nth(1).selectOption({ label: 'Anders — stands in' });
  await page.waitForTimeout(300);
  await page.locator('#match-body input[type=number]').nth(0).fill('11');
  await page.locator('#match-body input[type=number]').nth(1).fill('4');
  await tap('#match-save');
  await page.waitForTimeout(400);

  await tap('#tabs button[data-view="table"]');
  const tableText = await page.textContent('#table-body');
  check('the stand-in never enters the table', !tableText.includes('Anders'), tableText.slice(0, 120));
  check('but the match counted for the player', /point|Pts/i.test(tableText));


  console.log('\n--- 9. a booked time is a day and a time ---');
  await tap('#tabs button[data-view="sports"]');
  await tap('.sport-link');
  await tap('#sport-settings');
  const kind = await page.getAttribute('#sport-time', 'type');
  check('the picker asks for a day and a time', kind === 'datetime-local', kind);
  await page.fill('#sport-time', '2026-08-01T09:30');
  await tap('#sport-save');
  await page.waitForTimeout(400);
  await tap('#btn-back');           // back to the overview, where the list lives
  await page.waitForTimeout(400);
  let lib3 = await stored();
  const champ3 = lib3.championships.find((c) => c.id === lib3.currentId);
  check('the day is saved with the time', champ3.sports.some((sp) => sp.time === '2026-08-01T09:30'),
    JSON.stringify(champ3.sports.map((sp) => sp.time)));
  const listText = await page.textContent('#sports-body');
  check('and the list shows the day, not just the clock', /1 Aug|Aug 1/.test(listText),
    listText.replace(/\s+/g, ' ').slice(0, 160));

  console.log('\n--- 10. a sport shows when it is done ---');
  await tap('.sport-link');   // the first sport in the list
  // play every match in this sport
  for (let i = 0; i < 10; i++) {
    const open = page.locator('.fixture:not(.played)');
    if (!(await open.count())) break;
    const bb = await open.first().boundingBox();
    await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.waitForTimeout(320);
    const nums = page.locator('#match-body input[type=number]');
    await nums.nth(0).fill('11');
    await nums.nth(1).fill('5');
    await tap('#match-save');
    await page.waitForTimeout(320);
  }
  await tap('#btn-back');
  await page.waitForTimeout(300);
  const overview = await page.textContent('#sports-body');
  check('the finished sport says Done in the overview', /Done/.test(overview),
    overview.replace(/\s+/g, ' ').slice(0, 200));
  check('and it is marked as done', (await page.locator('.sport-link.done').count()) >= 1);
  check('a sport still to play is not marked', (await page.locator('.sport-link:not(.done)').count()) >= 1);

  console.log('\n--- 11. a championship saves to a file and opens again ---');
  await tap('#btn-menu');
  check('Save to a file is in the menu', (await page.locator('#menu-export').count()) === 1);
  check('Open from a file is too', (await page.locator('#menu-import').count()) === 1);

  // what the file holds, and that opening it puts the championship back
  const saved = await page.evaluate(() => {
    const lib = JSON.parse(localStorage.getItem('dadchamps.library.v1'));
    const champ = lib.championships.find((c) => c.id === lib.currentId);
    return JSON.stringify({ kind: 'dad-championships/championship', championship: champ });
  });
  check('the file holds the whole championship',
    JSON.parse(saved).championship.matches.length > 0 && JSON.parse(saved).championship.players.length > 0);

  await tap('#menu-close');
  // wipe the phone, then open the file on it
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(700);
  check('the phone is empty again', !(await hidden('#view-setup')));

  await page.setInputFiles('#import-file', {
    name: 'summer-cup.json', mimeType: 'application/json', buffer: Buffer.from(saved),
  });
  await page.waitForTimeout(800);
  check('opening the file brings the championship back', await hidden('#view-setup'));
  const back = await stored();
  const restored = back.championships.find((c) => c.id === back.currentId);
  check('with every result intact',
    restored.matches.filter((m) => m.done).length === JSON.parse(saved).championship.matches.filter((m) => m.done).length);
  check('and the same field', restored.players.length === JSON.parse(saved).championship.players.length);

  // a file that is not a championship is refused rather than swallowed
  await page.setInputFiles('#import-file', {
    name: 'holiday.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":"world"}'),
  });
  await page.waitForTimeout(600);
  check('a file that is not a championship is refused', !(await hidden('#toast')));
  const said = await page.textContent('#toast');
  check('and it says so plainly', /championship/i.test(said), said);

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  if (fail) process.exit(1);
};

run().catch((e) => { console.error(e); process.exit(1); });
