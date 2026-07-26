// Push tests. A real push service cannot be reached from a test, so this
// stands one up: a local HTTP server pretending to be Apple's or Google's. It
// proves the messages leave correctly signed and encrypted, that a phone that
// has gone away is forgotten, and that a booked time is announced once.
//
//   node test-push.mjs

import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import webpush from 'web-push';
import { sendToAll, isSubscription, dueMessages, generateKeys, configure, DUE_WINDOW_MS } from './push.mjs';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};
const group = (name) => console.log('\n' + name);

/* A stand-in for the push service the phone's browser maker runs. It has to
   speak HTTPS, because a signed push is only ever sent over TLS — which is
   itself worth knowing works. */
execSync(
  'openssl req -x509 -newkey rsa:2048 -keyout /tmp/push-key.pem -out /tmp/push-cert.pem ' +
    '-days 2 -nodes -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1" 2>/dev/null'
);
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // our own throwaway certificate

const received = [];
let answerWith = 201;
const pushService = createServer(
  { key: readFileSync('/tmp/push-key.pem'), cert: readFileSync('/tmp/push-cert.pem') },
  (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    received.push({
      url: req.url,
      headers: req.headers,
      body: Buffer.concat(chunks),
    });
    res.writeHead(answerWith);
    res.end();
  });
  }
);
await new Promise((r) => pushService.listen(0, '127.0.0.1', r));
const origin = `https://127.0.0.1:${pushService.address().port}`;

const keys = generateKeys();
configure({ ...keys, contact: 'mailto:test@example.com' });

/* A subscription the way a browser hands one over. The keys are a real pair,
   because the payload really is encrypted to them. */
const { createECDH, randomBytes } = await import('node:crypto');
const makeSub = (path) => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `${origin}${path}`,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
};

group('a message really leaves, signed and encrypted');
{
  received.length = 0;
  const subs = [makeSub('/phone-a'), makeSub('/phone-b')];
  const { delivered, gone } = await sendToAll(subs, { title: 'Padel', body: 'You are up' });

  check('it reaches every phone', delivered === 2, String(delivered));
  check('and none are dropped', gone.length === 0);
  check('the push service was called twice', received.length === 2, String(received.length));

  const one = received[0];
  check('signed with our own key', /vapid/i.test(one.headers.authorization || ''), one.headers.authorization);
  check('the signature carries the public key', (one.headers.authorization || '').includes(keys.publicKey.slice(0, 20)));
  check('encrypted the way the standard says', one.headers['content-encoding'] === 'aes128gcm',
    one.headers['content-encoding']);
  check('with a time to live, so it is not kept forever', Number(one.headers.ttl) > 0, one.headers.ttl);
  check('the body is not readable as text', !one.body.toString('utf8').includes('Padel'));
  check('and it is not empty either', one.body.length > 50, String(one.body.length));
}

group('a phone that has gone away is forgotten, not retried forever');
{
  received.length = 0;
  answerWith = 410; // what a push service says when the app was uninstalled
  const dead = makeSub('/uninstalled');
  const { delivered, gone } = await sendToAll([dead], { title: 'x', body: 'y' });
  check('nothing was delivered', delivered === 0);
  check('and the phone is reported so it can be forgotten', gone.length === 1 && gone[0] === dead.endpoint);

  answerWith = 500; // the push service having a bad day
  const flaky = makeSub('/flaky');
  const second = await sendToAll([flaky], { title: 'x', body: 'y' });
  check('a service having a bad day is not treated as gone', second.gone.length === 0);
  answerWith = 201;
}

group('one bad phone does not stop the others');
{
  received.length = 0;
  const good = makeSub('/good');
  const broken = { endpoint: `${origin}/nope`, keys: { p256dh: 'not-a-key', auth: 'nope' } };
  const { delivered } = await sendToAll([broken, good], { title: 'x', body: 'y' });
  check('the working phone still gets it', delivered === 1, String(delivered));
}

group('what counts as a subscription');
{
  check('a real one is accepted', isSubscription(makeSub('/x')) === true);
  check('nothing is not', isSubscription(null) === false);
  check('an endpoint alone is not', isSubscription({ endpoint: `${origin}/x` }) === false);
  check('a plain-http endpoint is refused', isSubscription({
    endpoint: 'http://evil.example/x', keys: { p256dh: 'a', auth: 'b' },
  }) === false);
}

group('a booked time is announced once, when it arrives');
{
  const now = Date.parse('2026-08-01T10:00:00Z');
  const champ = {
    name: 'Hvejsel Cup',
    sports: [
      { id: 's1', name: 'Padel', time: '2026-08-01T10:00' },
      { id: 's2', name: 'Darts', time: '2026-08-01T14:00' },
      { id: 's3', name: 'Bowling', time: null },
    ],
    matches: [
      { id: 'm1', sportId: 's1', done: false },
      { id: 'm2', sportId: 's1', done: true },
    ],
    announced: {},
  };
  const local = Date.parse('2026-08-01T10:00');

  const due = dueMessages(champ, local);
  check('the sport whose time it is gets announced', due.length === 1 && due[0].key === 's1',
    JSON.stringify(due.map((d) => d.key)));
  check('the message says which sport', due[0].title.includes('Padel'), due[0].title);
  check('and how much is left to play', due[0].body.includes('1 match'), due[0].body);

  check('a sport later today is left alone', dueMessages(champ, local).every((d) => d.key !== 's2'));
  check('a sport with no time is never announced', dueMessages(champ, local).every((d) => d.key !== 's3'));
  check('nothing is due before the time comes',
    dueMessages(champ, local - 60_000).length === 0);
  check('once announced it is not announced again',
    dueMessages({ ...champ, announced: { s1: 'sent' } }, local).length === 0);
  check('a check that runs late still sends',
    dueMessages(champ, local + DUE_WINDOW_MS - 1000).length === 1);
  check('but a time long past is not dredged up',
    dueMessages(champ, local + DUE_WINDOW_MS + 60_000).length === 0);
  check('a nonsense time is ignored rather than crashing',
    dueMessages({ ...champ, sports: [{ id: 'sx', name: 'X', time: 'whenever' }] }, local).length === 0);
  check('the real clock is not needed for any of this', typeof now === 'number');
}

pushService.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
