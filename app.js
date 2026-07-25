import {
  GENERATIONS,
  generationLabel,
  FORMATS,
  formatLabel,
  SCORINGS,
  scoringSummary,
  WIN_POINT_CHOICES,
  DEFAULT_WIN_POINTS,
  isFreeForAll,
  orderedSports,
  matchesForSport,
  matchesPerSport,
  sportsToCoverEveryone,
  pairCoverage,
  playersSittingOut,
  buildProgramme,
  buildAllProgrammes,
  winningSide,
  standings,
  nextUnplayed,
  progress,
  migrateState,
  STATE_VERSION,
} from './tournament.js';

const STATE_KEY = 'dadchamps.state.v3';
const LEGACY_STATE_KEYS = ['dadchamps.state.v2'];
const DRAFT_KEY = 'dadchamps.draft.v3';

const SPORT_SUGGESTIONS = [
  'Padel', 'Darts', 'Bowling', 'Table tennis', 'Mini golf', 'Pool',
  'Badminton', 'Basketball shootout', 'Shuffleboard', 'Boules',
];

const OTHER = '__other';

const LIMITS = {
  sports: { min: 1, max: 10 },
  players: { min: 2, max: 20 },
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* ----------------------------- persistence ----------------------------- */
/* Everything lives on the phone that keeps score: it survives a refresh, a
   restart and a day with no signal. The store is migrated in place on load, so
   an app update never costs you a running championship.                     */

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or full storage — the app still works for this session */
  }
}

function loadChampionship() {
  let saved = load(STATE_KEY, null);
  if (!saved) {
    // a championship saved by an older version of the app is taken over
    for (const key of LEGACY_STATE_KEYS) {
      saved = load(key, null);
      if (saved) break;
    }
  }
  const migrated = migrateState(saved);
  if (migrated && (!saved || saved.version !== STATE_VERSION)) save(STATE_KEY, migrated);
  return migrated;
}

/* -------------------------------- state -------------------------------- */

let state = loadChampionship();

let draft = load(DRAFT_KEY, null) || {
  step: 1,
  playerCount: 4,
  playerNames: ['', '', '', ''],
  playerGenerations: ['dad', 'dad', 'granddad', 'kid'],
  sportCount: 3,
  sportNames: SPORT_SUGGESTIONS.slice(0, 3),
  sportCustom: [false, false, false],
  sportFormats: ['1v1', '1v1', '1v1'],
  sportScorings: ['match', 'match', 'match'],
  sportWinPoints: [3, 3, 3],
};

let view = 'matches';
let tableFilter = 'all';
let editingMatchId = null;
let editingSportId = null;
let newSport = null; // the sport being added mid-championship

const saveState = () => save(STATE_KEY, state);
const saveDraft = () => save(DRAFT_KEY, draft);

/* ------------------------------- helpers ------------------------------- */

function playerOf(playerId) {
  return state.players.find((p) => p.id === playerId);
}

function nameOf(playerId) {
  const player = playerOf(playerId);
  return player ? player.name : '?';
}

function teamHtml(players) {
  return players.map((id) => escapeHtml(nameOf(id))).join(' <span class="and">&</span> ');
}

function teamText(players) {
  return players.map((id) => nameOf(id)).join(' & ');
}

function sportOf(sportId) {
  return state.sports.find((s) => s.id === sportId);
}

function sportName(sportId) {
  const sport = sportOf(sportId);
  return sport ? sport.name : '';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/** A select, drawn as a control rather than a browser default. */
function selectHtml({ id = '', attr = '', options, value, extra = '' }) {
  const opts = options
    .map(
      (o) =>
        `<option value="${escapeHtml(o.value)}"${
          String(o.value) === String(value) ? ' selected' : ''
        }>${escapeHtml(o.label)}</option>`
    )
    .join('');
  return `<span class="sel ${extra}">
    <select ${id ? `id="${id}"` : ''} ${attr}>${opts}</select>
  </span>`;
}

function countOptions(kind, noun) {
  const { min, max } = LIMITS[kind];
  return Array.from({ length: max - min + 1 }, (_, i) => ({
    value: String(min + i),
    label: `${min + i} ${noun}${min + i === 1 ? '' : 's'}`,
  }));
}

const FORMAT_OPTIONS = FORMATS.map((f) => ({ value: f.id, label: f.label }));
const FORMAT_OPTIONS_LONG = FORMATS.map((f) => ({ value: f.id, label: `${f.label} — ${f.note}` }));
const SCORING_OPTIONS = SCORINGS.map((s) => ({ value: s.id, label: s.label }));
const SCORING_OPTIONS_LONG = SCORINGS.map((s) => ({ value: s.id, label: `${s.label} — ${s.note}` }));
const WIN_POINT_OPTIONS = WIN_POINT_CHOICES.map((n) => ({
  value: String(n),
  label: `Winner gets ${n}`,
}));
const SPORT_NAME_OPTIONS = [
  ...SPORT_SUGGESTIONS.map((s) => ({ value: s, label: s })),
  { value: OTHER, label: 'Other sport…' },
];

/** Brass, silver and bronze discs for the podium; a plain numeral below it. */
function medal(rank) {
  const cls = rank <= 3 ? `medal medal-${rank}` : 'medal medal-plain';
  return `<span class="${cls}">${rank}</span>`;
}

function genTag(generation) {
  return `<span class="gen gen-${generation}">${escapeHtml(generationLabel(generation))}</span>`;
}

const TROPHY_SVG = `
  <svg class="cup" width="98" height="98" viewBox="0 0 512 512" aria-hidden="true">
    <defs><linearGradient id="brass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d8ab4a"/><stop offset="1" stop-color="#8a6318"/>
    </linearGradient></defs>
    <g fill="none" stroke="url(#brass)" stroke-width="20">
      <path d="M148 132 a52 52 0 1 0 14 88"/>
      <path d="M364 132 a52 52 0 1 1 -14 88"/>
    </g>
    <path fill="url(#brass)"
          d="M158 122 h196 v54 c0 64-32 118-78 130 v46 h24 v18 h30 v30 h-148 v-30 h30 v-18 h24 v-46 c-46-12-78-66-78-130z"/>
  </svg>`;

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ================================ SETUP ================================ */

function renderSetup() {
  $$('#stepper li').forEach((li) => {
    const step = Number(li.dataset.step);
    li.classList.toggle('active', step === draft.step);
    li.classList.toggle('done', step < draft.step);
  });
  $$('.step').forEach((el) => { el.hidden = Number(el.dataset.step) !== draft.step; });

  $('#players-count-field').innerHTML = selectHtml({
    attr: 'data-count="players"',
    options: countOptions('players', 'player'),
    value: String(draft.playerCount),
    extra: 'sel-big',
  });
  $('#sports-count-field').innerHTML = selectHtml({
    attr: 'data-count="sports"',
    options: countOptions('sports', 'sport'),
    value: String(draft.sportCount),
    extra: 'sel-big',
  });

  renderPlayerRows();
  renderSportRows();
  renderPreview();
}

function renderPlayerRows() {
  const container = $('#player-names');
  container.innerHTML = '';
  for (let i = 0; i < draft.playerCount; i++) {
    const generation = draft.playerGenerations[i] || 'dad';
    const row = document.createElement('div');
    row.className = 'name-row';
    row.innerHTML = `
      <span class="badge">${i + 1}</span>
      <input type="text" data-kind="player" data-index="${i}"
             value="${escapeHtml(draft.playerNames[i] || '')}"
             placeholder="Name ${i + 1}"
             autocapitalize="words" autocomplete="off" spellcheck="false">
      ${selectHtml({
        attr: `data-gen-index="${i}" aria-label="Generation"`,
        options: GENERATIONS.map((g) => ({ value: g.id, label: g.label })),
        value: generation,
        extra: `sel-gen gen-${generation}`,
      })}`;
    container.appendChild(row);
  }
}

function renderSportRows() {
  const container = $('#sport-rows');
  container.innerHTML = '';
  for (let i = 0; i < draft.sportCount; i++) {
    const custom = Boolean(draft.sportCustom[i]);
    const name = draft.sportNames[i] || '';
    const format = draft.sportFormats[i] || '1v1';
    const scoring = draft.sportScorings[i] || 'match';
    const winPoints = draft.sportWinPoints[i] || DEFAULT_WIN_POINTS;
    const matches = matchesPerSport(draft.playerCount, format);

    const row = document.createElement('div');
    row.className = 'sport-row';
    row.innerHTML = `
      ${selectHtml({
        attr: `data-sport-index="${i}" aria-label="Sport ${i + 1}"`,
        options: SPORT_NAME_OPTIONS,
        value: custom ? OTHER : name,
        extra: 'sel-title',
      })}
      ${
        custom
          ? `<input type="text" data-kind="sport" data-index="${i}" class="custom-name"
                    value="${escapeHtml(name)}" placeholder="Name the sport"
                    autocapitalize="words" autocomplete="off" spellcheck="false">`
          : ''
      }
      <div class="sport-row-controls">
        ${selectHtml({
          attr: `data-format-index="${i}" aria-label="Game type"`,
          options: FORMAT_OPTIONS,
          value: format,
          extra: 'sel-soft',
        })}
        ${selectHtml({
          attr: `data-scoring-index="${i}" aria-label="Point type"`,
          options: SCORING_OPTIONS,
          value: scoring,
          extra: 'sel-soft',
        })}
        ${
          scoring === 'match'
            ? selectHtml({
                attr: `data-winpoints-index="${i}" aria-label="What a win is worth"`,
                options: WIN_POINT_OPTIONS,
                value: String(winPoints),
                extra: 'sel-soft',
              })
            : ''
        }
        <span class="row-note">${
          matches ? `${matches} ${matches === 1 ? 'match' : 'matches'}` : 'needs more players'
        }</span>
      </div>`;
    container.appendChild(row);
  }
}

function resolvedNames(values, count, fallback) {
  return Array.from({ length: count }, (_, i) => (values[i] || '').trim() || fallback(i));
}

function renderPreview() {
  const counts = { dad: 0, granddad: 0, kid: 0 };
  for (let i = 0; i < draft.playerCount; i++) counts[draft.playerGenerations[i] || 'dad'] += 1;
  const parts = GENERATIONS
    .filter((g) => counts[g.id] > 0)
    .map((g) => `${counts[g.id]} ${counts[g.id] === 1 ? g.label.toLowerCase() : `${g.label.toLowerCase()}s`}`);

  const total = draft.sportFormats
    .slice(0, draft.sportCount)
    .reduce((sum, format) => sum + matchesPerSport(draft.playerCount, format || '1v1'), 0);

  // How many sports it takes before everyone has met everyone, counted on the
  // game type most of the sports use.
  const heaviest = draft.sportFormats.slice(0, draft.sportCount).includes('1v1') ? '1v1' : draft.sportFormats[0] || '1v1';
  const needed = sportsToCoverEveryone(draft.playerCount, heaviest);
  const coverage =
    draft.sportCount >= needed
      ? `With <strong>${draft.sportCount}</strong> ${draft.sportCount === 1 ? 'sport' : 'sports'} everyone has met everyone.`
      : `Everyone has met everyone after <strong>${needed}</strong> sports — you can add more later.`;

  $('#setup-preview').innerHTML =
    `<strong>${parts.join(', ')}</strong> across ` +
    `<strong>${draft.sportCount}</strong> ${draft.sportCount === 1 ? 'sport' : 'sports'}, ` +
    `<strong>${total}</strong> ${total === 1 ? 'match' : 'matches'} in all. ` +
    `One match each per sport. ${coverage}<br>` +
    `You put the times on afterwards, as you book the courts.`;

  const error = validateDraft();
  $('#setup-error').hidden = !error;
  $('#setup-error').textContent = error || '';
  $('#btn-create').disabled = Boolean(error);
}

function validateDraft() {
  if (draft.playerCount < 2) return 'You need at least 2 players.';
  if (draft.sportCount < 1) return 'Pick at least one sport.';
  for (let i = 0; i < draft.sportCount; i++) {
    const format = FORMATS.find((f) => f.id === (draft.sportFormats[i] || '1v1'));
    if (draft.playerCount < format.min) {
      return `${format.label} needs at least ${format.min} players. Add more, or change that sport's game type.`;
    }
  }
  return null;
}

function createChampionship() {
  if (validateDraft()) return;

  const players = resolvedNames(draft.playerNames, draft.playerCount, (i) => `Player ${i + 1}`).map(
    (name, i) => ({ id: `p${i + 1}`, name, generation: draft.playerGenerations[i] || 'dad' })
  );

  const sports = resolvedNames(draft.sportNames, draft.sportCount, (i) =>
    SPORT_SUGGESTIONS[i] || `Sport ${i + 1}`
  ).map((name, i) => ({
    id: `s${i + 1}`,
    name,
    order: i,
    format: draft.sportFormats[i] || '1v1',
    scoring: draft.sportScorings[i] || 'match',
    winPoints: draft.sportWinPoints[i] || DEFAULT_WIN_POINTS,
    time: null, // set later, on the match list, as the courts are booked
  }));

  state = {
    version: STATE_VERSION,
    createdAt: new Date().toISOString(),
    players,
    sports,
    matches: [],
    nextMatchNo: 0,
  };
  buildAllProgrammes(state);

  saveState();
  view = 'matches';
  tableFilter = 'all';
  render();
}

/* =============================== MATCHES =============================== */

function fixtureRow(match, upNext) {
  const isNow = upNext && match.id === upNext.id;
  const classes = `fixture ${match.done ? 'played' : ''} ${isNow ? 'now' : ''}`;

  if (match.sides.length > 2) {
    const winner = winningSide(match);
    const result = match.done
      ? winner
        ? `${escapeHtml(nameOf(winner.players[0]))} ${winner.score}`
        : 'Tied'
      : isNow
        ? '<em>Up next</em>'
        : '—';
    return `
      <button class="${classes} ffa" data-match="${match.id}">
        <span class="who">${match.sides
          .map((side) => escapeHtml(nameOf(side.players[0])))
          .join(' <span class="and">·</span> ')}</span>
        <span class="res">${result}</span>
      </button>`;
  }

  const [a, b] = match.sides;
  return `
    <button class="${classes}" data-match="${match.id}">
      <span class="who">${teamHtml(a.players)}<br>${teamHtml(b.players)}</span>
      <span class="res">${
        match.done ? `${a.score} – ${b.score}` : isNow ? '<em>Up next</em>' : '—'
      }</span>
    </button>`;
}

/** What another sport would buy you: the pairings nobody has played yet. */
function coverageLine() {
  const { missing } = pairCoverage(state);
  if (!missing.length) {
    return '<p class="hint cover-line met">Everyone has met everyone.</p>';
  }
  const shown = missing
    .slice(0, 3)
    .map(([a, b]) => `${escapeHtml(nameOf(a))}–${escapeHtml(nameOf(b))}`)
    .join(', ');
  const rest = missing.length > 3 ? `, and ${missing.length - 3} more` : '';
  return `<p class="hint cover-line">Still to meet: ${shown}${rest}. Add a sport and the app picks those first.</p>`;
}

function renderMatches() {
  const body = $('#matches-body');
  const { done, total } = progress(state.matches);
  const upNext = nextUnplayed(state);
  const timed = state.sports.filter((s) => s.time).length;

  const header = total
    ? `<div class="bar"><i style="width:${(done / total) * 100}%"></i></div>
       <p class="eyebrow">${done} of ${total} ${total === 1 ? 'match' : 'matches'} played</p>`
    : '';

  const banner =
    upNext && sportOf(upNext.sportId).time
      ? `<div class="up-next">
           <span class="label">Next up — ${escapeHtml(sportOf(upNext.sportId).time)}</span>
           <strong>${escapeHtml(sportName(upNext.sportId))}: ${
             upNext.sides.length > 2
               ? 'everybody'
               : `${escapeHtml(teamText(upNext.sides[0].players))} vs ${escapeHtml(
                   teamText(upNext.sides[1].players)
                 )}`
           }</strong>
         </div>`
      : '';

  // Times are put on as the courts are booked, so the list says what is missing.
  const timeHint =
    timed < state.sports.length
      ? `<p class="hint time-hint">${
          timed === 0
            ? 'Tap a sport to set the time when you have booked it.'
            : `${state.sports.length - timed} ${
                state.sports.length - timed === 1 ? 'sport has' : 'sports have'
              } no time yet — tap to set it.`
        } The list sorts itself by time.</p>`
      : '';

  const blocks = orderedSports(state.sports)
    .map((sport) => {
      const matches = matchesForSport(state.matches, sport.id);
      const playedHere = matches.filter((m) => m.done).length;
      const sittingOut = playersSittingOut(state, sport.id);

      return `
        <div class="sport-block">
          <div class="sport-head">
            <div class="sport-head-main">
              <h3>${escapeHtml(sport.name)}</h3>
              <button class="time-chip ${sport.time ? 'set' : ''}" data-sport="${sport.id}">
                ${sport.time ? escapeHtml(sport.time) : 'Set time'}
              </button>
            </div>
            <span>${escapeHtml(formatLabel(sport.format))} · ${escapeHtml(
              scoringSummary(sport)
            )} · ${
              matches.length ? `${playedHere} of ${matches.length} played` : 'no matches'
            }</span>
          </div>

          ${
            matches.length
              ? `<div class="fixtures">${matches.map((m) => fixtureRow(m, upNext)).join('')}</div>`
              : ''
          }

          ${
            sittingOut.length
              ? `<p class="sitting-out">Sitting this one out: ${sittingOut
                  .map((p) => escapeHtml(p.name))
                  .join(', ')}</p>`
              : ''
          }
        </div>`;
    })
    .join('');

  const addSport = `
    <button class="add-match" id="btn-add-sport">
      <span aria-hidden="true">+</span> Add a sport
    </button>`;

  body.innerHTML = header + banner + timeHint + coverageLine() + blocks + addSport;

  $$('#matches-body .fixture').forEach((btn) => {
    btn.onclick = () => openScoreSheet(btn.dataset.match);
  });
  $$('#matches-body .time-chip').forEach((btn) => {
    btn.onclick = () => openSportSheet(btn.dataset.sport);
  });
  $('#btn-add-sport').onclick = openNewSportSheet;
}

/* ============================ SPORT SETTINGS =========================== */

function winPointsRowHtml(id, scoring, winPoints) {
  return `<div class="win-points-row" ${scoring === 'match' ? '' : 'hidden'}>
    <p class="eyebrow">What a win is worth</p>
    ${selectHtml({ id, options: WIN_POINT_OPTIONS, value: String(winPoints), extra: 'sel-wide' })}
  </div>`;
}

function openSportSheet(sportId) {
  const sport = sportOf(sportId);
  editingSportId = sportId;
  $('#sport-sheet-title').textContent = sport.name;
  $('#sport-time').value = sport.time || '';

  $('#sport-format-field').innerHTML = selectHtml({
    id: 'sport-format',
    options: FORMAT_OPTIONS_LONG,
    value: sport.format,
    extra: 'sel-wide',
  });
  $('#sport-scoring-field').innerHTML =
    selectHtml({
      id: 'sport-scoring',
      options: SCORING_OPTIONS_LONG,
      value: sport.scoring,
      extra: 'sel-wide',
    }) + winPointsRowHtml('sport-winpoints', sport.scoring, sport.winPoints || DEFAULT_WIN_POINTS);

  $('#sport-sheet').hidden = false;
}

function saveSportSheet() {
  const sport = sportOf(editingSportId);
  const time = $('#sport-time').value || null;
  const format = $('#sport-format').value;
  const scoring = $('#sport-scoring').value;
  const winPoints = Number($('#sport-winpoints').value) || DEFAULT_WIN_POINTS;

  if (format !== sport.format) {
    const wanted = FORMATS.find((f) => f.id === format);
    if (state.players.length < wanted.min) {
      toast(`${wanted.label} needs at least ${wanted.min} players`);
      return;
    }
    const finished = matchesForSport(state.matches, sport.id).filter((m) => m.done).length;
    const question = finished
      ? `Change ${sport.name} to ${formatLabel(format)}? A new match is drawn for this sport and the ${finished} ${
          finished === 1 ? 'result' : 'results'
        } already entered for it are lost.`
      : `Change ${sport.name} to ${formatLabel(format)}? A new match is drawn for this sport.`;
    if (!confirm(question)) return;

    sport.format = format;
    state.matches = state.matches.filter((m) => m.sportId !== sport.id);
    state.matches.push(...buildProgramme(state, sport.id));
  }
  sport.scoring = scoring;
  sport.winPoints = winPoints;
  sport.time = time;

  saveState();
  $('#sport-sheet').hidden = true;
  editingSportId = null;
  render();
  toast('Sport updated');
}

/* =========================== A SPORT ADDED LATER ======================== */

function openNewSportSheet() {
  const taken = state.sports.map((s) => s.name);
  const suggestion = SPORT_SUGGESTIONS.find((s) => !taken.includes(s)) || SPORT_SUGGESTIONS[0];
  newSport = { name: suggestion, custom: false, format: '1v1', scoring: 'match', winPoints: DEFAULT_WIN_POINTS, time: '' };
  renderNewSportSheet();
  $('#new-sport-sheet').hidden = false;
}

function renderNewSportSheet() {
  const matches = matchesPerSport(state.players.length, newSport.format);
  const { missing } = pairCoverage(state);

  $('#new-sport-body').innerHTML = `
    <p class="eyebrow">Sport</p>
    ${selectHtml({ id: 'new-sport-name', options: SPORT_NAME_OPTIONS, value: newSport.custom ? OTHER : newSport.name, extra: 'sel-wide' })}
    ${
      newSport.custom
        ? `<input type="text" id="new-sport-custom" class="sheet-input" value="${escapeHtml(
            newSport.name
          )}" placeholder="Name the sport" autocapitalize="words" autocomplete="off" spellcheck="false">`
        : ''
    }

    <p class="eyebrow">Game type</p>
    ${selectHtml({ id: 'new-sport-format', options: FORMAT_OPTIONS_LONG, value: newSport.format, extra: 'sel-wide' })}

    <p class="eyebrow">Point type</p>
    ${selectHtml({ id: 'new-sport-scoring', options: SCORING_OPTIONS_LONG, value: newSport.scoring, extra: 'sel-wide' })}
    ${winPointsRowHtml('new-sport-winpoints', newSport.scoring, newSport.winPoints)}

    <p class="eyebrow">Booked time (optional)</p>
    <div class="time-row">
      <input id="new-sport-time" type="time" value="${escapeHtml(newSport.time || '')}">
      <button class="link-btn" id="new-sport-time-clear">Clear</button>
    </div>

    <div class="preview">
      ${
        matches
          ? `<strong>${matches}</strong> ${matches === 1 ? 'match' : 'matches'}, one for each player. ` +
            (missing.length
              ? `The app picks from the <strong>${missing.length}</strong> ${
                  missing.length === 1 ? 'pairing' : 'pairings'
                } nobody has played yet.`
              : 'Everyone has already met everyone, so this one is for the fun of it.')
          : `${formatLabel(newSport.format)} needs more players than you have.`
      }
    </div>`;

  $('#new-sport-time-clear').onclick = () => { $('#new-sport-time').value = ''; };
  $('#new-sport-save').disabled = !matches;
}

function readNewSportSheet() {
  const custom = $('#new-sport-custom');
  newSport.time = $('#new-sport-time').value || '';
  if (custom) newSport.name = custom.value;
}

function addNewSport() {
  readNewSportSheet();
  const name = (newSport.name || '').trim() || 'New sport';
  const nextNo = state.sports.reduce((max, s) => Math.max(max, Number(String(s.id).slice(1)) || 0), 0) + 1;
  const sport = {
    id: `s${nextNo}`,
    name,
    order: state.sports.length,
    format: newSport.format,
    scoring: newSport.scoring,
    winPoints: newSport.winPoints,
    time: newSport.time || null,
  };
  state.sports.push(sport);
  const built = buildProgramme(state, sport.id);
  if (!built.length) {
    state.sports.pop();
    toast(`${formatLabel(sport.format)} needs more players`);
    return;
  }
  state.matches.push(...built);

  saveState();
  $('#new-sport-sheet').hidden = true;
  newSport = null;
  view = 'matches';
  render();
  toast(`${name} added`);
}

/* ============================== SCORE SHEET ============================= */

function scoreStepper(key, value) {
  return `
    <div class="score-control">
      <button class="round-btn" data-score="${key}" data-delta="-1" aria-label="Lower">−</button>
      <input id="score-${key}" type="number" inputmode="numeric" pattern="[0-9]*" min="0" value="${value}">
      <button class="round-btn" data-score="${key}" data-delta="1" aria-label="Raise">+</button>
    </div>`;
}

function openScoreSheet(matchId) {
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return;
  editingMatchId = matchId;
  const sport = sportOf(match.sportId);
  $('#sheet-sport').textContent = `${sport.name} — ${scoringSummary(sport)}`;

  if (match.sides.length > 2) {
    // All vs all: everybody enters his own score in one list.
    $('#sheet-body').innerHTML = `
      <div class="ffa-scores">
        ${match.sides
          .map(
            (side, i) => `
          <div class="ffa-row">
            <span class="ffa-name">${escapeHtml(nameOf(side.players[0]))}
              ${genTag(playerOf(side.players[0]).generation)}</span>
            ${scoreStepper(String(i), side.score ?? 0)}
          </div>`
          )
          .join('')}
      </div>`;
  } else {
    $('#sheet-body').innerHTML = `
      <div class="score-row">
        <div class="court-side">
          <p class="team-names">${teamHtml(match.sides[0].players)}</p>
          ${scoreStepper('0', match.sides[0].score ?? 0)}
        </div>
        <div class="net"><span>VS</span></div>
        <div class="court-side">
          <p class="team-names">${teamHtml(match.sides[1].players)}</p>
          ${scoreStepper('1', match.sides[1].score ?? 0)}
        </div>
      </div>`;
  }

  $$('#sheet-body [data-score]').forEach((btn) => {
    btn.onclick = () => {
      const input = $(`#score-${btn.dataset.score}`);
      input.value = Math.max(0, (Number(input.value) || 0) + Number(btn.dataset.delta));
    };
  });

  $('#sheet').hidden = false;
}

function closeSheet() {
  $('#sheet').hidden = true;
  editingMatchId = null;
}

function saveScoreSheet() {
  const match = state.matches.find((m) => m.id === editingMatchId);
  if (!match) return closeSheet();
  match.sides.forEach((side, i) => {
    const input = $(`#score-${i}`);
    side.score = Math.max(0, Math.round(Number(input && input.value) || 0));
  });
  match.done = true;
  closeSheet();
  saveState();
  render();
  toast('Result saved');
}

/* ================================ TABLE ================================= */

function pointsHeaderFor(filter) {
  if (filter === 'all') return 'Pts';
  const sport = sportOf(filter);
  return sport && sport.scoring === 'score' ? 'Score' : 'Pts';
}

function renderTable() {
  const chips = $('#table-chips');
  chips.innerHTML =
    `<button data-filter="all" class="${tableFilter === 'all' ? 'on' : ''}">Overall</button>` +
    orderedSports(state.sports)
      .map(
        (s) =>
          `<button data-filter="${s.id}" class="${tableFilter === s.id ? 'on' : ''}">${escapeHtml(
            s.name
          )}</button>`
      )
      .join('');
  chips.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => { tableFilter = btn.dataset.filter; render(); };
  });

  // A sport can be removed from under a filter; fall back to the overall table.
  if (tableFilter !== 'all' && !sportOf(tableFilter)) tableFilter = 'all';

  const rows = standings(state, tableFilter === 'all' ? null : tableFilter);
  const anyPlayed = rows.some((r) => r.played > 0);

  if (!anyPlayed) {
    $('#table-body').innerHTML =
      '<p class="empty">Nothing on the board yet.<br>Play a match, enter the score, and the standings fill themselves in.</p>';
    return;
  }

  const scope = state.matches.filter((m) => tableFilter === 'all' || m.sportId === tableFilter);
  const playedHere = scope.filter((m) => m.done).length;
  const pointsHeader = pointsHeaderFor(tableFilter);

  // The one question this screen exists to answer, answered before the detail.
  const leaderRow = rows[0];
  const runnerUp = rows[1];
  const gap = runnerUp ? leaderRow.points - runnerUp.points : 0;
  const margin = !runnerUp
    ? 'The only one on the board'
    : gap === 0
      ? `Level with ${escapeHtml(runnerUp.name)} on points`
      : `${gap} ${gap === 1 ? 'point' : 'points'} clear of ${escapeHtml(runnerUp.name)}`;

  const finished = scope.length > 0 && playedHere === scope.length;

  $('#table-body').innerHTML = `
    ${finished ? `<div class="champion-strip">${TROPHY_SVG}</div>` : ''}
    <div class="leader">
      ${medal(1)}
      <div class="leader-text">
        <span class="label">${finished ? 'Winner' : 'Leading'}</span>
        <span class="name">${escapeHtml(leaderRow.name)}</span>
        <span class="margin">${margin}</span>
      </div>
      <div class="total"><b>${leaderRow.points}</b><span>${pointsHeader}</span></div>
    </div>

    <p class="eyebrow">After ${playedHere} of ${scope.length} ${scope.length === 1 ? 'match' : 'matches'}</p>
    <div class="standings">
      <div class="standings-head">
        <span class="spacer"></span>
        <span class="who-name">Player</span>
        <span class="record">W · D · L</span>
        <span class="diff">+/−</span>
        <span class="pts">${pointsHeader}</span>
      </div>
      ${rows
        .map(
          (row, i) => `
        <div class="standings-row${i === 0 ? ' top' : ''}">
          ${medal(i + 1)}
          <span class="who-name">
            <span class="nm">${escapeHtml(row.name)}</span>
            <span class="gen gen-line gen-${row.generation}">${escapeHtml(
              generationLabel(row.generation)
            )}</span>
          </span>
          <span class="record">${row.won} · ${row.drawn} · ${row.lost}</span>
          <span class="diff ${row.diff > 0 ? 'up' : row.diff < 0 ? 'down' : ''}">${
            row.diff > 0 ? '+' : ''
          }${row.diff}</span>
          <span class="pts">${row.points}</span>
        </div>`
        )
        .join('')}
    </div>`;
}

/* ================================ SHARE ================================= */

function shareText() {
  const rows = standings(state, tableFilter === 'all' ? null : tableFilter);
  const { done, total } = progress(state.matches);
  const title = tableFilter === 'all' ? 'Dad Championships' : `Dad Championships — ${sportName(tableFilter)}`;
  const medals = ['🥇', '🥈', '🥉'];
  const width = Math.max(...rows.map((r) => r.name.length));

  const lines = rows.map((row, i) => {
    const rank = i < 3 ? medals[i] : `${i + 1}.`;
    return `${rank} ${row.name.padEnd(width)}  ${row.points}`;
  });

  const timetable = orderedSports(state.sports)
    .filter((s) => s.time)
    .map((s) => `${s.time}  ${s.name}`);

  return (
    `🏆 ${title}\n${done} of ${total} matches played\n\n${lines.join('\n')}` +
    (timetable.length ? `\n\nToday\n${timetable.join('\n')}` : '')
  );
}

async function share() {
  const text = shareText();
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast('Table copied');
  } catch {
    /* the user dismissed the share sheet — nothing to report */
  }
}

/* ================================ RENDER ================================ */

function render() {
  const setupMode = !state;

  $('#view-setup').hidden = !setupMode;
  $('#tabs').hidden = setupMode;
  $('#btn-menu').hidden = setupMode;
  ['matches', 'table'].forEach((name) => {
    $(`#view-${name}`).hidden = setupMode || view !== name;
  });

  if (setupMode) {
    $('#champ-name').textContent = 'Dad Championships';
    $('#champ-sub').textContent = 'Set up a new championship';
    renderSetup();
    return;
  }

  const counts = { dad: 0, granddad: 0, kid: 0 };
  for (const p of state.players) counts[p.generation] = (counts[p.generation] || 0) + 1;
  const who = GENERATIONS.filter((g) => counts[g.id] > 0)
    .map((g) => `${counts[g.id]} ${g.label.toLowerCase()}${counts[g.id] === 1 ? '' : 's'}`)
    .join(' · ');

  $('#champ-name').textContent = 'Dad Championships';
  $('#champ-sub').textContent = who;

  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));

  if (view === 'matches') renderMatches();
  if (view === 'table') renderTable();
}

/* =============================== WIRING ================================= */

document.addEventListener('change', (event) => {
  const select = event.target.closest('select');
  if (!select) return;

  // ---- the setup screens
  if (select.dataset.count) {
    const field = select.dataset.count === 'sports' ? 'sportCount' : 'playerCount';
    draft[field] = Number(select.value);
    saveDraft();
    renderSetup();
    return;
  }
  if (select.dataset.genIndex !== undefined) {
    draft.playerGenerations[Number(select.dataset.genIndex)] = select.value;
    saveDraft();
    renderSetup();
    return;
  }
  if (select.dataset.sportIndex !== undefined) {
    const index = Number(select.dataset.sportIndex);
    if (select.value === OTHER) {
      draft.sportCustom[index] = true;
      draft.sportNames[index] = '';
    } else {
      draft.sportCustom[index] = false;
      draft.sportNames[index] = select.value;
    }
    saveDraft();
    renderSetup();
    return;
  }
  if (select.dataset.formatIndex !== undefined) {
    draft.sportFormats[Number(select.dataset.formatIndex)] = select.value;
    saveDraft();
    renderSetup();
    return;
  }
  if (select.dataset.scoringIndex !== undefined) {
    draft.sportScorings[Number(select.dataset.scoringIndex)] = select.value;
    saveDraft();
    renderSetup();
    return;
  }
  if (select.dataset.winpointsIndex !== undefined) {
    draft.sportWinPoints[Number(select.dataset.winpointsIndex)] = Number(select.value);
    saveDraft();
    renderSetup();
    return;
  }

  // ---- the sport sheet: the win-points choice only applies to one point type
  if (select.id === 'sport-scoring') {
    $('#sport-sheet .win-points-row').hidden = select.value !== 'match';
    return;
  }

  // ---- the sheet for a sport added later
  if (select.id === 'new-sport-name') {
    readNewSportSheet();
    if (select.value === OTHER) {
      newSport.custom = true;
      newSport.name = '';
    } else {
      newSport.custom = false;
      newSport.name = select.value;
    }
    renderNewSportSheet();
    return;
  }
  if (select.id === 'new-sport-format') {
    readNewSportSheet();
    newSport.format = select.value;
    renderNewSportSheet();
    return;
  }
  if (select.id === 'new-sport-scoring') {
    readNewSportSheet();
    newSport.scoring = select.value;
    renderNewSportSheet();
    return;
  }
  if (select.id === 'new-sport-winpoints') {
    newSport.winPoints = Number(select.value);
  }
});

document.addEventListener('click', (event) => {
  const goto = event.target.closest('[data-goto]');
  if (goto) {
    draft.step = Number(goto.dataset.goto);
    saveDraft();
    renderSetup();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  const tab = event.target.closest('#tabs button');
  if (tab) {
    view = tab.dataset.view;
    render();
  }
});

document.addEventListener('input', (event) => {
  const nameInput = event.target.closest('input[data-kind]');
  if (nameInput) {
    const index = Number(nameInput.dataset.index);
    const list = nameInput.dataset.kind === 'sport' ? draft.sportNames : draft.playerNames;
    list[index] = nameInput.value;
    saveDraft();
    renderPreview();
    return;
  }
  if (event.target.id === 'new-sport-custom') newSport.name = event.target.value;
});

$('#btn-create').onclick = createChampionship;

$('#sheet-cancel').onclick = closeSheet;
$('#sheet').onclick = (event) => { if (event.target.id === 'sheet') closeSheet(); };
$('#sheet-save').onclick = saveScoreSheet;

$('#sport-cancel').onclick = () => { $('#sport-sheet').hidden = true; editingSportId = null; };
$('#sport-sheet').onclick = (event) => {
  if (event.target.id === 'sport-sheet') { $('#sport-sheet').hidden = true; editingSportId = null; }
};
$('#sport-save').onclick = saveSportSheet;
$('#sport-time-clear').onclick = () => { $('#sport-time').value = ''; };

$('#new-sport-cancel').onclick = () => { $('#new-sport-sheet').hidden = true; newSport = null; };
$('#new-sport-sheet').onclick = (event) => {
  if (event.target.id === 'new-sport-sheet') { $('#new-sport-sheet').hidden = true; newSport = null; }
};
$('#new-sport-save').onclick = addNewSport;

$('#btn-share').onclick = share;
$('#menu-share').onclick = () => { $('#menu').hidden = true; share(); };
$('#btn-menu').onclick = () => { $('#menu').hidden = false; };
$('#menu-close').onclick = () => { $('#menu').hidden = true; };
$('#menu').onclick = (event) => { if (event.target.id === 'menu') $('#menu').hidden = true; };

$('#menu-reset').onclick = () => {
  if (!confirm('Clear every result but keep the players, the sports and the programme?')) return;
  state.matches.forEach((m) => {
    m.sides.forEach((side) => { side.score = null; });
    m.done = false;
  });
  saveState();
  $('#menu').hidden = true;
  view = 'matches';
  render();
  toast('Results cleared');
};

$('#menu-rebuild').onclick = () => {
  if (!confirm('Draw up a fresh programme for every sport? All results are cleared.')) return;
  buildAllProgrammes(state);
  saveState();
  $('#menu').hidden = true;
  view = 'matches';
  render();
  toast('New programme drawn up');
};

$('#menu-new').onclick = () => {
  if (!confirm('Start over? This championship and all its results are deleted.')) return;
  state = null;
  localStorage.removeItem(STATE_KEY);
  draft.step = 1;
  saveDraft();
  $('#menu').hidden = true;
  render();
};

// The nav bar keeps its hairline hidden until the content slides under it.
const topbar = $('#topbar');
const syncTopbar = () => topbar.classList.toggle('scrolled', window.scrollY > 4);
window.addEventListener('scroll', syncTopbar, { passive: true });
syncTopbar();

render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* offline support is a bonus, never a blocker */
    });
  });
}
