// Tournament engine: roster, the programme and the standings.
// Pure functions only — no DOM, no storage. Imported by app.js and by test.mjs.

export const WIN_POINTS = 3;
export const DRAW_POINTS = 1;
export const LOSS_POINTS = 0;

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
  { id: '1v1', label: '1 v 1', note: 'Singles, everyone meets everyone', min: 2 },
  { id: '2v2', label: '2 v 2', note: 'Doubles, partners rotate', min: 4 },
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
  { id: 'match', label: 'Win = 3', note: 'Draw 1, loss 0' },
  { id: 'score', label: 'Score counts', note: 'Every point you score' },
];

export function scoringLabel(id) {
  const found = SCORINGS.find((s) => s.id === id);
  return found ? found.label : SCORINGS[0].label;
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

/* ---------------------------- the programme ----------------------------- */

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
 * A full round robin by the circle method: every player meets every other
 * player exactly once, and the rounds spread a player's matches out instead of
 * stacking them back to back.
 */
export function singlesFixtures(ids) {
  if (ids.length < 2) return [];
  const BYE = Symbol('bye');
  const wheel = ids.slice();
  if (wheel.length % 2) wheel.push(BYE);
  const n = wheel.length;
  const out = [];

  for (let round = 0; round < n - 1; round++) {
    for (let i = 0; i < n / 2; i++) {
      const a = wheel[i];
      const b = wheel[n - 1 - i];
      if (a !== BYE && b !== BYE) out.push([[a], [b]]);
    }
    wheel.splice(1, 0, wheel.pop()); // hold the first seat, rotate the rest
  }
  return out;
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

/**
 * The sides of every match this sport needs, built from its format. This is
 * what makes the app set up the championship itself: you choose the format,
 * it works out who plays whom.
 */
export function fixturesFor(playerIds, format) {
  if (format === 'ffa') return playerIds.length >= 2 ? [playerIds.map((id) => [id])] : [];
  if (format === '2v2') return doublesFixtures(playerIds);
  return singlesFixtures(playerIds);
}

/** How many matches a format produces — used by the setup preview. */
export function fixtureCount(playerCount, format) {
  const ids = Array.from({ length: playerCount }, (_, i) => `p${i + 1}`);
  return fixturesFor(ids, format).length;
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

/** Build (or rebuild) the programme for one sport. Other sports are untouched. */
export function buildProgramme(state, sportId) {
  const sport = state.sports.find((s) => s.id === sportId);
  if (!sport) return [];
  const ids = state.players.map((p) => p.id);
  return fixturesFor(ids, sport.format).map((sides) => makeMatch(state, sportId, sides));
}

/** The whole championship, every sport, from scratch. */
export function buildAllProgrammes(state) {
  state.nextMatchNo = 0;
  state.matches = state.sports.flatMap((sport) => buildProgramme(state, sport.id));
  return state.matches;
}

/* ------------------------- hand-picked extra match ----------------------- */

/** A hand-added match is only playable with full, non-overlapping sides. */
export function validateMatch(teamA, teamB, format) {
  const size = teamSize(format);
  if (teamA.length !== size || teamB.length !== size) {
    return size === 1 ? 'Pick one player on each side.' : 'Pick two players on each side.';
  }
  const everyone = [...teamA, ...teamB];
  if (new Set(everyone).size !== everyone.length) return 'Nobody can play against themselves.';
  return null;
}

export function createMatch(state, sportId, teamA, teamB) {
  const sport = state.sports.find((s) => s.id === sportId);
  const error = validateMatch(teamA, teamB, sport ? sport.format : '1v1');
  if (error) throw new Error(error);
  return makeMatch(state, sportId, [teamA, teamB]);
}

/* ------------------------------- standings ------------------------------- */

export function matchPointsFor(scoreFor, scoreAgainst) {
  if (scoreFor > scoreAgainst) return WIN_POINTS;
  if (scoreFor === scoreAgainst) return DRAW_POINTS;
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
 * Each sport carries its own point type: 'match' rewards the result (3/1/0),
 * 'score' counts every point a player put on the board.
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
        row.points += scoring === 'score' ? scoreFor : matchPointsFor(scoreFor, against);
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
