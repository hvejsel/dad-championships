// Engine tests. Run with: node test.mjs
import {
  GENERATIONS,
  generationLabel,
  FORMATS,
  formatLabel,
  SCORINGS,
  scoringLabel,
  teamSize,
  isFreeForAll,
  orderedSports,
  matchesForSport,
  orderedMatches,
  allPairs,
  singlesFixtures,
  doublesFixtures,
  fixturesFor,
  fixtureCount,
  buildProgramme,
  buildAllProgrammes,
  validateMatch,
  createMatch,
  playersInMatch,
  winningSide,
  standings,
  nextUnplayed,
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

const players = [
  { id: 'p1', name: 'Jesper', generation: 'dad' },
  { id: 'p2', name: 'Martin', generation: 'dad' },
  { id: 'p3', name: 'Bent', generation: 'granddad' },
  { id: 'p4', name: 'Emil', generation: 'kid' },
  { id: 'p5', name: 'Alma', generation: 'kid' },
  { id: 'p6', name: 'Ove', generation: 'granddad' },
];

function baseState(overrides = {}) {
  return {
    players,
    nextMatchNo: 0,
    sports: [
      { id: 's1', name: 'Padel', order: 0, format: '2v2', scoring: 'match', time: '13:00' },
      { id: 's2', name: 'Darts', order: 1, format: '1v1', scoring: 'match', time: '10:30' },
      { id: 's3', name: 'Mini golf', order: 2, format: 'ffa', scoring: 'score', time: null },
    ],
    matches: [],
    ...overrides,
  };
}

/** Two sides facing each other, the shape the engine stores. */
const sides = (...groups) => groups.map((players) => ({ players, score: null }));
const played = (...pairs) => pairs.map(([players, score]) => ({ players, score }));

const idsFor = (n) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

group('generations', () => {
  check('three generations exist', GENERATIONS.length === 3);
  check('dad, granddad and kid', GENERATIONS.map((g) => g.id).join(',') === 'dad,granddad,kid');
  check('granddad reads as Granddad', generationLabel('granddad') === 'Granddad');
  check('an unknown generation falls back to Dad', generationLabel('nonsense') === 'Dad');
});

group('formats and point types are picked from a list', () => {
  check('three formats exist', FORMATS.length === 3);
  check('1v1, 2v2 and all vs all', FORMATS.map((f) => f.id).join(',') === '1v1,2v2,ffa');
  check('all vs all reads as All vs all', formatLabel('ffa') === 'All vs all');
  check('an unknown format falls back to 1 v 1', formatLabel('nope') === '1 v 1');
  check('doubles needs four players', FORMATS.find((f) => f.id === '2v2').min === 4);
  check('1v1 puts one player on a side', teamSize('1v1') === 1);
  check('2v2 puts two players on a side', teamSize('2v2') === 2);
  check('only ffa is a free-for-all', isFreeForAll('ffa') && !isFreeForAll('2v2'));

  check('two point types exist', SCORINGS.map((s) => s.id).join(',') === 'match,score');
  check('score counts reads plainly', scoringLabel('score') === 'Score counts');
  check('an unknown point type falls back to win = 3', scoringLabel('nope') === 'Win = 3');
});

group('booked times drive the running order', () => {
  const s = baseState();
  const order = orderedSports(s.sports).map((x) => x.name);
  check('earliest booked time comes first', order[0] === 'Darts', order.join(','));
  check('later booked time follows', order[1] === 'Padel', order.join(','));
  check('a sport with no time yet goes last', order[2] === 'Mini golf', order.join(','));

  const untimed = orderedSports([
    { id: 'a', name: 'A', order: 0, time: null },
    { id: 'b', name: 'B', order: 1, time: null },
  ]).map((x) => x.name);
  check('with no times at all, entry order is kept', untimed.join(',') === 'A,B');

  const sameTime = orderedSports([
    { id: 'b', name: 'B', order: 1, time: '09:00' },
    { id: 'a', name: 'A', order: 0, time: '09:00' },
  ]).map((x) => x.name);
  check('equal times fall back to entry order', sameTime.join(',') === 'A,B');

  check('ordering does not mutate the original list', orderedSports(s.sports) !== s.sports);
});

group('singles: everyone meets everyone, exactly once', () => {
  check('pairs of four are six', allPairs(idsFor(4)).length === 6);

  for (const n of [2, 3, 4, 5, 6, 7, 8]) {
    const ids = idsFor(n);
    const fixtures = singlesFixtures(ids);
    const expected = (n * (n - 1)) / 2;
    check(`${n} players give ${expected} matches`, fixtures.length === expected, `got ${fixtures.length}`);

    const seen = new Set();
    let duplicate = false;
    for (const [[a], [b]] of fixtures) {
      const key = [a, b].sort().join('|');
      if (seen.has(key)) duplicate = true;
      seen.add(key);
    }
    check(`${n} players: no pair plays twice`, !duplicate);
    check(`${n} players: every pair is covered`, seen.size === expected);
  }

  check('one player has nothing to play', singlesFixtures(['p1']).length === 0);
  check('a singles match holds one player per side', singlesFixtures(idsFor(2))[0].every((side) => side.length === 1));
});

group('doubles: partners and opponents rotate', () => {
  for (const n of [4, 5, 6, 8]) {
    const ids = idsFor(n);
    const fixtures = doublesFixtures(ids);
    check(`${n} players get a doubles programme`, fixtures.length > 0, `got ${fixtures.length}`);
    check(
      `${n} players: every match is four different players`,
      fixtures.every(([a, b]) => new Set([...a, ...b]).size === 4)
    );
    check(
      `${n} players: two on each side`,
      fixtures.every(([a, b]) => a.length === 2 && b.length === 2)
    );

    const playedCount = new Map(ids.map((id) => [id, 0]));
    const partners = new Map(ids.map((id) => [id, new Set()]));
    const opponents = new Map(ids.map((id) => [id, new Set()]));
    for (const [a, b] of fixtures) {
      for (const [side, other] of [[a, b], [b, a]]) {
        for (const id of side) {
          playedCount.set(id, playedCount.get(id) + 1);
          side.filter((x) => x !== id).forEach((x) => partners.get(id).add(x));
          other.forEach((x) => opponents.get(id).add(x));
        }
      }
    }
    check(`${n} players: nobody sits out the whole sport`, [...playedCount.values()].every((c) => c > 0));
    check(
      `${n} players: everyone partners everyone`,
      [...partners.values()].every((set) => set.size === n - 1),
      [...partners.values()].map((s) => s.size).join(',')
    );
    check(
      `${n} players: everyone meets everyone`,
      [...opponents.values()].every((set) => set.size === n - 1),
      [...opponents.values()].map((s) => s.size).join(',')
    );
  }

  check('three players cannot play doubles', doublesFixtures(idsFor(3)).length === 0);
});

group('all vs all is one round with everybody in it', () => {
  const fixtures = fixturesFor(idsFor(5), 'ffa');
  check('one match for the whole sport', fixtures.length === 1);
  check('every player is in it', fixtures[0].length === 5);
  check('each player is his own side', fixtures[0].every((side) => side.length === 1));
  check('one player alone is no contest', fixturesFor(['p1'], 'ffa').length === 0);
});

group('the app sets the championship up itself', () => {
  const s = baseState();
  buildAllProgrammes(s);

  check('nothing is left to schedule by hand', s.matches.length > 0);
  check('padel (2v2) has matches', matchesForSport(s.matches, 's1').length > 0);
  check('darts (1v1) is a full round robin of 15', matchesForSport(s.matches, 's2').length === 15);
  check('mini golf (all vs all) is one match', matchesForSport(s.matches, 's3').length === 1);
  check('every match id is unique', new Set(s.matches.map((m) => m.id)).size === s.matches.length);
  check('every match starts unplayed', s.matches.every((m) => !m.done && m.sides.every((x) => x.score === null)));
  check(
    'everyone is in the darts programme',
    new Set(matchesForSport(s.matches, 's2').flatMap(playersInMatch)).size === 6
  );
  check('the preview count matches what is built', fixtureCount(6, '1v1') === 15);

  // Rebuilding one sport leaves the others alone.
  const before = matchesForSport(s.matches, 's2').length;
  s.sports[0].format = '1v1';
  const rebuilt = buildProgramme(s, 's1');
  check('a rebuilt sport follows its new format', rebuilt.length === 15);
  check('the other sports keep their matches', matchesForSport(s.matches, 's2').length === before);
});

group('a hand-added extra match still has to make sense', () => {
  check('1v1 needs both sides filled', validateMatch(['p1'], [], '1v1') !== null);
  check('1v1 with one each is fine', validateMatch(['p1'], ['p2'], '1v1') === null);
  check('1v1 rejects two on a side', validateMatch(['p1', 'p2'], ['p3'], '1v1') !== null);
  check('2v2 needs four players', validateMatch(['p1', 'p2'], ['p3'], '2v2') !== null);
  check('2v2 with two each is fine', validateMatch(['p1', 'p2'], ['p3', 'p4'], '2v2') === null);
  check('nobody plays against himself', validateMatch(['p1'], ['p1'], '1v1') !== null);
  check(
    'nobody appears twice in a doubles match',
    validateMatch(['p1', 'p2'], ['p2', 'p3'], '2v2') !== null
  );

  const s = baseState();
  const extra = createMatch(s, 's2', ['p1'], ['p3']);
  check('an extra match lands on the right sport', extra.sportId === 's2');
  check('it holds one player per side', extra.sides.length === 2 && extra.sides[0].players.length === 1);

  let threw = false;
  try { createMatch(s, 's2', ['p1'], ['p1']); } catch { threw = true; }
  check('creating an invalid match throws', threw);
});

group('running order across sports', () => {
  const s = baseState({ sports: baseState().sports.map((x) => ({ ...x, format: '1v1' })) });
  s.players = players.slice(0, 2);
  buildAllProgrammes(s);

  const order = orderedMatches(s).map((m) => m.sportId);
  check('matches follow the booked times', order.join(',') === 's2,s1,s3', order.join(','));
  check('the next match is the earliest unplayed one', nextUnplayed(s).sportId === 's2');
  orderedMatches(s)[0].done = true;
  check('once played, the next one moves on', nextUnplayed(s).sportId === 's1');
  s.matches.forEach((m) => { m.done = true; });
  check('nothing left returns null', nextUnplayed(s) === null);
  check('progress counts every match', progress(s.matches).done === 3);
});

group('standings — win = 3', () => {
  const s = baseState({
    matches: [
      { id: 'm1', sportId: 's1', sides: played([['p1', 'p2'], 21], [['p3', 'p4'], 15]), done: true },
      { id: 'm2', sportId: 's1', sides: played([['p1', 'p3'], 10], [['p2', 'p4'], 10]), done: true },
      { id: 'm3', sportId: 's2', sides: played([['p1'], 5], [['p2'], 12]), done: true },
      { id: 'm4', sportId: 's2', sides: sides(['p3'], ['p4']), done: false },
    ],
  });

  const table = standings(s);
  const row = (id) => table.find((r) => r.playerId === id);

  check('Jesper: win + draw + loss = 4', row('p1').points === 4, `got ${row('p1').points}`);
  check('Martin: win + draw + win = 7', row('p2').points === 7, `got ${row('p2').points}`);
  check('Bent: loss + draw = 1', row('p3').points === 1, `got ${row('p3').points}`);
  check('Martin leads', table[0].playerId === 'p2');
  check('unplayed matches are ignored', row('p3').played === 2);
  check('players who never played show zero', row('p5').played === 0 && row('p5').points === 0);
  check('the generation travels into the table', row('p3').generation === 'granddad');
  check('Jesper scored 21+10+5 = 36', row('p1').pointsFor === 36);
  check('Jesper conceded 15+10+12 = 37', row('p1').pointsAgainst === 37);
  check('difference is -1', row('p1').diff === -1);
  check('win/draw/loss add up', row('p1').won === 1 && row('p1').drawn === 1 && row('p1').lost === 1);
  check('in two-sided matches every difference cancels out', table.reduce((sum, r) => sum + r.diff, 0) === 0);

  const perSport = standings(s, 's2');
  check('a per-sport table only counts that sport', perSport.find((r) => r.playerId === 'p1').played === 1);
  check('Martin won the only darts match', perSport[0].playerId === 'p2' && perSport[0].points === 3);
});

group('standings — the point type is per sport', () => {
  const s = baseState({
    matches: [
      // padel counts the result, mini golf counts every point scored
      { id: 'm1', sportId: 's1', sides: played([['p1', 'p2'], 21], [['p3', 'p4'], 15]), done: true },
      { id: 'm2', sportId: 's3', sides: played([['p1'], 30], [['p2'], 12], [['p3'], 25]), done: true },
    ],
  });
  const table = standings(s);
  const row = (id) => table.find((r) => r.playerId === id);

  check('Jesper: 3 for the padel win + 30 mini golf points', row('p1').points === 33, `got ${row('p1').points}`);
  check('Martin: 3 for the padel win + 12 mini golf points', row('p2').points === 15, `got ${row('p2').points}`);
  check('Bent: 0 for the padel loss + 25 mini golf points', row('p3').points === 25, `got ${row('p3').points}`);
  check('Jesper leads on the mixed total', table[0].playerId === 'p1');

  const golf = standings(s, 's3');
  check('the mini golf table is point for point', golf[0].playerId === 'p1' && golf[0].points === 30);
  check('everybody in the round is counted', golf.filter((r) => r.played > 0).length === 3);
  check('second place scored 25', golf[1].playerId === 'p3' && golf[1].points === 25);
});

group('all vs all decides a winner, a loser and a draw', () => {
  const s = baseState({
    sports: [{ id: 's3', name: 'Mini golf', order: 0, format: 'ffa', scoring: 'match', time: null }],
    matches: [
      { id: 'm1', sportId: 's3', sides: played([['p1'], 30], [['p2'], 12], [['p3'], 25]), done: true },
    ],
  });
  const table = standings(s);
  const row = (id) => table.find((r) => r.playerId === id);

  check('the best score takes the 3 points', row('p1').points === 3 && row('p1').won === 1);
  check('everybody else loses the round', row('p2').points === 0 && row('p3').points === 0);
  check('you are measured against the best of the rest', row('p2').pointsAgainst === 30);
  check('the winner is measured against the runner-up', row('p1').pointsAgainst === 25);
  check('the winning side is reported', winningSide(s.matches[0]).players[0] === 'p1');

  const tied = { ...s, matches: [{ id: 'm1', sportId: 's3', sides: played([['p1'], 20], [['p2'], 20]), done: true }] };
  const tiedTable = standings(tied);
  check('a shared best score is a draw for both', tiedTable.every((r) => r.played === 0 || r.points === 1));
  check('a tie has no winning side', winningSide(tied.matches[0]) === null);
  check('an unplayed match has no winning side', winningSide({ done: false, sides: [] }) === null);
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
