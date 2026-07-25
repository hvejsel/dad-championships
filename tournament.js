// Tournament engine: roster, the programme and the standings.
// Pure functions only — no DOM, no storage. Imported by app.js and by test.mjs.

export const DEFAULT_WIN_POINTS = 3;
export const DRAW_POINTS = 1;
export const LOSS_POINTS = 0;

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
  { id: '2v2', label: '2 v 2', note: 'Doubles, one match each', min: 4 },
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
 * player exactly one match (with an odd number, one player sits out), and the
 * rounds together cover every pairing exactly once.
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

/** In an odd field somebody has to sit a sport out. */
export function playersSittingOut(state, sportId) {
  const playing = new Set();
  for (const match of matchesForSport(state.matches, sportId)) {
    for (const side of match.sides) for (const id of side.players) playing.add(id);
  }
  return state.players.filter((p) => !playing.has(p.id));
}

function makeMatch(state, sportId, sides) {
  state.nextMatchNo = (state.nextMatchNo || 0) + 1;
  return {
    id: `m${state.nextMatchNo}`,
    sportId,
    sides: sides.map((players) => ({ players: players.slice(), score: null })),
    done: false,
  };
}

/**
 * The matches for one sport: the round that brings the most new pairings, so
 * the sports together work towards everyone having played everyone. Other
 * sports are left alone.
 */
export function buildProgramme(state, sportId) {
  const sport = state.sports.find((s) => s.id === sportId);
  if (!sport) return [];
  const rounds = roundsFor(state.players.map((p) => p.id), sport.format);
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

  return rounds[bestIndex].map((sides) => makeMatch(state, sportId, sides));
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

/** How many matches one sport holds — one per player, two players per match. */
export function matchesPerSport(playerCount, format) {
  const ids = Array.from({ length: playerCount }, (_, i) => `p${i + 1}`);
  const rounds = roundsFor(ids, format);
  return rounds.length ? rounds[0].length : 0;
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

/** The next match still to be played, following the running order. */
export function nextUnplayed(state) {
  return orderedMatches(state).find((m) => !m.done) || null;
}

export function progress(matches) {
  const done = matches.filter((m) => m.done).length;
  return { done, total: matches.length };
}

/* ------------------------------- storage -------------------------------- */

export const STATE_VERSION = 4;

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
    time: sport.time || null,
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
    };
  });

  return {
    version: STATE_VERSION,
    createdAt: saved.createdAt || null,
    players: saved.players.map((p, i) => ({
      id: p.id || `p${i + 1}`,
      name: p.name || `Player ${i + 1}`,
      generation: p.generation || 'dad',
    })),
    sports,
    matches,
    nextMatchNo: saved.nextMatchNo || matches.length,
  };
}
