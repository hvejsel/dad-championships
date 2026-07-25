// Engine tests. Run with: node test.mjs
import {
  roundRobinRounds,
  singlesMatches,
  doublesMatches,
  defaultDoublesMatchCount,
  buildSchedule,
  standings,
  nextMatchIndex,
  progress,
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

const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const ids = (n) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

group('1v1 round robin', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8]) {
    const players = ids(n);
    const matches = singlesMatches(players);
    const expected = (n * (n - 1)) / 2;
    check(`${n} players produce ${expected} matches`, matches.length === expected, `got ${matches.length}`);

    const seen = new Set();
    let duplicates = 0;
    for (const m of matches) {
      const k = key(m.teamA[0], m.teamB[0]);
      if (seen.has(k)) duplicates++;
      seen.add(k);
    }
    check(`${n} players: every pair meets exactly once`, duplicates === 0 && seen.size === expected);

    const counts = new Map(players.map((p) => [p, 0]));
    for (const m of matches) {
      counts.set(m.teamA[0], counts.get(m.teamA[0]) + 1);
      counts.set(m.teamB[0], counts.get(m.teamB[0]) + 1);
    }
    check(`${n} players: everyone plays ${n - 1} matches`, [...counts.values()].every((c) => c === n - 1));
  }

  const rounds = roundRobinRounds(ids(6));
  const noClash = rounds.every((round) => {
    const inRound = round.flat();
    return new Set(inRound).size === inRound.length;
  });
  check('nobody appears twice inside one round', noClash);
});

group('2v2 americano', () => {
  const players = ids(4);
  const matches = doublesMatches(players, 3);
  check('4 players default to 3 matches', defaultDoublesMatchCount(4) === 3);
  check('4 players: 3 matches generated', matches.length === 3);

  const partners = new Set();
  for (const m of matches) {
    partners.add(key(m.teamA[0], m.teamA[1]));
    partners.add(key(m.teamB[0], m.teamB[1]));
  }
  check('4 players: all 6 partnerships used exactly once', partners.size === 6, `got ${partners.size}`);

  for (const n of [4, 5, 6, 7, 8, 10, 12]) {
    const list = ids(n);
    const count = defaultDoublesMatchCount(n);
    const generated = doublesMatches(list, count);
    check(`${n} players: ${count} matches generated`, generated.length === count);

    const played = new Map(list.map((p) => [p, 0]));
    for (const m of generated) {
      for (const id of [...m.teamA, ...m.teamB]) played.set(id, played.get(id) + 1);
    }
    const values = [...played.values()];
    const spread = Math.max(...values) - Math.min(...values);
    check(`${n} players: game counts differ by at most 1 (spread ${spread})`, spread <= 1);

    const everyMatchHasFour = generated.every(
      (m) => new Set([...m.teamA, ...m.teamB]).size === 4
    );
    check(`${n} players: no dad plays against himself`, everyMatchHasFour);

    const repeats = new Map();
    for (const m of generated) {
      for (const pair of [m.teamA, m.teamB]) {
        const k = key(pair[0], pair[1]);
        repeats.set(k, (repeats.get(k) || 0) + 1);
      }
    }
    const worstRepeat = Math.max(...repeats.values());
    const maxAcceptable = Math.ceil((count * 2) / ((n * (n - 1)) / 2)) + 1;
    check(
      `${n} players: partner repeats stay low (worst ${worstRepeat})`,
      worstRepeat <= maxAcceptable,
      `allowed ${maxAcceptable}`
    );
  }
});

group('schedule build', () => {
  const players = ids(4).map((id) => ({ id, name: id.toUpperCase() }));
  const sports = [
    { id: 's1', name: 'Padel' },
    { id: 's2', name: 'Darts' },
    { id: 's3', name: 'Bowling' },
  ];

  const doubles = buildSchedule({ format: '2v2', players, sports, matchesPerSport: 3 });
  check('3 sports x 3 matches = 9 fixtures', doubles.length === 9);

  const order = doubles.map((m) => m.sportId);
  const grouped = order.join(',') === 's1,s1,s1,s2,s2,s2,s3,s3,s3';
  check('one sport is finished before the next one starts', grouped, order.join(','));

  const singles = buildSchedule({ format: '1v1', players, sports });
  check('1v1 with 4 dads over 3 sports = 18 fixtures', singles.length === 18);

  const uniqueIds = new Set(singles.map((m) => m.id));
  check('every fixture has a unique id', uniqueIds.size === singles.length);
  check('fixtures start unplayed', singles.every((m) => !m.done && m.scoreA === null));

  const firstPairs = sports.map((s) => {
    const first = doubles.find((m) => m.sportId === s.id);
    return key(first.teamA[0], first.teamA[1]);
  });
  check('opening pair rotates between sports', new Set(firstPairs).size > 1, firstPairs.join(' '));
});

group('standings — match points', () => {
  const players = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase() }));
  const state = {
    players,
    scoring: 'match',
    matches: [
      { id: 'm1', sportId: 's1', teamA: ['a', 'b'], teamB: ['c', 'd'], scoreA: 21, scoreB: 15, done: true },
      { id: 'm2', sportId: 's1', teamA: ['a', 'c'], teamB: ['b', 'd'], scoreA: 10, scoreB: 10, done: true },
      { id: 'm3', sportId: 's2', teamA: ['a', 'd'], teamB: ['b', 'c'], scoreA: 5, scoreB: 12, done: true },
      { id: 'm4', sportId: 's2', teamA: ['a', 'b'], teamB: ['c', 'd'], scoreA: null, scoreB: null, done: false },
    ],
  };

  const table = standings(state);
  const row = (id) => table.find((r) => r.playerId === id);

  check('A: win + draw + loss = 4 points', row('a').points === 4, `got ${row('a').points}`);
  check('B: win + draw + win = 7 points', row('b').points === 7, `got ${row('b').points}`);
  check('C: loss + draw + win = 4 points', row('c').points === 4, `got ${row('c').points}`);
  check('D: loss + draw + loss = 1 point', row('d').points === 1, `got ${row('d').points}`);
  check('B leads the table', table[0].playerId === 'b');
  check('unplayed matches are ignored', row('a').played === 3);
  check('A scored 21+10+5 = 36', row('a').pointsFor === 36, `got ${row('a').pointsFor}`);
  check('A conceded 15+10+12 = 37', row('a').pointsAgainst === 37);
  check('A difference is -1', row('a').diff === -1);
  check('win/draw/loss counts add up', row('a').won === 1 && row('a').drawn === 1 && row('a').lost === 1);

  const perSport = standings(state, 's2');
  check('per-sport table only counts that sport', perSport.find((r) => r.playerId === 'a').played === 1);
  check('per-sport: B and C won their only s2 match', perSport[0].points === 3);

  const tied = standings(state);
  const aRank = tied.findIndex((r) => r.playerId === 'a');
  const cRank = tied.findIndex((r) => r.playerId === 'c');
  check('equal points are split on score difference (C ahead of A)', cRank < aRank, `a=${aRank} c=${cRank}`);
});

group('standings — points scored', () => {
  const players = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase() }));
  const state = {
    players,
    scoring: 'score',
    matches: [
      { id: 'm1', sportId: 's1', teamA: ['a', 'b'], teamB: ['c', 'd'], scoreA: 21, scoreB: 15, done: true },
      { id: 'm2', sportId: 's1', teamA: ['a', 'c'], teamB: ['b', 'd'], scoreA: 10, scoreB: 18, done: true },
    ],
  };
  const table = standings(state);
  const row = (id) => table.find((r) => r.playerId === id);
  check('A collects 21 + 10 = 31', row('a').points === 31, `got ${row('a').points}`);
  check('B collects 21 + 18 = 39', row('b').points === 39, `got ${row('b').points}`);
  check('D collects 15 + 18 = 33', row('d').points === 33);
  check('B leads on points scored', table[0].playerId === 'b');
});

group('progress helpers', () => {
  const matches = [
    { done: true },
    { done: true },
    { done: false },
    { done: false },
  ];
  check('next unplayed match is index 2', nextMatchIndex(matches) === 2);
  check('progress reports 2 of 4', progress(matches).done === 2 && progress(matches).total === 4);
  check('finished championship returns null', nextMatchIndex([{ done: true }]) === null);
  check('a replayed early match is picked up again', nextMatchIndex([{ done: false }, { done: true }]) === 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
