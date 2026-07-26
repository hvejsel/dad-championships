// Notifications, from the browser's side.
//
// A real push cannot be delivered from a test — that needs Apple's or Google's
// service and a real device. What is checked here is everything up to that
// point, plus the thing most likely to waste somebody's afternoon: an iPhone in
// a browser tab has no push at all, and the app has to say so instead of
// offering a switch that does nothing.
//
//   rm -rf /tmp/champdata && DATA_DIR=/tmp/champdata PORT=8788 node server.mjs
//   node test-notify.mjs

import { webkit, chromium, devices } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8788/';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

const tap = async (page, sel) => {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (page.touchscreen && (await page.evaluate(() => 'ontouchstart' in window))) {
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await el.click();
  }
  await page.waitForTimeout(320);
};

const buildChampionship = async (page, name) => {
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(800);
  await page.fill('#champ-name-input', name);
  for (const [i, n] of [[0, 'Jesper'], [1, 'Far'], [2, 'Villads'], [3, 'Thomas']]) {
    await page.locator(`input[data-kind="player"][data-index="${i}"]`).fill(n);
  }
  await tap(page, '[data-goto="2"]');
  await tap(page, '#btn-create');
  await page.waitForTimeout(600);
};

const run = async () => {
  console.log('--- an iPhone in a browser tab is told the truth ---');
  {
    const browser = await webkit.launch();
    const ctx = await browser.newContext({ ...devices['iPhone 14'] });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { fail++; console.log('  PAGEERROR ' + e.message); });

    await buildChampionship(page, 'Notify Cup');
    await tap(page, '#btn-menu');
    check('notifications are not offered before it is online', await page.evaluate(
      () => document.querySelector('#menu-notify').hidden));

    await tap(page, '#menu-online');
    await page.waitForTimeout(600);
    await tap(page, '#online-put');
    await page.waitForTimeout(900);
    await tap(page, '#online-close');

    await tap(page, '#btn-menu');
    check('once online, notifications are offered', !(await page.evaluate(
      () => document.querySelector('#menu-notify').hidden)));
    check('and so is telling everybody', !(await page.evaluate(
      () => document.querySelector('#menu-tell').hidden)));

    await tap(page, '#menu-notify');
    await page.waitForTimeout(600);
    const said = await page.textContent('#notify-state');
    const steps = await page.textContent('#notify-body');
    check('it says an iPhone needs the app on the home screen', /home screen/i.test(said), said);
    check('and tells you how to do it', /Add to Home Screen/i.test(steps), steps.replace(/\s+/g, ' ').slice(0, 120));
    check('no switch is offered that could not work', (await page.locator('#notify-toggle').count()) === 0);

    await browser.close();
  }

  console.log('\n--- a browser that does have push subscribes properly ---');
  {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ permissions: ['notifications'] });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { fail++; console.log('  PAGEERROR ' + e.message); });

    await buildChampionship(page, 'Push Cup');
    await tap(page, '#btn-menu');
    await tap(page, '#menu-online');
    await page.waitForTimeout(600);
    await tap(page, '#online-put');
    await page.waitForTimeout(900);
    const code = await page.evaluate(() => {
      const lib = JSON.parse(localStorage.getItem('dadchamps.library.v1'));
      return lib.championships.find((c) => c.id === lib.currentId).code;
    });
    await tap(page, '#online-close');

    check('this browser can be told things', await page.evaluate(
      () => 'Notification' in window && 'PushManager' in window));

    // a phone where notifications were refused once is told where to undo it,
    // rather than being given a switch that cannot do anything
    await tap(page, '#btn-menu');
    await tap(page, '#menu-notify');
    await page.waitForTimeout(600);
    if (await page.evaluate(() => Notification.permission === 'denied')) {
      const blocked = await page.textContent('#notify-state');
      check('a phone with them switched off is told where to change it',
        /settings/i.test(blocked), blocked);
    }
    // the switch is always there: a dead end with no button is worse than a
    // button that comes back and says no
    check('a switch is offered either way', (await page.locator('#notify-toggle').count()) === 1);

    // the key the phone needs before it can subscribe
    const key = await page.evaluate(async () => (await (await fetch('api/push/key')).json()).publicKey);
    check('the server hands out a signing key', typeof key === 'string' && key.length > 60, String(key).slice(0, 20));

    // subscribing needs the browser maker's push service; whether it answers
    // from a test machine or not, the app has to report honestly
    await tap(page, '#notify-toggle');
    await page.waitForTimeout(4000);
    const toast = await page.textContent('#toast');
    check('switching on says plainly what happened', /told|Could not/.test(toast), toast);

    const subscribed = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return Boolean(await reg.pushManager.getSubscription());
    });
    if (subscribed) {
      const held = await page.evaluate(async () => (await (await fetch('api/health')).json()).ok);
      check('the browser really did subscribe', subscribed === true);
      check('and the server is still answering', held === true);
    } else {
      console.log('  --   this machine cannot reach a push service; the rest still holds');
    }

    const stored = await page.evaluate(async (theCode) => {
      const res = await fetch(`api/champs/${theCode}`, { cache: 'no-store' });
      return (await res.json()).championship;
    }, code);
    check('a phone subscription is never handed back out with the championship',
      stored.subscriptions === undefined, JSON.stringify(Object.keys(stored)));
    check("and neither is the server's own bookkeeping", stored.announced === undefined);

    console.log('\n--- telling everybody something ---');
    await page.evaluate(() => document.querySelector('#notify-close').click());
    await page.waitForTimeout(300);
    await tap(page, '#btn-menu');
    await tap(page, '#menu-tell');
    await page.waitForTimeout(500);
    check('the quick messages know what is up next',
      (await page.locator('#tell-quick [data-say]').count()) >= 2);
    const first = await page.locator('#tell-quick [data-say]').first().getAttribute('data-say');
    check('and name the sport and the players', /:/.test(first || ''), String(first));

    await page.fill('#tell-text', 'We are on court 2');
    await tap(page, '#tell-send');
    await page.waitForTimeout(1200);
    const after = await page.textContent('#toast');
    check('sending reports back honestly', /Sent to|Nobody has notifications/.test(after), after);
    check('the sheet closes once it has gone', await page.evaluate(
      () => document.querySelector('#tell-sheet').hidden));

    // an empty message is refused rather than buzzing everyone with nothing
    const refused = await page.evaluate(async (theCode) => {
      const res = await fetch(`api/champs/${theCode}/notify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: '' }),
      });
      return res.status;
    }, code);
    check('an empty message is refused', refused === 400, String(refused));

    await browser.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
};

run().catch((e) => { console.error(e); process.exit(1); });
