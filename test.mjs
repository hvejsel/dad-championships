// Engine tests. Run with: node test.mjs
import {
  GENERATIONS,
  generationLabel,
  FORMATS,
  formatLabel,
  SCORINGS,
  scoringLabel,
  scoringSummary,
  sideLabel,
  championshipInitials,
  WIN_POINT_CHOICES,
  teamSize,
  matchSize,
  isFreeForAll,
  orderedSports,
  sportsByOrder,
  matchesForSport,
  orderedMatches,
  allPairs,
  singlesRounds,
  doublesFixtures,
  roundsFor,
  matchesPerSport,
  sportsToCoverEveryone,
  pairCoverage,
  playersSittingOut,
  buildProgramme,
  buildAllProgrammes,
  createMatch,
  validateSides,
  pedroMatches,
  pedroStatus,
  sportProgress,
  upgradeTime,
  standInsOf,
  isStandIn,
  entrantsOf,
  entrantName,
  addPlayer,
  addStandIn,
  removeEntrant,
  matchesWith,
  playersInMatch,
  winningSide,
  matchPointsFor,
  standings,
  nextUnplayed,
  progress,
  migrateState,
  STATE_VERSION,
} from './tournament.js';

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function group(name, fn) {
  console.log(`\n${name}`);
  fn();
}

const players = [
  { id: 'p1', name: 'Jesper', generation: 'dad' },
  { id: 'p2', name: 'Martin', generation: 'dad' },
  { id: 'p3', name: 'Bent', generation: 'granddad' },
  { id: 'p4', name: 'Emil', generation: 'kid' },
  { id: 'p5', name: 'Alma', generation: 'kid' },
  { id: 'p6', name: 'Ove', generation: 'granddad' },
];

const sport = (over = {}) => ({
  id: 's1', name: 'Padel', order: 0, format: '1v1', scoring: 'match', winPoints: 3, time: null,
  ...over,
});

function baseState(overrides = {}) {
  return {
    players,
    nextMatchNo: 0,
    sports: [
      sport({ id: 's1', name: 'Padel', order: 0, format: '2v2', time: '13:00' }),
      sport({ id: 's2', name: 'Darts', order: 1, format: '1v1', time: '10:30' }),
      sport({ id: 's3', name: 'Mini golf', order: 2, format: 'ffa', scoring: 'score' }),
    ],
    matches: [],
    ...overrides,
  };
}

const sides = (...groups) => groups.map((players) => ({ players, score: null }));
const played = (...pairs) => pairs.map(([players, score]) => ({ players, score }));
const idsFor = (n) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

/** A predictable stand-in for Math.random, so a Pedro draw can be tested. */
function rng(seed = 7) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

/** Every player who appears in a round, with how many matches he has in it. */
function appearances(round) {
  const count = new Map();
  for (const match of round) {
    for (const side of match) for (const id of side) count.set(id, (count.get(id) || 0) + 1);
  }
  return count;
}

group('generations', () => {
  check('three generations exist', GENERATIONS.length === 3);
  check('dad, granddad and kid', GENERATIONS.map((g) => g.id).join(',') === 'dad,granddad,kid');
  check('granddad reads as Granddad', generationLabel('granddad') === 'Granddad');
  check('an unknown generation falls back to Dad', generationLabel('nonsense') === 'Dad');
});

group('game types and point types are picked from a list', () => {
  check('three game types exist', FORMATS.map((f) => f.id).join(',') === '1v1,2v2,ffa');
  check('all vs all reads as All vs all', formatLabel('ffa') === 'All vs all');
  check('an unknown game type falls back to 1 v 1', formatLabel('nope') === '1 v 1');
  check('1v1 puts one player on a side', teamSize('1v1') === 1);
  check('2v2 puts two players on a side', teamSize('2v2') === 2);
  check('only ffa is a free-for-all', isFreeForAll('ffa') && !isFreeForAll('2v2'));

  check('two point types exist', SCORINGS.map((s) => s.id).join(',') === 'match,score');
  check('the winner-gets type is named plainly', scoringLabel('match') === 'Winner gets points');
  check('a win can be worth 1 through 50', WIN_POINT_CHOICES[0] === 1 && WIN_POINT_CHOICES.includes(50));
  check('the row summary shows what a win is worth', scoringSummary(sport({ winPoints: 10 })) === 'Win = 10');
  check('the row summary names the score type', scoringSummary(sport({ scoring: 'score' })) === 'Score counts');
});

group('booked times drive the running order', () => {
  const s = baseState();
  const order = orderedSports(s.sports).map((x) => x.name);
  check('earliest booked time comes first', order[0] === 'Darts', order.join(','));
  check('later booked time follows', order[1] === 'Padel', order.join(','));
  check('a sport with no time yet goes last', order[2] === 'Mini golf', order.join(','));
  check('the programme is drawn in the order sports were added',
    sportsByOrder(s.sports).map((x) => x.name).join(',') === 'Padel,Darts,Mini golf');
  check('ordering does not mutate the original list', orderedSports(s.sports) !== s.sports);
});

group('one match per player per sport — singles', () => {
  for (const n of [2, 4, 6, 8]) {
    const rounds = singlesRounds(idsFor(n));
    check(`${n} players: ${n - 1} rounds`, rounds.length === n - 1, `got ${rounds.length}`);
    check(
      `${n} players: every round gives everyone exactly one match`,
      rounds.every((round) => {
        const seen = appearances(round);
        return seen.size === n && [...seen.values()].every((c) => c === 1);
      })
    );
  }

  for (const n of [3, 5, 7]) {
    const rounds = singlesRounds(idsFor(n));
    check(`${n} players: ${n} rounds`, rounds.length === n, `got ${rounds.length}`);
    check(
      `${n} players: one player sits each round, nobody plays twice`,
      rounds.every((round) => {
        const seen = appearances(round);
        return seen.size === n - 1 && [...seen.values()].every((c) => c === 1);
      })
    );
  }

  // The rounds together are still a full round robin.
  const rounds = singlesRounds(idsFor(5));
  const seen = new Set();
  for (const round of rounds) for (const [[a], [b]] of round) seen.add([a, b].sort().join('|'));
  check('the rounds together cover every pairing once', seen.size === 10, `got ${seen.size}`);
  check('one player alone has nothing to play', singlesRounds(['p1']).length === 0);
});

group('one match per player per sport — doubles', () => {
  for (const n of [4, 6, 8]) {
    const rounds = roundsFor(idsFor(n), '2v2');
    check(`${n} players: doubles rounds exist`, rounds.length > 0);
    check(
      `${n} players: nobody plays twice in the same sport`,
      rounds.every((round) => [...appearances(round).values()].every((c) => c === 1))
    );
    check(
      `${n} players: every match is four different players`,
      rounds.every((round) => round.every((m) => new Set(m.flat()).size === 4))
    );
  }
  const eight = roundsFor(idsFor(8), '2v2');
  check('with eight players a doubles round runs two matches at once', eight[0].length === 2);
  check('three players cannot play doubles', doublesFixtures(idsFor(3)).length === 0);
});

group('all vs all is one round with everybody in it', () => {
  const rounds = roundsFor(idsFor(5), 'ffa');
  check('a single round', rounds.length === 1);
  check('one match holding everyone', rounds[0].length === 1 && rounds[0][0].length === 5);
  check('one player alone is no contest', roundsFor(['p1'], 'ffa').length === 0);

  // Everybody at once is not the same as having had a named opponent, so an
  // all-vs-all sport must not tick off the head-to-head pairings.
  const s = {
    players: players.slice(0, 4),
    nextMatchNo: 0,
    matches: [],
    sports: [sport({ id: 's1', name: 'Mini golf', order: 0, format: 'ffa' })],
  };
  buildAllProgrammes(s);
  check('an all-vs-all sport leaves every pairing still to meet', pairCoverage(s).missing.length === 6);
  check('and it still gives everyone a match', playersInMatch(s.matches[0]).length === 4);
});

group('the sports together cover everyone against everyone', () => {
  const s = {
    players: players.slice(0, 4),
    nextMatchNo: 0,
    matches: [],
    sports: [
      sport({ id: 's1', name: 'Padel', order: 0, format: '1v1' }),
      sport({ id: 's2', name: 'Darts', order: 1, format: '1v1' }),
      sport({ id: 's3', name: 'Bowling', order: 2, format: '1v1' }),
    ],
  };
  buildAllProgrammes(s);

  check('each sport holds one match per player', s.sports.every((x) => matchesForSport(s.matches, x.id).length === 2));
  check('everyone plays exactly once in each sport', s.sports.every((x) => {
    const ids = matchesForSport(s.matches, x.id).flatMap(playersInMatch);
    return ids.length === 4 && new Set(ids).size === 4;
  }));
  check('the preview count agrees', matchesPerSport(4, '1v1') === 2);
  check('three sports are what it takes for four players', sportsToCoverEveryone(4, '1v1') === 3);

  const cover = pairCoverage(s);
  check('after three sports everyone has met everyone', cover.missing.length === 0, JSON.stringify(cover));
  check('all six pairings are counted', cover.met === 6 && cover.total === 6);
  check('no pairing is played twice', s.matches.length === 6);

  // Two sports only get you part of the way.
  const two = { ...s, sports: s.sports.slice(0, 2), matches: [] };
  buildAllProgrammes(two);
  const partial = pairCoverage(two);
  check('two sports leave two pairings open', partial.missing.length === 2, JSON.stringify(partial.missing));
});

group('a sport added later picks up the pairings still missing', () => {
  const s = {
    players: players.slice(0, 4),
    nextMatchNo: 0,
    matches: [],
    sports: [
      sport({ id: 's1', name: 'Padel', order: 0, format: '1v1' }),
      sport({ id: 's2', name: 'Darts', order: 1, format: '1v1' }),
    ],
  };
  buildAllProgrammes(s);
  const before = pairCoverage(s).missing.length;

  // there is more time — add a third sport mid-championship
  s.sports.push(sport({ id: 's3', name: 'Boules', order: 2, format: '1v1', time: '16:00' }));
  s.matches.push(...buildProgramme(s, 's3'));

  check('the earlier sports keep their matches', matchesForSport(s.matches, 's1').length === 2);
  check('the new sport gets one match per player', matchesForSport(s.matches, 's3').length === 2);
  check('it plays the pairings that were missing', pairCoverage(s).missing.length === 0, `was ${before}`);
  check('and nothing is played twice', s.matches.length === 6);

  // a fourth sport with nothing new left still gives everyone a match
  s.sports.push(sport({ id: 's4', name: 'Pool', order: 3, format: '1v1' }));
  s.matches.push(...buildProgramme(s, 's4'));
  check('a sport beyond full coverage still gives everyone one match',
    matchesForSport(s.matches, 's4').length === 2);
});

group('nobody sits a sport out — the odd one gets a Pedro match', () => {
  // Five for badminton: two matches leave one over, and he plays a Pedro match
  // instead of sitting on the bench.
  const s = {
    players: players.slice(0, 5),
    nextMatchNo: 0,
    matches: [],
    sports: [sport({ id: 's1', name: 'Badminton', order: 0, format: '1v1' })],
  };
  buildAllProgrammes(s);

  check('nobody sits out', playersSittingOut(s, 's1').length === 0);
  check('five players give three matches', matchesForSport(s.matches, 's1').length === 3);
  check('one of them is a Pedro match', pedroMatches(s.matches).length === 1);
  check('the preview count includes the Pedro match', matchesPerSport(5, '1v1') === 3);
  check(
    'the player the round left over is in the Pedro match',
    playersInMatch(pedroMatches(s.matches)[0]).length === 2
  );
  check(
    'everyone has a match',
    new Set(matchesForSport(s.matches, 's1').flatMap(playersInMatch)).size === 5
  );
  check(
    'the Pedro match is the only one anybody plays twice in',
    matchesForSport(s.matches, 's1').filter((m) => !m.pedro).flatMap(playersInMatch).length === 4
  );

  // Doubles with six: the two the round leaves over are teamed up.
  const d = {
    players: players.slice(0, 6),
    nextMatchNo: 0,
    matches: [],
    sports: [sport({ id: 's1', name: 'Padel', order: 0, format: '2v2' })],
  };
  buildAllProgrammes(d);
  check('doubles with six leaves nobody out', playersSittingOut(d, 's1').length === 0);
  check('and adds one Pedro match of four', pedroMatches(d.matches).length === 1 &&
    playersInMatch(pedroMatches(d.matches)[0]).length === 4);
  check('the preview count agrees for doubles', matchesPerSport(6, '2v2') === 2);

  // All vs all always has everybody in it, so it never needs a Pedro match.
  const f = {
    players: players.slice(0, 5),
    nextMatchNo: 0,
    matches: [],
    sports: [sport({ id: 's1', name: 'Mini golf', order: 0, format: 'ffa' })],
  };
  buildAllProgrammes(f);
  check('all vs all needs no Pedro match', pedroMatches(f.matches).length === 0);
  check('and still nobody sits out', playersSittingOut(f, 's1').length === 0);
});

group('Pedro is simply the last player, and his points count like any other', () => {
  const s = {
    players: players.slice(0, 5),
    nextMatchNo: 0,
    matches: [],
    sports: [sport({ id: 's1', name: 'Badminton', order: 0, format: '1v1', winPoints: 3 })],
  };
  buildAllProgrammes(s);

  const pedro = pedroMatches(s.matches)[0];
  const last = s.players[s.players.length - 1].id;
  const leftOver = matchesForSport(s.matches, 's1')
    .filter((m) => !m.pedro)
    .flatMap(playersInMatch);
  const odd = s.players.map((p) => p.id).find((id) => !leftOver.includes(id));

  check('the round leaves exactly one player over', Boolean(odd));
  check('the odd one out is in the Pedro match', playersInMatch(pedro).includes(odd));
  check(
    'and Pedro is the last player on the list',
    playersInMatch(pedro).includes(last) || odd === last,
    JSON.stringify(playersInMatch(pedro))
  );

  // drawn twice, the same Pedro turns up — no dice involved any more
  const again = { ...s, matches: [], nextMatchNo: 0 };
  buildAllProgrammes(again);
  check(
    'the draw is the same every time',
    JSON.stringify(again.matches.map((m) => m.sides)) === JSON.stringify(s.matches.map((m) => m.sides))
  );

  for (const match of s.matches) {
    match.sides[0].score = 11;
    match.sides[1].score = 6;
    match.done = true;
  }
  const table = standings(s);
  const totalPlayed = table.reduce((sum, r) => sum + r.played, 0);
  check('every match counts, the Pedro match included', totalPlayed === 6, `got ${totalPlayed}`);
  check('nothing is held back waiting for anyone', pedroStatus(s).done === 1);
});

group('a stand-in fills the spot but never the table', () => {
  const s = {
    players: players.slice(0, 4),
    standIns: [{ id: 'x1', name: 'Pedro' }],
    nextMatchNo: 0,
    matches: [],
    sports: [sport({ id: 's1', name: 'Padel', order: 0, format: '1v1', winPoints: 3 })],
  };
  buildAllProgrammes(s);

  check('the stand-ins are there', standInsOf(s).length === 1);
  check('a stand-in is known as one', isStandIn(s, 'x1') === true);
  check('a player is not', isStandIn(s, 'p1') === false);
  check('you can pick a player or a stand-in', entrantsOf(s).length === 5);
  check('and a stand-in has a name to show', entrantName(s, 'x1') === 'Pedro');

  // Anders v Pedro: a match against somebody who is not in the championship
  const match = s.matches[0];
  match.sides = [{ players: ['p1'], score: 11 }, { players: ['x1'], score: 4 }];
  match.done = true;

  const table = standings(s);
  check('the stand-in gets no row in the table', table.every((r) => r.playerId !== 'x1'));
  check('the player still gets his points', table.find((r) => r.playerId === 'p1').points === 3);
  check('and the win is recorded', table.find((r) => r.playerId === 'p1').won === 1);

  const added = addStandIn(s, 'Anders');
  check('another stand-in can be added', standInsOf(s).length === 2 && added.name === 'Anders');
  check('and it gets its own id', added.id !== 'x1');
});

group('the field can be edited after the championship has started', () => {
  const s = {
    players: players.slice(0, 4),
    standIns: [{ id: 'x1', name: 'Pedro' }],
    nextMatchNo: 0,
    matches: [],
    sports: [sport({ id: 's1', name: 'Padel', order: 0, format: '1v1', winPoints: 3 })],
  };
  buildAllProgrammes(s);
  const before = s.matches.length;

  // somebody turns up late
  const late = addPlayer(s, 'Cousin Bo', 'kid');
  check('a player can be added later', s.players.length === 5);
  check('with his own id', late.id === 'p5');
  check('and his own generation', late.generation === 'kid');
  check('the matches already drawn are untouched', s.matches.length === before);
  check('and he is flagged as having no match yet', playersSittingOut(s, 's1').some((p) => p.id === 'p5'));

  // a name was spelled wrong — renaming is a plain edit and costs nothing
  s.players[0].name = 'Jesper';
  check('renaming keeps every match', s.matches.length === before);
  check('and the table shows the new name', standings(s).some((r) => r.name === 'Jesper'));

  // somebody has to leave
  const doomed = 'p2';
  const hisMatches = matchesWith(s, doomed).length;
  check('the app can say what taking him out costs', hisMatches > 0);
  const removed = removeEntrant(s, doomed);
  check('removing him reports how many matches went', removed === hisMatches);
  check('he is out of the field', s.players.every((p) => p.id !== doomed));
  check('his matches are gone', matchesWith(s, doomed).length === 0);
  check('no match is left with an empty side',
    s.matches.every((m) => m.sides.every((side) => side.players.length && side.players.every(Boolean))));
  check('and everybody else keeps theirs', s.matches.length === before - hisMatches);

  // a stand-in can be taken out the same way
  removeEntrant(s, 'x1');
  check('a stand-in can be removed too', standInsOf(s).length === 0);
});

group('rebuilding one sport leaves the others alone', () => {
  const s = baseState();
  buildAllProgrammes(s);
  const dartsBefore = matchesForSport(s.matches, 's2').map((m) => m.id).join(',');

  s.sports[0].format = '1v1';
  s.matches = s.matches.filter((m) => m.sportId !== 's1');
  s.matches.push(...buildProgramme(s, 's1'));

  check('the rebuilt sport follows its new game type', matchesForSport(s.matches, 's1').length === 3);
  check('the other sports keep their exact matches',
    matchesForSport(s.matches, 's2').map((m) => m.id).join(',') === dartsBefore);
  check('mini golf is still one round', matchesForSport(s.matches, 's3').length === 1);
});

group('the winner gets the points you set', () => {
  check('a win is worth 3 by default', matchPointsFor(11, 7) === 3);
  check('a win can be worth 10', matchPointsFor(11, 7, 10) === 10);
  check('a draw is worth a point', matchPointsFor(7, 7, 10) === 1);
  check('a loss is worth nothing', matchPointsFor(2, 7, 10) === 0);
  check('when a win is worth 1, a draw is worth nothing', matchPointsFor(7, 7, 1) === 0);

  const s = baseState({
    sports: [
      sport({ id: 's1', name: 'Padel', order: 0, format: '2v2', scoring: 'match', winPoints: 10 }),
      sport({ id: 's2', name: 'Darts', order: 1, format: '1v1', scoring: 'match', winPoints: 2 }),
    ],
    matches: [
      { id: 'm1', sportId: 's1', sides: played([['p1', 'p2'], 21], [['p3', 'p4'], 15]), done: true },
      { id: 'm2', sportId: 's2', sides: played([['p1'], 5], [['p2'], 12]), done: true },
    ],
  });
  const table = standings(s);
  const row = (id) => table.find((r) => r.playerId === id);
  check('the padel win is worth 10', row('p2').points === 12, `got ${row('p2').points}`);
  check('the darts win is worth 2', row('p2').won === 2);
  check('the padel winner who lost the darts keeps 10', row('p1').points === 10, `got ${row('p1').points}`);
  check('the padel losers get nothing', row('p3').points === 0 && row('p4').points === 0);
});

group('all vs all: the winner gets the points too', () => {
  const s = {
    players: players.slice(0, 3),
    nextMatchNo: 0,
    sports: [sport({ id: 's3', name: 'Mini golf', order: 0, format: 'ffa', scoring: 'match', winPoints: 25 })],
    matches: [
      { id: 'm1', sportId: 's3', sides: played([['p1'], 30], [['p2'], 12], [['p3'], 25]), done: true },
    ],
  };
  const table = standings(s);
  const row = (id) => table.find((r) => r.playerId === id);
  check('the best score takes all 25', row('p1').points === 25);
  check('everybody else takes nothing', row('p2').points === 0 && row('p3').points === 0);
  check('you are measured against the best of the rest', row('p2').pointsAgainst === 30);
  check('the winning side is reported', winningSide(s.matches[0]).players[0] === 'p1');

  s.sports[0].scoring = 'score';
  const golf = standings(s);
  check('with score counts it is point for point', golf[0].points === 30 && golf[1].points === 25);

  const tied = {
    ...s,
    sports: [sport({ id: 's3', format: 'ffa', scoring: 'match', winPoints: 25 })],
    matches: [{ id: 'm1', sportId: 's3', sides: played([['p1'], 20], [['p2'], 20]), done: true }],
  };
  check('a shared best score is a draw for both',
    standings(tied).filter((r) => r.played > 0).every((r) => r.points === 1));
  check('a tie has no winning side', winningSide(tied.matches[0]) === null);
});

group('standings across sports', () => {
  const s = baseState({
    matches: [
      { id: 'm1', sportId: 's1', sides: played([['p1', 'p2'], 21], [['p3', 'p4'], 15]), done: true },
      { id: 'm2', sportId: 's2', sides: played([['p1'], 5], [['p2'], 12]), done: true },
      { id: 'm3', sportId: 's3', sides: played([['p1'], 30], [['p2'], 12], [['p3'], 25]), done: true },
      { id: 'm4', sportId: 's2', sides: sides(['p3'], ['p4']), done: false },
    ],
  });
  const table = standings(s);
  const row = (id) => table.find((r) => r.playerId === id);

  check('Jesper: padel win 3 + darts loss 0 + 30 golf points', row('p1').points === 33, `got ${row('p1').points}`);
  check('unplayed matches are ignored', row('p4').played === 1);
  check('players who never played show zero', row('p6').played === 0 && row('p6').points === 0);
  check('the generation travels into the table', row('p3').generation === 'granddad');
  check('a per-sport table only counts that sport', standings(s, 's2').find((r) => r.playerId === 'p1').played === 1);
  check('Jesper leads overall', table[0].playerId === 'p1');
  check('progress counts every match', progress(s.matches).done === 3 && progress(s.matches).total === 4);
  check('the next match is the earliest unplayed one', nextUnplayed(s).id === 'm4');
});

group('ties', () => {
  const s = baseState({
    matches: [
      { id: 'm1', sportId: 's2', sides: played([['p1'], 20], [['p2'], 1]), done: true },
      { id: 'm2', sportId: 's2', sides: played([['p3'], 11], [['p4'], 10]), done: true },
    ],
  });
  const table = standings(s);
  check('equal points split on score difference', table[0].playerId === 'p1', table[0].playerId);
  check('the narrower win ranks second', table[1].playerId === 'p3', table[1].playerId);
});

group('a booked time is a day and a time', () => {
  check('a clock time gains the day it was set up',
    upgradeTime('10:30', '2026-04-05T09:00:00.000Z') === '2026-04-05T10:30',
    upgradeTime('10:30', '2026-04-05T09:00:00.000Z'));
  check('a day and time is left alone', upgradeTime('2026-08-01T09:00', null) === '2026-08-01T09:00');
  check('seconds are trimmed off', upgradeTime('2026-08-01T09:00:00', null) === '2026-08-01T09:00');
  check('no time stays no time', upgradeTime(null, null) === null);
  check('nonsense is refused', upgradeTime('half past ten', null) === null);

  const list = [
    sport({ id: 's1', name: 'Sunday padel', order: 0, time: '2026-08-02T09:00' }),
    sport({ id: 's2', name: 'Saturday darts', order: 1, time: '2026-08-01T20:00' }),
    sport({ id: 's3', name: 'Saturday bowling', order: 2, time: '2026-08-01T10:00' }),
    sport({ id: 's4', name: 'Whenever', order: 3, time: null }),
  ];
  check('sports run in the order they happen, across days',
    orderedSports(list).map((x) => x.id).join(',') === 's3,s2,s1,s4',
    orderedSports(list).map((x) => x.id).join(','));
});

group('a sport says when it is done', () => {
  const s = baseState({
    matches: [
      { id: 'm1', sportId: 's1', sides: played([['p1'], 11], [['p2'], 6]), done: true },
      { id: 'm2', sportId: 's1', sides: played([['p3'], 9], [['p4'], 11]), done: true },
      { id: 'm3', sportId: 's2', sides: played([['p1'], 5], [['p2'], 3]), done: true },
      { id: 'm4', sportId: 's2', sides: sides(['p3'], ['p4']), done: false },
    ],
  });

  const one = sportProgress(s, 's1');
  check('a sport with every match played is done', one.complete === true);
  check('and it counts them', one.done === 2 && one.total === 2);

  const two = sportProgress(s, 's2');
  check('a sport with a match left is not done', two.complete === false);
  check('and it says how far it got', two.done === 1 && two.total === 2);

  const none = sportProgress(s, 's3');
  check('a sport with no matches at all is not done', none.complete === false, JSON.stringify(none));
});

group('a saved championship survives an update', () => {
  // what an older version of the app wrote: two teams, two scores, one point
  // type for the whole championship
  const old = {
    version: 2,
    createdAt: '2026-07-25T10:00:00Z',
    scoring: 'score',
    players: [
      { id: 'p1', name: 'Jesper', generation: 'dad' },
      { id: 'p2', name: 'Bent', generation: 'granddad' },
    ],
    sports: [{ id: 's1', name: 'Darts', order: 0, format: '1v1', time: '10:30' }],
    matches: [{ id: 'm1', sportId: 's1', teamA: ['p1'], teamB: ['p2'], scoreA: 12, scoreB: 9, done: true }],
    nextMatchNo: 1,
  };
  const migrated = migrateState(old);

  check('it is brought up to the current version', migrated.version === STATE_VERSION);
  check('the players are kept', migrated.players.map((p) => p.name).join(',') === 'Jesper,Bent');
  check('a clock-only booked time gains the day the championship started',
    migrated.sports[0].time === '2026-07-25T10:30', migrated.sports[0].time);
  check('the old point type moves onto the sport', migrated.sports[0].scoring === 'score');
  check('a win gets a value it did not have before', migrated.sports[0].winPoints === 3);
  check('the championship gets a name for its crest', migrated.name === 'Dad Championships');
  check('a name that was already chosen is kept', migrateState({ ...old, name: 'Hvejsel Cup' }).name === 'Hvejsel Cup');
  check('every championship gets a Pedro to stand in', migrated.standIns.length === 1);
  check('and he is called Pedro', migrated.standIns[0].name === 'Pedro');
  check('stand-ins already chosen are kept',
    migrateState({ ...old, standIns: [{ id: 'x1', name: 'Anders' }] }).standIns[0].name === 'Anders');
  check('the old Pedro-points switch is gone', migrated.pedroCounts === undefined);
  check('old matches are not Pedro matches', migrated.matches[0].pedro === false);
  check('the played result is kept', migrated.matches[0].done === true);
  check('the two teams become two sides',
    migrated.matches[0].sides.map((s) => s.players[0] + '=' + s.score).join(',') === 'p1=12,p2=9');
  check('the standings still read the migrated match', standings(migrated)[0].points === 12);
  check('nothing is invented from nothing', migrateState(null) === null);
  check('junk is rejected rather than half-loaded', migrateState({ hello: 'there' }) === null);

  // the current shape passes through untouched
  const current = baseState({ matches: [{ id: 'm1', sportId: 's2', sides: played([['p1'], 3], [['p2'], 1]), done: true }] });
  const again = migrateState(JSON.parse(JSON.stringify(current)));
  check('a current championship is unchanged by the migration',
    again.matches[0].sides[0].score === 3 && again.sports[0].winPoints === 3);
  check('and it keeps its own per-sport point types', again.sports[2].scoring === 'score');
});

group('the crest is drawn from the championship name', () => {
  check('two words give two letters', championshipInitials('Dad Championships') === 'DC');
  check('three words give three', championshipInitials('Hvejsel Family Cup') === 'HFC');
  check('small words are skipped', championshipInitials('Battle of the Dads') === 'BD');
  check('one word gives its first two letters', championshipInitials('Bornholm') === 'BO');
  check('four words are cut to three letters', championshipInitials('Jesper Bent Emil Alma') === 'JBE');
  check('an empty name still gives a monogram', championshipInitials('') === 'DC');
  check('so does a missing one', championshipInitials(undefined) === 'DC');
  check('Danish letters survive', championshipInitials('Ærø Cup') === 'ÆC');
});

group('a score belongs to a team in doubles and to a person otherwise', () => {
  check('doubles scores a team', sideLabel('2v2') === 'team');
  check('singles scores a person', sideLabel('1v1') === 'player');
  check('all vs all scores a person', sideLabel('ffa') === 'player');
  check('a singles match holds two players', matchSize('1v1') === 2);
  check('a doubles match holds four', matchSize('2v2') === 4);

  // both players on a doubles team get the team's score
  const s = baseState({
    matches: [{ id: 'm1', sportId: 's1', sides: played([['p1', 'p2'], 21], [['p3', 'p4'], 15]), done: true }],
  });
  const table = standings(s, 's1');
  const row = (id) => table.find((r) => r.playerId === id);
  check('both winners are credited with the team score', row('p1').pointsFor === 21 && row('p2').pointsFor === 21);
  check('both losers are credited with theirs', row('p3').pointsFor === 15 && row('p4').pointsFor === 15);
  check('and both winners get the win', row('p1').won === 1 && row('p2').won === 1);
});

group('every element of a match can be edited', () => {
  const s = baseState({ sports: [sport({ id: 's1', name: 'Darts', order: 0, format: '1v1' })] });
  buildAllProgrammes(s);

  check('a singles match needs one player on each side', validateSides([['p1'], []], '1v1') !== null);
  check('two on a side is not singles', validateSides([['p1', 'p2'], ['p3']], '1v1') !== null);
  check('one each is fine', validateSides([['p1'], ['p2']], '1v1') === null);
  check('doubles needs two on each side', validateSides([['p1', 'p2'], ['p3']], '2v2') !== null);
  check('two each is fine', validateSides([['p1', 'p2'], ['p3', 'p4']], '2v2') === null);
  check('nobody plays himself', validateSides([['p1'], ['p1']], '1v1') !== null);
  check('nobody appears twice in a doubles match', validateSides([['p1', 'p2'], ['p2', 'p3']], '2v2') !== null);
  check('an empty slot is caught', validateSides([['p1'], [null]], '1v1') !== null);
  check('the side shape is validated as sides too',
    validateSides([{ players: ['p1'] }, { players: ['p2'] }], '1v1') === null);
  check('all vs all needs at least two', validateSides([['p1']], 'ffa') !== null);
  check('all vs all rejects a repeat', validateSides([['p1'], ['p1'], ['p2']], 'ffa') !== null);
  check('all vs all with three is fine', validateSides([['p1'], ['p2'], ['p3']], 'ffa') === null);

  // swapping the two opponents around is just new sides
  const match = s.matches[0];
  const before = playersInMatch(match).join(',');
  match.sides = [{ players: ['p1'], score: null }, { players: ['p5'], score: null }];
  check('a match keeps whatever sides you give it', playersInMatch(match).join(',') === 'p1,p5');
  check('and that is a different pairing than it started with', before !== 'p1,p5');

  // a match added by hand
  const added = createMatch(s, 's1');
  check('a hand-added match lands on the right sport', added.sportId === 's1');
  check('it is not a Pedro match', added.pedro === false);
  check('it starts unplayed', !added.done && added.sides.every((x) => x.score === null));
  check('it is a full match', validateSides(added.sides, '1v1') === null);

  const given = createMatch(s, 's1', [['p2'], ['p6']]);
  check('you can say exactly who plays', playersInMatch(given).join(',') === 'p2,p6');
  let threw = false;
  try { createMatch(s, 's1', [['p2'], ['p2']]); } catch { threw = true; }
  check('an impossible match is refused', threw);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
