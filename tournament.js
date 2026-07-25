// Tournament engine: roster, fixtures and standings.
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

/** How many players belong on one side of a match in this format. */
export function teamSize(format) {
  return format === '2v2' ? 2 : 1;
}

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

/** Every match of this sport, in the order they were added. */
export function orderedMatches(state) {
  const out = [];
  for (const sport of orderedSports(state.sports)) {
    for (const match of matchesForSport(state.matches, sport.id)) out.push(match);
  }
  return out;
}

/**
 * Who has not been given an opponent in this sport yet. Opponents are chosen
 * by hand, so this is the reminder that somebody is still sitting out.
 */
export function unassignedPlayers(state, sportId) {
  const busy = new Set();
  for (const match of matchesForSport(state.matches, sportId)) {
    for (const id of [...match.teamA, ...match.teamB]) busy.add(id);
  }
  return state.players.filter((p) => !busy.has(p.id));
}

/** A match is only playable with full, non-overlapping sides. */
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
  state.nextMatchNo = (state.nextMatchNo || 0) + 1;
  return {
    id: `m${state.nextMatchNo}`,
    sportId,
    teamA: teamA.slice(),
    teamB: teamB.slice(),
    scoreA: null,
    scoreB: null,
    done: false,
  };
}

export function matchPointsFor(scoreFor, scoreAgainst) {
  if (scoreFor > scoreAgainst) return WIN_POINTS;
  if (scoreFor === scoreAgainst) return DRAW_POINTS;
  return LOSS_POINTS;
}

/**
 * Standings for the whole championship, or for one sport when sportId is given.
 * scoring 'match' rewards results (3/1/0); scoring 'score' counts every point
 * a player's team put on the board.
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
    const sides = [
      { team: match.teamA, scoreFor: match.scoreA, scoreAgainst: match.scoreB },
      { team: match.teamB, scoreFor: match.scoreB, scoreAgainst: match.scoreA },
    ];
    for (const side of sides) {
      for (const playerId of side.team) {
        const row = rows.get(playerId);
        if (!row) continue;
        row.played += 1;
        row.pointsFor += side.scoreFor;
        row.pointsAgainst += side.scoreAgainst;
        row.diff = row.pointsFor - row.pointsAgainst;
        if (side.scoreFor > side.scoreAgainst) row.won += 1;
        else if (side.scoreFor === side.scoreAgainst) row.drawn += 1;
        else row.lost += 1;
        row.points +=
          state.scoring === 'score' ? side.scoreFor : matchPointsFor(side.scoreFor, side.scoreAgainst);
      }
    }
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
