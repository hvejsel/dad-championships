// Engine tests. Run with: node test.mjs
import {
  GENERATIONS,
  generationLabel,
  teamSize,
  orderedSports,
  matchesForSport,
  orderedMatches,
  unassignedPlayers,
  validateMatch,
  createMatch,
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
    scoring: 'match',
    nextMatchNo: 0,
    sports: [
      { id: 's1', name: 'Padel', order: 0, format: '2v2', time: '13:00' },
      { id: 's2', name: 'Darts', order: 1, format: '1v1', time: '10:30' },
      { id: 's3', name: 'Bowling', order: 2, format: '1v1', time: null },
    ],
    matches: [],
    ...overrides,
  };
}

group('generations', () => {
  check('three generations exist', GENERATIONS.length === 3);
  check('dad, granddad and kid', GENERATIONS.map((g) => g.id).join(',') === 'dad,granddad,kid');
  check('granddad reads as Granddad', generationLabel('granddad') === 'Granddad');
  check('an unknown generation falls back to Dad', generationLabel('nonsense') === 'Dad');
});

group('per-sport format', () => {
  check('1v1 puts one player on a side', teamSize('1v1') === 1);
  check('2v2 puts two players on a side', teamSize('2v2') === 2);
  const s = baseState();
  check('sports can differ from each other', s.sports[0].format === '2v2' && s.sports[1].format === '1v1');
});

group('booked times drive the running order', () => {
  const s = baseState();
  const order = orderedSports(s.sports).map((x) => x.name);
  check('earliest booked time comes first', order[0] === 'Darts', order.join(','));
  check('later booked time follows', order[1] === 'Padel', order.join(','));
  check('a sport with no time goes last', order[2] === 'Bowling', order.join(','));

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

group('choosing opponents by hand', () => {
  const s = baseState();

  check('nothing is scheduled until you add it', s.matches.length === 0);
  check('everyone is without an opponent at the start', unassignedPlayers(s, 's2').length === 6);

  const m1 = createMatch(s, 's2', ['p1'], ['p3']);
  s.matches.push(m1);
  check('a singles match holds one player per side', m1.teamA.length === 1 && m1.teamB.length === 1);
  check('a new match starts unplayed', !m1.done && m1.scoreA === null);
  check('the two chosen players drop off the waiting list', unassignedPlayers(s, 's2').length === 4);
  check(
    'the waiting list names who is left',
    unassignedPlayers(s, 's2').map((p) => p.name).join(',') === 'Martin,Emil,Alma,Ove'
  );
  check('another sport is untouched', unassignedPlayers(s, 's1').length === 6);

  const m2 = createMatch(s, 's1', ['p1', 'p2'], ['p3', 'p4']);
  s.matches.push(m2);
  check('a doubles match holds two players per side', m2.teamA.length === 2 && m2.teamB.length === 2);
  check('match ids are unique', m1.id !== m2.id);
  check('padel now has one match', matchesForSport(s.matches, 's1').length === 1);
  check('two of six still wait in padel', unassignedPlayers(s, 's1').length === 2);

  check('not everyone has to play everyone', s.matches.length === 2);
});

group('a match has to make sense', () => {
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
  let threw = false;
  try { createMatch(s, 's2', ['p1'], ['p1']); } catch { threw = true; }
  check('creating an invalid match throws', threw);
});

group('running order across sports', () => {
  const s = baseState();
  s.matches.push(createMatch(s, 's1', ['p1', 'p2'], ['p3', 'p4'])); // padel, 13:00
  s.matches.push(createMatch(s, 's3', ['p1'], ['p2']));             // bowling, no time
  s.matches.push(createMatch(s, 's2', ['p5'], ['p6']));             // darts, 10:30

  const order = orderedMatches(s).map((m) => m.sportId);
  check('matches follow the booked times', order.join(',') === 's2,s1,s3', order.join(','));

  check('the next match is the earliest unplayed one', nextUnplayed(s).sportId === 's2');
  s.matches.find((m) => m.sportId === 's2').done = true;
  check('once played, the next one moves on', nextUnplayed(s).sportId === 's1');
  s.matches.forEach((m) => { m.done = true; });
  check('nothing left returns null', nextUnplayed(s) === null);
  check('progress counts every match', progress(s.matches).done === 3);
});

group('standings — match points', () => {
  const s = baseState({
    matches: [
      { id: 'm1', sportId: 's1', teamA: ['p1', 'p2'], teamB: ['p3', 'p4'], scoreA: 21, scoreB: 15, done: true },
      { id: 'm2', sportId: 's1', teamA: ['p1', 'p3'], teamB: ['p2', 'p4'], scoreA: 10, scoreB: 10, done: true },
      { id: 'm3', sportId: 's2', teamA: ['p1'], teamB: ['p2'], scoreA: 5, scoreB: 12, done: true },
      { id: 'm4', sportId: 's2', teamA: ['p3'], teamB: ['p4'], scoreA: null, scoreB: null, done: false },
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
  check('every difference cancels out', table.reduce((sum, r) => sum + r.diff, 0) === 0);

  const perSport = standings(s, 's2');
  check('a per-sport table only counts that sport', perSport.find((r) => r.playerId === 'p1').played === 1);
  check('Martin won the only darts match', perSport[0].playerId === 'p2' && perSport[0].points === 3);
});

group('standings — points scored', () => {
  const s = baseState({
    scoring: 'score',
    matches: [
      { id: 'm1', sportId: 's1', teamA: ['p1', 'p2'], teamB: ['p3', 'p4'], scoreA: 21, scoreB: 15, done: true },
      { id: 'm2', sportId: 's1', teamA: ['p1', 'p3'], teamB: ['p2', 'p4'], scoreA: 10, scoreB: 18, done: true },
    ],
  });
  const table = standings(s);
  const row = (id) => table.find((r) => r.playerId === id);
  check('Jesper collects 21 + 10 = 31', row('p1').points === 31);
  check('Martin collects 21 + 18 = 39', row('p2').points === 39);
  check('Martin leads on points scored', table[0].playerId === 'p2');
});

group('ties', () => {
  const s = baseState({
    matches: [
      { id: 'm1', sportId: 's2', teamA: ['p1'], teamB: ['p2'], scoreA: 20, scoreB: 1, done: true },
      { id: 'm2', sportId: 's2', teamA: ['p3'], teamB: ['p4'], scoreA: 11, scoreB: 10, done: true },
    ],
  });
  const table = standings(s);
  check('equal points split on score difference', table[0].playerId === 'p1', table[0].playerId);
  check('the narrower win ranks second', table[1].playerId === 'p3', table[1].playerId);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
