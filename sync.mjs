// Putting two copies of one championship back together.
// Pure functions only — used by the app in the browser and by the server.
//
// Two phones both hold the whole championship and both go on entering scores,
// sometimes with no signal. When they meet again neither copy is "right", so
// they are merged rather than one overwriting the other:
//
//   a match      — the copy touched last wins, match by match, so two people
//                  entering two different results both keep theirs
//   the field    — the name, the players, the sports and the stand-ins move
//                  together, and the copy edited last wins the lot; editing
//                  the roster in two places at once is rare, entering scores
//                  at the same time is not
//   a deletion   — remembered as a date, so a match deleted on one phone does
//                  not come back from the other
//
// Everything is decided by timestamps the phones set themselves. Clocks can
// disagree by a few seconds; for a scoreboard that is harmless.

export const stamp = (value) => {
  const ms = Date.parse(value || 0);
  return Number.isNaN(ms) ? 0 : ms;
};

/** The removal list of both copies, each id kept at its latest removal. */
export function mergeRemoved(mine = {}, theirs = {}) {
  const out = { ...mine };
  for (const [id, at] of Object.entries(theirs || {})) {
    if (!out[id] || stamp(at) > stamp(out[id])) out[id] = at;
  }
  return out;
}

/** Matches from both copies: the one touched last wins, per match. */
export function mergeMatches(mine = [], theirs = [], removed = {}) {
  const byId = new Map();
  for (const match of [...mine, ...theirs]) {
    const held = byId.get(match.id);
    if (!held || stamp(match.updatedAt) > stamp(held.updatedAt)) byId.set(match.id, match);
  }
  // a match deleted after it was last touched stays deleted
  for (const [id, match] of byId) {
    if (removed[id] && stamp(removed[id]) >= stamp(match.updatedAt)) byId.delete(id);
  }
  return [...byId.values()];
}

/**
 * One championship out of two. Neither argument is changed.
 * `mine` wins a dead heat, so merging a copy into itself changes nothing.
 */
export function mergeChampionships(mine, theirs) {
  if (!theirs) return mine;
  if (!mine) return theirs;

  const removed = mergeRemoved(mine.removed, theirs.removed);
  const matches = mergeMatches(mine.matches, theirs.matches, removed);

  // the field moves as one piece: whoever edited it last has the whole of it
  const field = stamp(theirs.metaAt) > stamp(mine.metaAt) ? theirs : mine;

  return {
    ...field,
    id: mine.id || theirs.id,
    code: mine.code || theirs.code,
    createdAt: mine.createdAt || theirs.createdAt,
    removed,
    matches,
    nextMatchNo: Math.max(mine.nextMatchNo || 0, theirs.nextMatchNo || 0),
    updatedAt:
      stamp(theirs.updatedAt) > stamp(mine.updatedAt) ? theirs.updatedAt : mine.updatedAt,
  };
}

/* A join code is read aloud across a padel court, so the letters and digits
   that get misheard for each other are left out: no O/0, I/1, S/5, B/8. */
const CODE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXYZ234679';

export function makeCode(random = Math.random) {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return out;
}

export function isCode(value) {
  return typeof value === 'string' && /^[ACDEFGHJKLMNPQRTUVWXYZ234679]{6}$/.test(value.toUpperCase());
}
