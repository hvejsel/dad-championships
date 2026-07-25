// Tournament engine: roster, the programme and the standings.
// Pure functions only — no DOM, no storage. Imported by app.js and by test.mjs.

export const DEFAULT_WIN_POINTS = 3;
export const DRAW_POINTS = 1;
export const LOSS_POINTS = 0;
export const DEFAULT_NAME = 'Dad Championships';

/** What a win can be worth. Chosen per sport, so a sport can carry more weight. */
export const WIN_POINT_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 50];

// Three generations play the same championship.
export const GENERATIONS = [
  { id: 'dad', label: 'Dad' },
  { id: 'granddad', label: 'Granddad' },
  { id: 'kid', label: 'Kid' },
];

export function generationLabel(id) {
  const found = GENERATIONS.find((g) => g.id === id);
  return found ? found.label : GENERATIONS[0].label;
}

/**
 * How a sport is played. 1v1 and 2v2 are two sides facing each other; ffa puts
 * everybody on the course at the same time, which is how mini golf is played.
 */
export const FORMATS = [
  { id: '1v1', label: '1 v 1', note: 'Singles, one match each', min: 2 },
  { id: '2v2', label: '2 v 2', note: 'Doubles, one score per team', min: 4 },
  { id: 'ffa', label: 'All vs all', note: 'One round, everybody at once', min: 2 },
];

export function formatLabel(id) {
  const found = FORMATS.find((f) => f.id === id);
  return found ? found.label : FORMATS[0].label;
}

export function isFreeForAll(format) {
  return format === 'ffa';
}

/** How many players belong on one side of a match in this format. */
export function teamSize(format) {
  return format === '2v2' ? 2 : 1;
}

/** How many players a full match of this format needs. */
export function matchSize(format) {
  return teamSize(format) * 2;
}

/** How points are handed out. Set per sport, not per championship. */
export const SCORINGS = [
  { id: 'match', label: 'Winner gets points', note: 'The winner takes the points you set' },
  { id: 'score', label: 'Score counts', note: 'Every point you score' },
];

export function scoringLabel(id) {
  const found = SCORINGS.find((s) => s.id === id);
  return found ? found.label : SCORINGS[0].label;
}

/** The short summary of a sport's point type, for a list row. */
export function scoringSummary(sport) {
  if (sport.scoring === 'score') return 'Score counts';
  const points = sport.winPoints || DEFAULT_WIN_POINTS;
  return `Win = ${points}`;
}

/** What one side of a match is called, so a score is labelled correctly. */
export function sideLabel(format) {
  return format === '2v2' ? 'team' : 'player';
}

/* --------------------------------- logo ---------------------------------- */

const SMALL_WORDS = ['the', 'of', 'and', 'og', 'de', 'la', 'a'];

/**
 * The monogram for the crest, taken from the championship's own name:
 * "Hvejsel Family Cup" gives HFC, a single word gives its first two letters.
 */
export function championshipInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'DC';
  if (words.length === 1) return [...words[0]].slice(0, 2).join('').toUpperCase();
  const letters = words
    .filter((w, i) => i === 0 || !SMALL_WORDS.includes(w.toLowerCase()))
    .map((w) => [...w][0])
    .join('')
    .toUpperCase();
  return (letters || 'DC').slice(0, 3);
}

/* --------------------------- the running order --------------------------- */

/**
 * Sports run in the order they were given a time; anything without a time
 * follows in the order it was added. The list answers "what happens next".
 */
export function orderedSports(sports) {
  return sports.slice().sort((a, b) => {
    if (a.time && b.time) return a.time.localeCompare(b.time) || a.order - b.order;
    if (a.time) return -1;
    if (b.time) return 1;
    return a.order - b.order;
  });
}

/** The order the sports were added in — the order the programme is drawn in. */
export function sportsByOrder(sports) {
  return sports.slice().sort((a, b) => a.order - b.order);
}

export function matchesForSport(matches, sportId) {
  return matches.filter((m) => m.sportId === sportId);
}

/** Every match of the championship, in the order they will be played. */
export function orderedMatches(state) {
  const out = [];
  for (const sport of orderedSports(state.sports)) {
    for (const match of matchesForSport(state.matches, sport.id)) out.push(match);
  }
  return out;
}

/* ----------------------------- the rotation ------------------------------ */

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Every unordered pair of ids, in a stable order. */
export function allPairs(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]]);
  }
  return out;
}

/**
 * The rounds of a full round robin, by the circle method. One round gives every
 * player exactly one match (with an odd number, one is left over for a Pedro
 * match), and the rounds together cover every pairing exactly once.
 */
export function singlesRounds(ids) {
  if (ids.length < 2) return [];
  const BYE = '__bye';
  const wheel = ids.slice();
  if (wheel.length % 2) wheel.push(BYE);
  const n = wheel.length;
  const rounds = [];

  for (let round = 0; round < n - 1; round++) {
    const matches = [];
    for (let i = 0; i < n / 2; i++) {
      const a = wheel[i];
      const b = wheel[n - 1 - i];
      if (a !== BYE && b !== BYE) matches.push([[a], [b]]);
    }
    rounds.push(matches);
    wheel.splice(1, 0, wheel.pop()); // hold the first seat, rotate the rest
  }
  return rounds;
}

/**
 * Doubles. Every possible partnership is used once, and each partnership is
 * put up against the pair its four players have met the least — so nobody is
 * stuck with the same partner or the same opponents all day.
 */
export function doublesFixtures(ids) {
  if (ids.length < 4) return [];
  const pool = allPairs(ids).map((pair) => ({ pair, used: false }));
  const met = new Map();
  const timesMet = (a, b) => met.get(pairKey(a, b)) || 0;
  const out = [];

  const cost = (left, right) => {
    let total = 0;
    for (const a of left) for (const b of right) total += timesMet(a, b);
    return total;
  };

  // The opponent for a partnership is the free pair its four players have met
  // the least. `reuse` allows an already-scheduled pair as a last resort, so a
  // leftover partnership still gets a match rather than being dropped.
  const opponentFor = (entry, reuse) => {
    let best = null;
    let bestCost = Infinity;
    for (const other of pool) {
      if (other === entry) continue;
      if (!reuse && other.used) continue;
      if (other.pair.some((id) => entry.pair.includes(id))) continue;
      const c = cost(entry.pair, other.pair);
      if (c < bestCost) {
        bestCost = c;
        best = other;
      }
    }
    return best;
  };

  const schedule = (entry, other) => {
    entry.used = true;
    other.used = true;
    for (const a of entry.pair) {
      for (const b of other.pair) met.set(pairKey(a, b), timesMet(a, b) + 1);
    }
    out.push([entry.pair.slice(), other.pair.slice()]);
  };

  for (const entry of pool) {
    if (entry.used) continue;
    const other = opponentFor(entry, false);
    if (other) schedule(entry, other);
  }
  // An odd number of partnerships leaves one over; give it a match too, so
  // everybody really does partner everybody.
  for (const entry of pool) {
    if (entry.used) continue;
    const other = opponentFor(entry, true);
    if (other) schedule(entry, other);
  }
  return out;
}

/** Deal matches into rounds so no player appears twice in the same round. */
function packIntoRounds(matches) {
  const rounds = [];
  for (const sides of matches) {
    const players = sides.flat();
    let round = rounds.find((r) => !r.some((m) => m.flat().some((id) => players.includes(id))));
    if (!round) {
      round = [];
      rounds.push(round);
    }
    round.push(sides);
  }
  return rounds;
}

/**
 * The rounds this format can be played in. A sport plays exactly ONE of these
 * rounds, so every player has one opponent per sport; the sports together work
 * through the rounds until everyone has met everyone.
 */
export function roundsFor(playerIds, format) {
  if (format === 'ffa') return playerIds.length >= 2 ? [[playerIds.map((id) => [id])]] : [];
  if (format === '2v2') return packIntoRounds(doublesFixtures(playerIds));
  return singlesRounds(playerIds);
}

/**
 * Who faced whom head to head, as a set of pair keys. An all-vs-all round puts
 * everybody on the course at once rather than giving anyone a named opponent,
 * so it does not count as having met — those sports are skipped here.
 */
function metPairsIn(matches, skipSportId = null) {
  const met = new Set();
  for (const match of matches) {
    if (skipSportId && match.sportId === skipSportId) continue;
    if (match.sides.length !== 2) continue;
    for (let i = 0; i < match.sides.length; i++) {
      for (let j = i + 1; j < match.sides.length; j++) {
        for (const a of match.sides[i].players) {
          for (const b of match.sides[j].players) met.add(pairKey(a, b));
        }
      }
    }
  }
  return met;
}

function newPairsInRound(round, met) {
  const fresh = new Set();
  for (const sides of round) {
    for (let i = 0; i < sides.length; i++) {
      for (let j = i + 1; j < sides.length; j++) {
        for (const a of sides[i]) {
          for (const b of sides[j]) {
            const key = pairKey(a, b);
            if (!met.has(key)) fresh.add(key);
          }
        }
      }
    }
  }
  return fresh.size;
}

/**
 * How far the championship has got towards everyone having met everyone, and
 * which pairings are still missing. This is what another sport buys you.
 */
export function pairCoverage(state) {
  const ids = state.players.map((p) => p.id);
  const met = metPairsIn(state.matches);
  const missing = allPairs(ids).filter(([a, b]) => !met.has(pairKey(a, b)));
  const total = (ids.length * (ids.length - 1)) / 2;
  return { met: total - missing.length, total, missing };
}

/** Nobody should ever sit a sport out; if this is not empty, something is off. */
export function playersSittingOut(state, sportId) {
  const playing = new Set();
  for (const match of matchesForSport(state.matches, sportId)) {
    for (const side of match.sides) for (const id of side.players) playing.add(id);
  }
  return state.players.filter((p) => !playing.has(p.id));
}

function makeMatch(state, sportId, sides, pedro = false) {
  state.nextMatchNo = (state.nextMatchNo || 0) + 1;
  return {
    id: `m${state.nextMatchNo}`,
    sportId,
    sides: sides.map((players) => ({ players: players.slice(), score: null })),
    done: false,
    pedro,
  };
}

/* -------------------------------- Pedro ---------------------------------- */
/* Pedro is whoever steps in when the numbers do not go up. With an odd number
   of players one is left without an opponent, and Pedro is simply the last
   player on the list, who plays that one extra match. Pedro can also be
   somebody who is not in the championship at all — a stand-in who fills the
   spot so nobody sits out, and who plays for nothing.                       */

export const DEFAULT_STAND_IN = 'Pedro';

/** The stand-ins: they can be picked for a match, but never for the table. */
export function standInsOf(state) {
  return Array.isArray(state.standIns) ? state.standIns : [];
}

export function isStandIn(state, id) {
  return standInsOf(state).some((s) => s.id === id);
}

/** Everyone who can be picked for a match: the players, then the stand-ins. */
export function entrantsOf(state) {
  return [...state.players, ...standInsOf(state).map((s) => ({ ...s, standIn: true }))];
}

export function entrantName(state, id) {
  const found = entrantsOf(state).find((e) => e.id === id);
  return found ? found.name : '?';
}

/**
 * Nobody sits a sport out. Whoever the round leaves over plays one extra match,
 * and the spot beside them is filled from the END of the player list — so
 * Pedro is simply the last player, the same one every time rather than a
 * different name at every draw. Swap in a stand-in from the match editor when
 * Pedro should be somebody who is not in the championship.
 */
function pedroMatchesFor(state, sport, leftOut, playing) {
  const size = matchSize(sport.format);
  const perSide = teamSize(sport.format);
  const out = [];
  let waiting = leftOut.slice();

  // The player list read backwards, so Pedro is the LAST player on the list —
  // the order of the draw must not decide who it is.
  const fromTheEnd = state.players
    .map((p) => p.id)
    .filter((id) => playing.includes(id))
    .reverse();

  while (waiting.length) {
    const chunk = waiting.slice(0, size);
    waiting = waiting.slice(size);
    const fillers = fromTheEnd.filter((id) => !chunk.includes(id)).slice(0, size - chunk.length);
    if (chunk.length + fillers.length < size) break; // too few players for a match
    const pool = [...chunk, ...fillers];
    out.push(makeMatch(state, sport.id, [pool.slice(0, perSide), pool.slice(perSide, size)], true));
  }
  return out;
}

/** Every Pedro match in the championship. */
export function pedroMatches(matches) {
  return matches.filter((m) => m.pedro);
}

/** How the extra matches are going. Their points count like any other match. */
export function pedroStatus(state) {
  const list = pedroMatches(state.matches);
  return {
    matches: list,
    total: list.length,
    done: list.filter((m) => m.done).length,
  };
}

/* --------------------------- editing a match ----------------------------- */

/** A match is only playable with full, non-overlapping sides. */
export function validateSides(sides, format) {
  const lists = sides.map((side) => (Array.isArray(side) ? side : side.players));
  const ids = lists.flat();

  if (isFreeForAll(format)) {
    if (ids.length < 2) return 'At least two players have to be in the round.';
    if (new Set(ids).size !== ids.length) return 'A player can only be in the round once.';
    return null;
  }
  const size = teamSize(format);
  if (lists.length !== 2) return 'A match has two sides.';
  if (lists.some((list) => list.length !== size || list.some((id) => !id))) {
    return size === 1 ? 'Pick one player on each side.' : 'Pick two players on each side.';
  }
  if (new Set(ids).size !== ids.length) return 'Nobody can play against himself.';
  return null;
}

/** A match added by hand: the first players who have not met yet. */
export function createMatch(state, sportId, sides = null, pedro = false) {
  const sport = state.sports.find((s) => s.id === sportId);
  const format = sport ? sport.format : '1v1';
  let chosen = sides;

  if (!chosen) {
    const ids = state.players.map((p) => p.id);
    if (isFreeForAll(format)) {
      chosen = ids.map((id) => [id]);
    } else {
      const met = metPairsIn(state.matches);
      const fresh = allPairs(ids).find(([a, b]) => !met.has(pairKey(a, b)));
      const order = fresh ? [...fresh, ...ids.filter((id) => !fresh.includes(id))] : ids;
      const size = matchSize(format);
      const perSide = teamSize(format);
      const pool = order.slice(0, size);
      chosen = [pool.slice(0, perSide), pool.slice(perSide, size)];
    }
  }
  const error = validateSides(chosen, format);
  if (error) throw new Error(error);
  return makeMatch(state, sportId, chosen, pedro);
}

/**
 * The matches for one sport: the round that brings the most new pairings, plus
 * a Pedro match for whoever the round leaves over. Other sports are untouched.
 */
export function buildProgramme(state, sportId) {
  const sport = state.sports.find((s) => s.id === sportId);
  if (!sport) return [];
  const ids = state.players.map((p) => p.id);
  const rounds = roundsFor(ids, sport.format);
  if (!rounds.length) return [];

  const met = metPairsIn(state.matches, sportId);
  let bestIndex = 0;
  let bestFresh = -1;
  rounds.forEach((round, index) => {
    const fresh = newPairsInRound(round, met);
    if (fresh > bestFresh) {
      bestFresh = fresh;
      bestIndex = index;
    }
  });

  const round = rounds[bestIndex];
  const matches = round.map((sides) => makeMatch(state, sportId, sides));
  const playing = round.flat(2);
  const leftOut = ids.filter((id) => !playing.includes(id));
  if (leftOut.length) {
    // The state the Pedro pick reads has to include the matches just drawn.
    const draft = { ...state, matches: [...state.matches, ...matches] };
    matches.push(...pedroMatchesFor(draft, sport, leftOut, playing));
    state.nextMatchNo = draft.nextMatchNo;
  }
  return matches;
}

/** The whole championship, every sport, from scratch and in the order added. */
export function buildAllProgrammes(state) {
  state.nextMatchNo = 0;
  state.matches = [];
  for (const sport of sportsByOrder(state.sports)) {
    state.matches.push(...buildProgramme(state, sport.id));
  }
  return state.matches;
}

/** How many matches one sport holds, Pedro match included. */
export function matchesPerSport(playerCount, format) {
  const ids = Array.from({ length: playerCount }, (_, i) => `p${i + 1}`);
  const rounds = roundsFor(ids, format);
  if (!rounds.length) return 0;
  const playing = rounds[0].flat(2).length;
  const leftOver = playerCount - playing;
  return rounds[0].length + (leftOver > 0 ? Math.ceil(leftOver / matchSize(format)) : 0);
}

/** Whether this game type leaves somebody over, who then gets a Pedro match. */
export function pedroNeeded(playerCount, format) {
  if (format === 'ffa') return false;
  const ids = Array.from({ length: playerCount }, (_, i) => `p${i + 1}`);
  const rounds = roundsFor(ids, format);
  if (!rounds.length) return false;
  return rounds[0].flat(2).length < playerCount;
}

/** How many sports of this game type it takes before everyone has met everyone. */
export function sportsToCoverEveryone(playerCount, format) {
  if (format === 'ffa') return playerCount >= 2 ? 1 : 0;
  const ids = Array.from({ length: playerCount }, (_, i) => `p${i + 1}`);
  return roundsFor(ids, format).length;
}

/* ------------------------------- standings ------------------------------- */

export function matchPointsFor(scoreFor, scoreAgainst, winPoints = DEFAULT_WIN_POINTS) {
  if (scoreFor > scoreAgainst) return winPoints;
  // A draw is worth a point, unless a win is only worth one itself.
  if (scoreFor === scoreAgainst) return winPoints > 1 ? DRAW_POINTS : 0;
  return LOSS_POINTS;
}

/** Everyone on a side, whatever the format. */
export function playersInMatch(match) {
  return match.sides.flatMap((side) => side.players);
}

/** The side that won, or null while the match is unplayed or tied at the top. */
export function winningSide(match) {
  if (!match.done) return null;
  const best = Math.max(...match.sides.map((s) => s.score ?? 0));
  const leaders = match.sides.filter((s) => (s.score ?? 0) === best);
  return leaders.length === 1 ? leaders[0] : null;
}

/**
 * Standings for the whole championship, or for one sport when sportId is given.
 * Each sport carries its own point type: 'match' gives the winner the points
 * that sport is worth, 'score' counts every point a player put on the board.
 *
 * Every match counts the same, the extra Pedro match included. A stand-in has
 * no row here — they fill a spot so nobody sits out, they do not compete.
 */
export function standings(state, sportId = null) {
  const rows = new Map(
    state.players.map((p) => [
      p.id,
      {
        playerId: p.id,
        name: p.name,
        generation: p.generation,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        diff: 0,
        points: 0,
      },
    ])
  );

  for (const match of state.matches) {
    if (!match.done) continue;
    if (sportId && match.sportId !== sportId) continue;

    const sport = state.sports.find((s) => s.id === match.sportId);
    const scoring = (sport && sport.scoring) || 'match';
    const winPoints = (sport && sport.winPoints) || DEFAULT_WIN_POINTS;
    const scores = match.sides.map((side) => side.score ?? 0);

    match.sides.forEach((side, index) => {
      // What you were up against: the best score anyone else put up.
      const others = scores.filter((_, i) => i !== index);
      const against = others.length ? Math.max(...others) : 0;
      const scoreFor = scores[index];

      for (const playerId of side.players) {
        const row = rows.get(playerId);
        if (!row) continue;
        row.played += 1;
        row.pointsFor += scoreFor;
        row.pointsAgainst += against;
        row.diff = row.pointsFor - row.pointsAgainst;
        if (scoreFor > against) row.won += 1;
        else if (scoreFor === against) row.drawn += 1;
        else row.lost += 1;
        row.points += scoring === 'score' ? scoreFor : matchPointsFor(scoreFor, against, winPoints);
      }
    });
  }

  return [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.diff - a.diff ||
      b.pointsFor - a.pointsFor ||
      a.name.localeCompare(b.name)
  );
}

/* ---------------------------- editing the field --------------------------- */
/* The field is not fixed once the championship starts: somebody turns up late,
   somebody has to leave, and a name gets spelled wrong. All three are ordinary
   and none of them should cost you the day's results.                        */

/** The next free id in a series, so a re-used id can never collide. */
function nextId(existing, prefix) {
  const highest = existing.reduce((max, item) => {
    const n = Number(String(item.id).replace(prefix, ''));
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `${prefix}${highest + 1}`;
}

export function addPlayer(state, name, generation = 'dad') {
  const player = {
    id: nextId(state.players, 'p'),
    name: String(name || '').trim() || `Player ${state.players.length + 1}`,
    generation,
  };
  state.players.push(player);
  return player;
}

export function addStandIn(state, name) {
  if (!Array.isArray(state.standIns)) state.standIns = [];
  const standIn = {
    id: nextId(state.standIns, 'x'),
    name: String(name || '').trim() || DEFAULT_STAND_IN,
  };
  state.standIns.push(standIn);
  return standIn;
}

/** Every match somebody appears in — what taking them out would cost. */
export function matchesWith(state, id) {
  return state.matches.filter((m) => playersInMatch(m).includes(id));
}

/**
 * Take somebody out of the championship. Their matches go with them, because a
 * match with an empty side cannot be played or scored — every other result is
 * left exactly as it was.
 */
export function removeEntrant(state, id) {
  const removed = matchesWith(state, id).length;
  state.players = state.players.filter((p) => p.id !== id);
  state.standIns = standInsOf(state).filter((s) => s.id !== id);
  state.matches = state.matches.filter((m) => !playersInMatch(m).includes(id));
  return removed;
}

/** Where one sport has got to: played, total, and whether it is finished. */
export function sportProgress(state, sportId) {
  const list = matchesForSport(state.matches, sportId);
  const done = list.filter((m) => m.done).length;
  return { done, total: list.length, complete: list.length > 0 && done === list.length };
}

/** The next match still to be played, following the running order. */
export function nextUnplayed(state) {
  return orderedMatches(state).find((m) => !m.done) || null;
}

export function progress(matches) {
  const done = matches.filter((m) => m.done).length;
  return { done, total: matches.length };
}

/* ------------------------------- storage -------------------------------- */

/**
 * A booked time is "YYYY-MM-DDTHH:MM" — the shape a phone's own date-and-time
 * picker speaks, and a shape that sorts chronologically as plain text.
 * A bare "HH:MM" from an older save is given the day the championship started.
 */
export function upgradeTime(value, createdAt) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value.slice(0, 16);
  const clock = /^(\d{2}):(\d{2})$/.exec(value);
  if (!clock) return null;
  const day = createdAt ? new Date(createdAt) : new Date();
  const date = Number.isNaN(day.getTime()) ? new Date() : day;
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
  return `${iso}T${clock[1]}:${clock[2]}`;
}

export const STATE_VERSION = 7;

/**
 * Bring a championship saved by an older version of the app up to date, in
 * place, so a running championship survives an update instead of being lost.
 * Anything already played is kept exactly as it was.
 */
export function migrateState(saved) {
  if (!saved || !Array.isArray(saved.players) || !Array.isArray(saved.sports)) return null;

  const sports = saved.sports.map((sport, i) => ({
    id: sport.id || `s${i + 1}`,
    name: sport.name || `Sport ${i + 1}`,
    order: typeof sport.order === 'number' ? sport.order : i,
    format: sport.format || '1v1',
    // point type used to live on the championship; keep what was chosen there
    scoring: sport.scoring || saved.scoring || 'match',
    winPoints: sport.winPoints || DEFAULT_WIN_POINTS,
    // a time used to be a clock time alone; a championship can run over more
    // than one day, so it is now a date and a time — the day it was set up
    time: upgradeTime(sport.time, saved.createdAt),
  }));

  const matches = (saved.matches || []).map((match, i) => {
    // matches used to be two named teams with two scores
    const sides = match.sides
      ? match.sides.map((side) => ({ players: side.players.slice(), score: side.score ?? null }))
      : [
          { players: (match.teamA || []).slice(), score: match.scoreA ?? null },
          { players: (match.teamB || []).slice(), score: match.scoreB ?? null },
        ];
    return {
      id: match.id || `m${i + 1}`,
      sportId: match.sportId,
      sides,
      done: Boolean(match.done),
      pedro: Boolean(match.pedro),
      updatedAt: match.updatedAt || null,
    };
  });

  // stand-ins arrived with version 6; every championship gets a Pedro
  const standIns = Array.isArray(saved.standIns) && saved.standIns.length
    ? saved.standIns.map((s, i) => ({ id: s.id || `x${i + 1}`, name: s.name || DEFAULT_STAND_IN }))
    : [{ id: 'x1', name: DEFAULT_STAND_IN }];

  return {
    version: STATE_VERSION,
    // the championship's own identity has to survive a trip through a file or
    // a link, or the phone at the other end cannot tell a copy of one it
    // already has from a brand new championship
    id: saved.id || null,
    // the code a shared championship is reached by, and the stamps the merge
    // needs to tell two copies apart
    code: saved.code || null,
    name: saved.name || DEFAULT_NAME,
    createdAt: saved.createdAt || null,
    updatedAt: saved.updatedAt || null,
    metaAt: saved.metaAt || saved.updatedAt || null,
    removed: saved.removed && typeof saved.removed === 'object' ? { ...saved.removed } : {},
    players: saved.players.map((p, i) => ({
      id: p.id || `p${i + 1}`,
      name: p.name || `Player ${i + 1}`,
      generation: p.generation || 'dad',
    })),
    standIns,
    sports,
    matches,
    nextMatchNo: saved.nextMatchNo || matches.length,
  };
}
