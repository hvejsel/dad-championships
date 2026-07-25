// Tournament engine: schedule generation and standings.
// Pure functions only — no DOM, no storage. Imported by app.js and by test.mjs.

export const WIN_POINTS = 3;
export const DRAW_POINTS = 1;
export const LOSS_POINTS = 0;

/**
 * Round-robin pairing with the circle method.
 * Returns an array of rounds; every round is an array of [a, b] pairs and no
 * player appears twice inside the same round.
 */
export function roundRobinRounds(playerIds) {
  const arr = playerIds.slice();
  if (arr.length < 2) return [];
  if (arr.length % 2 === 1) arr.push(null); // bye marker

  const n = arr.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== null && b !== null) pairs.push([a, b]);
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop()); // rotate everything except the first seat
  }
  return rounds;
}

/** Every player meets every other player exactly once. */
export function singlesMatches(playerIds) {
  const matches = [];
  for (const round of roundRobinRounds(playerIds)) {
    for (const [a, b] of round) matches.push({ teamA: [a], teamB: [b] });
  }
  return matches;
}

/**
 * Default number of doubles matches for one sport: enough for every possible
 * partnership to happen once (each match burns two partnerships).
 */
export function defaultDoublesMatchCount(playerCount) {
  if (playerCount < 4) return 0;
  return Math.max(3, Math.round((playerCount * (playerCount - 1)) / 4));
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function combinations(list, size) {
  const out = [];
  const walk = (start, picked) => {
    if (picked.length === size) {
      out.push(picked.slice());
      return;
    }
    for (let i = start; i < list.length; i++) {
      picked.push(list[i]);
      walk(i + 1, picked);
      picked.pop();
    }
  };
  walk(0, []);
  return out;
}

const SPLITS = [
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]],
];

/**
 * Americano-style doubles: individual scores, rotating partners.
 * Greedy scheduler that, for every match, prefers the players who have played
 * least and the pairing that repeats partners and opponents the least.
 */
export function doublesMatches(playerIds, matchCount) {
  if (playerIds.length < 4 || matchCount < 1) return [];

  const played = new Map(playerIds.map((id) => [id, 0]));
  const lastPlayed = new Map(playerIds.map((id) => [id, -99]));
  const partnerCount = new Map();
  const opponentCount = new Map();
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  const countOf = (map, key) => map.get(key) || 0;

  const matches = [];
  for (let m = 0; m < matchCount; m++) {
    // Everyone on the lowest game count must play; pull in the next tier only
    // when that is not enough bodies to fill a court.
    const byGames = playerIds
      .slice()
      .sort((x, y) => played.get(x) - played.get(y) || lastPlayed.get(x) - lastPlayed.get(y));
    const minGames = played.get(byGames[0]);
    let pool = byGames.filter((id) => played.get(id) === minGames);
    let tier = minGames;
    while (pool.length < 4) {
      tier += 1;
      pool = pool.concat(byGames.filter((id) => played.get(id) === tier));
    }
    const mustPlay = playerIds.filter((id) => played.get(id) === minGames);
    const candidates = pool.length <= 4 ? [pool.slice(0, 4)] : combinations(pool, 4);

    let best = null;
    for (const quad of candidates) {
      // Prefer quartets that use up the most-rested players.
      const restCost = quad.reduce(
        (sum, id) => sum + played.get(id) * 100 + Math.max(0, 3 + lastPlayed.get(id) - m) * 40,
        0
      );
      const urgency = mustPlay.filter((id) => !quad.includes(id)).length * 5000;

      for (const [pa, pb] of SPLITS) {
        const teamA = [quad[pa[0]], quad[pa[1]]];
        const teamB = [quad[pb[0]], quad[pb[1]]];
        const partnerCost =
          (countOf(partnerCount, pairKey(teamA[0], teamA[1])) +
            countOf(partnerCount, pairKey(teamB[0], teamB[1]))) * 1000;
        let opponentCost = 0;
        for (const a of teamA) {
          for (const b of teamB) opponentCost += countOf(opponentCount, pairKey(a, b)) * 60;
        }
        const cost = urgency + partnerCost + opponentCost + restCost;
        if (!best || cost < best.cost) best = { cost, teamA, teamB };
      }
    }

    matches.push({ teamA: best.teamA, teamB: best.teamB });
    bump(partnerCount, pairKey(best.teamA[0], best.teamA[1]));
    bump(partnerCount, pairKey(best.teamB[0], best.teamB[1]));
    for (const a of best.teamA) {
      for (const b of best.teamB) bump(opponentCount, pairKey(a, b));
    }
    for (const id of [...best.teamA, ...best.teamB]) {
      played.set(id, played.get(id) + 1);
      lastPlayed.set(id, m);
    }
  }
  return matches;
}

/**
 * Full fixture list for the championship. Sports run one at a time, in the
 * order they were added, because there is only one pitch.
 */
export function buildSchedule({ format, players, sports, matchesPerSport }) {
  const baseIds = players.map((p) => p.id);
  const matches = [];
  sports.forEach((sport, sportIndex) => {
    // Rotate the seeding per sport so the same two dads are not paired up in
    // the opening match of every single sport.
    const offset = baseIds.length ? sportIndex % baseIds.length : 0;
    const playerIds = baseIds.slice(offset).concat(baseIds.slice(0, offset));
    const raw =
      format === '2v2'
        ? doublesMatches(playerIds, matchesPerSport || defaultDoublesMatchCount(playerIds.length))
        : singlesMatches(playerIds);
    raw.forEach((match, i) => {
      matches.push({
        id: `${sport.id}-${i}`,
        sportId: sport.id,
        sportIndex,
        roundInSport: i + 1,
        teamA: match.teamA,
        teamB: match.teamB,
        scoreA: null,
        scoreB: null,
        done: false,
      });
    });
  });
  return matches;
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

export function nextMatchIndex(matches) {
  const index = matches.findIndex((m) => !m.done);
  return index === -1 ? null : index;
}

export function progress(matches) {
  const done = matches.filter((m) => m.done).length;
  return { done, total: matches.length };
}
