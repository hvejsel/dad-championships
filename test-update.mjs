// The self-update test. A phone that has the app on its home screen has no
// reload button, and the phone restores the app exactly as it was left — so a
// deployed fix can sit on the server for days without ever reaching the screen.
// This drives that exact path: old app open, new version deployed, no reload.
//
//   cp the app into /tmp/swtest and serve it on 9731, then: node test-update.mjs
import { webkit, devices } from 'playwright';
import { execSync } from 'child_process';
const URL = process.env.URL || 'http://localhost:9731/index.html';
const REPO = process.env.REPO || process.cwd();
let pass = 0, fail = 0;
const check = (n, ok, x='') => { ok ? (pass++, console.log('  ok   '+n)) : (fail++, console.log('  FAIL '+n+' '+x)); };
const deploy = () => execSync(`rm -rf /tmp/swtest && mkdir -p /tmp/swtest && cp ${REPO}/index.html ${REPO}/app.js ${REPO}/styles.css ${REPO}/tournament.js ${REPO}/sw.js ${REPO}/manifest.webmanifest ${REPO}/icon.svg ${REPO}/icon-*.png /tmp/swtest/`);
const bump = (n) => {
  execSync(`sed -i '' "s/^const APP_VERSION = .*/const APP_VERSION = ${n};/" /tmp/swtest/app.js`);
  execSync(`sed -i '' "s/^const CACHE = .*/const CACHE = 'dad-champs-v${n}';/" /tmp/swtest/sw.js`);
};

deploy();
const b = await webkit.launch();
const ctx = await b.newContext({ ...devices['iPhone 14'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  PAGEERROR ' + e.message));
const ver = () => page.evaluate(() => (document.querySelector('#app-version') || {}).textContent || '(none)');

console.log('--- the phone has the app installed, with a championship running ---');
await page.goto(URL);
await page.waitForTimeout(1500);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(1500);
await page.fill('#champ-name-input', 'Update Cup');
await page.locator('[data-goto="2"]').click();
await page.locator('#btn-create').click();
await page.waitForTimeout(600);
check('service worker is in charge', await page.evaluate(() => !!navigator.serviceWorker.controller));
console.log('  showing: ' + await ver());

console.log('\n--- a new version is deployed while the app sits open ---');
bump(41);
console.log('\n--- the user brings the app back to the front; no reload button exists ---');
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForTimeout(5000);
const v2 = await ver();
console.log('  showing: ' + v2);
check('the app updated itself, unprompted', v2.includes('41'), v2);
check('the running championship survived the update', (await page.textContent('#brand')).includes('Update Cup'));

console.log('\n--- and "Update the app" is the way out if even that sticks ---');
bump(42);
await page.locator('#btn-menu').click();
await page.waitForTimeout(400);
await page.locator('#menu-update').click();
await page.waitForTimeout(5000);
const v3 = await ver();
console.log('  showing: ' + v3);
check('Update the app fetches the newest version', v3.includes('42'), v3);
check('and the championship is still there', (await page.textContent('#brand')).includes('Update Cup'));

console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
if (fail) process.exit(1);
