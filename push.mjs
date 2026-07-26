// Telling everybody something, on the phones that asked to be told.
//
// A phone that turns notifications on hands over a subscription — an address
// at its own browser maker's push service, plus two keys. We keep that beside
// the championship it belongs to. Nothing in it identifies a person; it is a
// postbox, and it stops working the moment the phone says so.
//
// Which sport is due is worked out here rather than in the browser, because a
// phone in a pocket with the screen off is not running anything.

import webpush from 'web-push';

/** The window a booked time counts as "now", so a late check still sends. */
export const DUE_WINDOW_MS = 10 * 60 * 1000;

export function configure({ publicKey, privateKey, contact = 'mailto:nobody@example.com' }) {
  webpush.setVapidDetails(contact, publicKey, privateKey);
}

export const generateKeys = () => webpush.generateVAPIDKeys();

/**
 * Send one message to many phones. A phone that has uninstalled the app, or
 * turned notifications off, answers 404 or 410 — those subscriptions are
 * reported back so the caller can forget them rather than keep trying.
 */
export async function sendToAll(subscriptions, payload, send) {
  // bound, because web-push's own method needs its object to work
  const deliver = send || ((sub, text) => webpush.sendNotification(sub, text));
  const text = JSON.stringify(payload);
  const gone = [];
  let delivered = 0;

  await Promise.all(
    (subscriptions || []).map(async (sub) => {
      try {
        await deliver(sub, text);
        delivered += 1;
      } catch (error) {
        const code = error && (error.statusCode || error.status);
        if (code === 404 || code === 410) gone.push(sub.endpoint);
        // any other failure is the push service having a bad day; leave it be
      }
    })
  );

  return { delivered, gone };
}

/** A subscription is only worth keeping if it can actually be posted to. */
export function isSubscription(value) {
  return Boolean(
    value &&
      typeof value.endpoint === 'string' &&
      /^https:\/\//.test(value.endpoint) &&
      value.keys &&
      typeof value.keys.p256dh === 'string' &&
      typeof value.keys.auth === 'string'
  );
}

const clock = (when) =>
  new Date(when).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * What everybody should be told right now, if anything.
 *
 * A sport is announced once, when its booked time arrives. `announced` is the
 * championship's own memory of what has already gone out, so a restart or a
 * second server cannot send the same message twice.
 */
export function dueMessages(champ, now = Date.now()) {
  const announced = champ.announced || {};
  const out = [];

  for (const sport of champ.sports || []) {
    if (!sport.time || announced[sport.id]) continue;
    const at = Date.parse(sport.time);
    if (Number.isNaN(at)) continue;
    if (at > now || now - at > DUE_WINDOW_MS) continue;

    const matches = (champ.matches || []).filter((m) => m.sportId === sport.id);
    const left = matches.filter((m) => !m.done).length;
    out.push({
      key: sport.id,
      title: `${sport.name} — ${clock(at)}`,
      body: left
        ? `${champ.name}: time for ${sport.name}. ${left} ${left === 1 ? 'match' : 'matches'} to play.`
        : `${champ.name}: time for ${sport.name}.`,
    });
  }
  return out;
}
