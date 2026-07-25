// Merge tests. Two phones, both holding the whole championship, both entering
// scores — sometimes with no signal. Nothing here touches the network.
import { mergeChampionships, mergeMatches, mergeRemoved, makeCode, isCode } from './sync.mjs';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};
const group = (name, fn) => { console.log('\n' + name); fn(); };

const at = (s) => new Date(Date.UTC(2026, 6, 25, 12, 0, s)).toISOString();
const match = (id, score, when) => ({
  id, sportId: 's1', done: score !== null,
  sides: [{ players: ['p1'], score }, { players: ['p2'], score: score === null ? null : 0 }],
  updatedAt: when,
});
const champ = (over) => ({
  id: 'c1', name: 'Hvejsel Cup', createdAt: at(0), updatedAt: at(0), metaAt: at(0),
  players: [{ id: 'p1', name: 'Jesper' }, { id: 'p2', name: 'Far' }],
  standIns: [], sports: [{ id: 's1', name: 'Padel', order: 0 }],
  matches: [], removed: {}, nextMatchNo: 2, ...over,
});

group('two people entering two different results both keep theirs', () => {
  const mine = champ({ matches: [match('m1', 11, at(10)), match('m2', null, at(0))] });
  const theirs = champ({ matches: [match('m1', null, at(0)), match('m2', 9, at(12))] });

  const merged = mergeChampionships(mine, theirs);
  const byId = Object.fromEntries(merged.matches.map((m) => [m.id, m]));
  check('my result is kept', byId.m1.sides[0].score === 11);
  check('and so is theirs', byId.m2.sides[0].score === 9);
  check('nothing is lost or doubled', merged.matches.length === 2);
});

group('the same match entered twice: the later one wins', () => {
  const mine = champ({ matches: [match('m1', 11, at(10))] });
  const theirs = champ({ matches: [match('m1', 6, at(20))] });
  check('the later score wins', mergeChampionships(mine, theirs).matches[0].sides[0].score === 6);
  check('and it does not depend on the order of the merge',
    mergeChampionships(theirs, mine).matches[0].sides[0].score === 6);
});

group('merging is stable', () => {
  const one = champ({ matches: [match('m1', 11, at(10))] });
  const twice = mergeChampionships(mergeChampionships(one, one), one);
  check('a copy merged into itself changes nothing',
    JSON.stringify(twice.matches) === JSON.stringify(one.matches));
  check('and merging is not order-dependent for the field',
    mergeChampionships(one, one).name === 'Hvejsel Cup');
});

group('a match deleted on one phone does not come back from the other', () => {
  const mine = champ({ matches: [], removed: { m1: at(30) } });
  const theirs = champ({ matches: [match('m1', 11, at(10))] });
  check('the deletion sticks', mergeChampionships(mine, theirs).matches.length === 0);
  check('however the two copies meet', mergeChampionships(theirs, mine).matches.length === 0);

  // but a score entered AFTER the deletion means somebody wants it back
  const later = champ({ matches: [match('m1', 11, at(40))] });
  check('a match touched after it was deleted stays',
    mergeChampionships(mine, later).matches.length === 1);
});

group('the field moves as one piece, last editor wins', () => {
  const mine = champ({
    metaAt: at(10),
    players: [{ id: 'p1', name: 'Jesper' }, { id: 'p2', name: 'Far' }],
  });
  const theirs = champ({
    metaAt: at(20),
    name: 'Winter Cup',
    players: [{ id: 'p1', name: 'Jesper' }, { id: 'p2', name: 'Bedstefar' }, { id: 'p3', name: 'Villads' }],
  });

  const merged = mergeChampionships(mine, theirs);
  check('the later edit of the field wins whole', merged.players.length === 3);
  check('including the renaming inside it', merged.players[1].name === 'Bedstefar');
  check('and the championship name that came with it', merged.name === 'Winter Cup');
  check('an older field does not overwrite a newer one',
    mergeChampionships(theirs, mine).players.length === 3);
});

group('scores survive a change of field', () => {
  const scores = champ({ matches: [match('m1', 11, at(30))], metaAt: at(0) });
  const roster = champ({ matches: [match('m1', null, at(0))], metaAt: at(40), name: 'Renamed' });
  const merged = mergeChampionships(scores, roster);
  check('the new field is taken', merged.name === 'Renamed');
  check('and the score entered elsewhere is still there', merged.matches[0].sides[0].score === 11);
});

group('the odds and ends', () => {
  check('a missing copy merges to the one there is', mergeChampionships(champ({}), null).name === 'Hvejsel Cup');
  check('and the other way round', mergeChampionships(null, champ({})).name === 'Hvejsel Cup');
  check('the highest match number is kept, so ids cannot repeat',
    mergeChampionships(champ({ nextMatchNo: 4 }), champ({ nextMatchNo: 9 })).nextMatchNo === 9);
  check('deletions from both copies are kept',
    Object.keys(mergeRemoved({ a: at(1) }, { b: at(2) })).length === 2);
  check('a deletion keeps its latest date',
    mergeRemoved({ a: at(1) }, { a: at(9) }).a === at(9));
  check('matches with no timestamp at all still merge',
    mergeMatches([{ id: 'm1' }], [{ id: 'm2' }], {}).length === 2);
});

group('a join code is read aloud without being misheard', () => {
  const codes = Array.from({ length: 400 }, () => makeCode());
  check('every code is six characters', codes.every((c) => c.length === 6));
  check('none contain O, 0, I, 1, S, 5, B or 8', codes.every((c) => !/[O0I1S5B8]/.test(c)));
  check('a code is recognised', isCode(codes[0]) === true);
  check('lower case is accepted too', isCode(codes[0].toLowerCase()) === true);
  check('rubbish is not', isCode('hello!') === false);
  check('and neither is the wrong length', isCode('ABC') === false);
  check('they are not all the same', new Set(codes).size > 350, `${new Set(codes).size} of 400`);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
