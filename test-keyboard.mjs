// The on-screen keyboard test. The layout viewport does NOT shrink when a
// phone keyboard opens — it simply covers the bottom half of the screen. Any
// button down there is invisible and untappable, which reads exactly like a
// button that does nothing. This measures every pinned action against the
// space the keyboard takes.
//
//   python3 -m http.server 8777      (from this folder, in another terminal)
//   node test-keyboard.mjs
import { webkit, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8777/index.html';
// An iPhone 14 keyboard covers roughly the bottom 336px of the 664px screen.
const KEYBOARD_PX = 336;
const KEYBOARD_PX_IN_PAGE = 336;

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + x)); };

const b = await webkit.launch();
const ctx = await b.newContext({ ...devices['iPhone 14'] });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('  PAGEERROR ' + e.message));

await p.goto(BASE);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForTimeout(700);

await p.locator('#champ-name-input').tap();
await p.keyboard.type('Hvejsel Cup');
await p.selectOption('[data-count="players"]', '5');
await p.waitForTimeout(400);
for (const [i, n] of [[0,'Jesper'],[1,'Far'],[2,'Villads'],[3,'Thomas'],[4,'Anders']]) {
  await p.locator(`input[data-kind="player"][data-index="${i}"]`).tap();
  await p.keyboard.type(n);
}
// iOS keeps the field you are typing in on screen
await p.locator('input[data-kind="player"][data-index="4"]').scrollIntoViewIfNeeded();
await p.waitForTimeout(400);

const measure = (sel) => p.evaluate((s) => {
  const el = document.querySelector(s);
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), screen: innerHeight };
}, sel);

// the keyboard opens: the visual viewport shrinks and the app is told about it
await p.evaluate((px) => document.documentElement.style.setProperty('--keyboard', px + 'px'), KEYBOARD_PX_IN_PAGE);
await p.waitForTimeout(300);

const m = await measure('[data-goto="2"]');
const keyboardTop = m.screen - KEYBOARD_PX;
console.log(`  screen ${m.screen}px, keyboard covers from ${keyboardTop}px down`);
console.log(`  "Next: the sports" sits at ${m.top}–${m.bottom}px`);
check('the button is not hidden behind the keyboard', m.bottom <= keyboardTop, `bottom ${m.bottom} > ${keyboardTop}`);

// the app measures the keyboard for itself from the visual viewport
const tracked = await p.evaluate(() => {
  document.documentElement.style.removeProperty('--keyboard');
  window.visualViewport.dispatchEvent(new Event('resize'));
  return getComputedStyle(document.documentElement).getPropertyValue('--keyboard').trim();
});
check('with no keyboard up it measures zero', tracked === '0px', JSON.stringify(tracked));

// and the keyboard's own Go key gets you there without the button at all
await p.locator('input[data-kind="player"][data-index="0"]').tap();
await p.keyboard.press('Enter');
await p.waitForTimeout(200);
const focused = await p.evaluate(() => document.activeElement.dataset.index);
check('Go on the keyboard moves to the next name', focused === '1', `focus on index ${focused}`);

for (let i = 0; i < 4; i++) { await p.keyboard.press('Enter'); await p.waitForTimeout(120); }
const stillTyping = await p.evaluate(() => document.activeElement.tagName);
check('and on the last name it puts the keyboard away', stillTyping !== 'INPUT', stillTyping);

// the button still does its job
await p.locator('[data-goto="2"]').scrollIntoViewIfNeeded();
const box = await p.locator('[data-goto="2"]').boundingBox();
await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
await p.waitForTimeout(500);
const step = await p.evaluate(() => document.querySelector('.step[data-step="2"]').hidden ? 1 : 2);
check('Next: the sports moves to step 2', step === 2);

// and so does Create, at the bottom of a long step 2
await p.selectOption('[data-count="sports"]', '6');
await p.waitForTimeout(400);
const c = await measure('#btn-create');
check('Create championship is on screen on a long step 2', c.top >= 0 && c.bottom <= c.screen,
  `at ${c.top}–${c.bottom} of ${c.screen}`);
const cbox = await p.locator('#btn-create').boundingBox();
await p.touchscreen.tap(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
await p.waitForTimeout(700);
check('and it creates the championship', await p.evaluate(() => !document.querySelector('#tabs').hidden));


// --- a sheet with a name field in it has its Save button in the same place ---
const withKeyboard = async (fn) => {
  await p.evaluate((px) => document.documentElement.style.setProperty('--keyboard', px + 'px'), KEYBOARD_PX_IN_PAGE);
  await p.waitForTimeout(300);
  const r = await fn();
  await p.evaluate(() => document.documentElement.style.setProperty('--keyboard', '0px'));
  return r;
};
const tap = async (sel) => {
  const l = p.locator(sel).first();
  await l.scrollIntoViewIfNeeded();
  const bb = await l.boundingBox();
  await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await p.waitForTimeout(320);
};

await tap('.sport-link');
await tap('#sport-settings');
let box2 = await withKeyboard(async () => {
  await p.locator('#sport-sheet .sheet-card').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await p.waitForTimeout(200);
  return measure('#sport-save');
});
check('Save in the sport sheet is reachable above the keyboard', box2.bottom <= box2.screen - KEYBOARD_PX,
  `at ${box2.top}-${box2.bottom}, keyboard from ${box2.screen - KEYBOARD_PX}`);
await tap('#sport-cancel');

await tap('#btn-menu');
await tap('#menu-players');
box2 = await withKeyboard(async () => {
  await p.locator('#players-sheet .sheet-card').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await p.waitForTimeout(200);
  return measure('#players-done');
});
check('Done in Who is playing is reachable above the keyboard', box2.bottom <= box2.screen - KEYBOARD_PX,
  `at ${box2.top}-${box2.bottom}, keyboard from ${box2.screen - KEYBOARD_PX}`);
await tap('#players-done');

console.log(`\n${pass} passed, ${fail} failed`);
await p.screenshot({ path: '/tmp/pwprobe/shots/K1-after.png' });
await b.close();
if (fail) process.exit(1);
