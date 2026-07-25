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

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  if (fail) process.exit(1);
};

run().catch((e) => { console.error(e); process.exit(1); });
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

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  if (fail) process.exit(1);
};

run().catch((e) => { console.error(e); process.exit(1); });
